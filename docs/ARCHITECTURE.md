# PaperTrail Write — Architecture Document
**Version:** 0.2
**Last updated:** March 2026
**Status:** Specification — ready for development

---

## 1. Product Overview

PaperTrail Write is a timed, monitored writing environment for classroom use. Teachers create assignments with prompts and optional source materials. Students write in a focused, plain-text environment. A small set of behavioral signals is captured during the session. After students submit, the teacher reviews a session report, downloads it, and ends the assignment — at which point all student data is permanently deleted from PaperTrail's servers within 24 hours.

Write is a **standalone product** in the PaperTrail Academic suite. It uses its own dedicated Supabase project and its own Lemon Squeezy product listing. It does not share infrastructure with PaperTrail Inspect, StyleMatch, Verify, or Oral.

---

## 2. Platform Decisions

### 2.1 What Is Built

| Interface | Audience | Tech | Notes |
|---|---|---|---|
| Student writing environment | Students | Website (any browser) | Accessed via join code — no install |
| Teacher dashboard — web | Teachers | Website (same origin) | Full feature set |
| Teacher dashboard — extension | Teachers (Chrome) | Chrome Extension (MV3) | Same features + desktop notifications |

### 2.2 What Is Not Built (v1)

- No student-side Chrome extension or lockdown browser
- No desktop / Electron app
- No mobile app
- No LMS integration (Google Classroom, Canvas, Schoology)
- No AI prompt or source generation (v2 feature — see Section 12)

### 2.3 Student Access

Students always use the website. No account, no install required. Works on school Chromebooks, iPads, any modern browser. Students join by entering a join code displayed by the teacher.

### 2.4 Teacher Access — Web vs. Extension

Both teacher interfaces connect to the same Supabase backend. A teacher can manage assignments on the web dashboard and monitor a live session from the Chrome extension, or use either exclusively. Feature parity is maintained across both. The extension adds desktop notifications and a persistent toolbar badge but has no capabilities the web dashboard lacks.

### 2.5 Hosting

**Vercel** (Hobby tier to start). The web app is vanilla HTML/CSS/JS served as static files; all backend logic runs via Supabase. No server-side rendering or Vercel Edge Functions are needed in v1.

---

## 3. Data Architecture

### 3.1 Core Principle: Supabase as Transit, Not Vault

Student submission data persists in Supabase only for the duration of an active assignment. When a teacher ends an assignment, the system:

1. Warns the teacher and requires a report download
2. Purges all `submissions` and `sessions` rows linked to that assignment
3. Retains only the assignment template, source files, class rosters, and teacher account data

**PaperTrail never holds student writing after an assignment ends.** The teacher's downloaded file is the permanent record.

### 3.2 Automatic Purge Fallback

Any session row older than **24 hours** is automatically purged by a Supabase scheduled Edge Function, regardless of whether the teacher formally ended the assignment. Teachers are warned of this at session creation. The 24-hour window begins when the session was last active (not when it was created), giving reasonable protection for multi-day assignments where a teacher forgets to close.

### 3.3 What Stays vs. What Goes

| Data | Retained | Purged on assignment end |
|---|---|---|
| Teacher account (email, plan) | ✅ Permanent | — |
| Class rosters (display names only) | ✅ Permanent | — |
| Assignment templates (prompts, settings) | ✅ Permanent | — |
| Source files (PDF, image, DOCX, text) | ✅ Permanent (Supabase Storage) | — |
| Session metadata (started_at, status) | — | ✅ |
| Student submissions (essay text, logs) | — | ✅ |

### 3.4 Session Model — Toggle On/Off

An **assignment** is a permanent reusable template. A **session** is one live run of an assignment, which can be paused and resumed:

- Teacher **opens** a session → join code generated → students can enter
- Teacher **pauses** a session → students receive a 60-second warning, then textarea locks; saved work is retained in Supabase
- Teacher **reopens** a session → new join code generated; students re-enter and resume their saved work
- Teacher **ends** the assignment → download + purge flow runs; data deleted within 24 hours

A student who already has a submission row for a session is automatically resumed when they rejoin with the same display name — the join code just controls whether new students can enter.

---

## 4. Database Schema

All tables live in the dedicated **`papertrail-write`** Supabase project. Row-level security (RLS) enforces that teachers can only access their own data.

### 4.1 `teachers`
Permanent. Created on account signup via Supabase Auth.

```sql
id            uuid        PRIMARY KEY  -- Supabase Auth uid
email         text        UNIQUE NOT NULL
display_name  text
school_name   text
plan          text        DEFAULT 'trial'  -- trial | pro | school
plan_expires  timestamptz
created_at    timestamptz DEFAULT now()
```

### 4.2 `classes`
Permanent. Belongs to a teacher.

```sql
id              uuid  PRIMARY KEY DEFAULT gen_random_uuid()
teacher_id      uuid  REFERENCES teachers(id) ON DELETE CASCADE
name            text  NOT NULL          -- e.g. "AP Language — Period 3"
period          text                    -- e.g. "Period 3"
student_roster  jsonb DEFAULT '[]'      -- array of display name strings only
                                        -- e.g. ["Alex B.", "Jordan M."]
created_at      timestamptz DEFAULT now()
```

**Privacy note:** Roster stores display names only (first name + last initial maximum). No student IDs, emails, or full legal names are stored.

### 4.3 `assignments`
Permanent. Reusable templates. Can be copied across classes without recreation.

```sql
id                  uuid  PRIMARY KEY DEFAULT gen_random_uuid()
teacher_id          uuid  REFERENCES teachers(id) ON DELETE CASCADE
class_id            uuid  REFERENCES classes(id) ON DELETE SET NULL
title               text  NOT NULL
prompt_type         text  NOT NULL
                          -- timed_essay | document_based |
                          -- open_response | source_analysis
prompt_text         text
time_limit_minutes  int   -- NULL = no time limit
join_code           text  -- teacher-set or left blank (auto-generated per session)
allow_spellcheck    boolean DEFAULT false
grade_level         text  -- "6-8" | "9-10" | "11-12" | "College"
subject             text  -- "ELA" | "History" | "Science" | "Other"
created_at          timestamptz DEFAULT now()
```

**Note on `grade_level` and `subject`:** Collected in v1 for assignment filtering and organisation. These are also the primary inputs the v2 AI prompt generator will need — collecting now avoids a schema migration later.

**Note on `join_code`:** Stored on the assignment as a teacher-settable default. Each session generates its own active code (see `sessions` table). When copying an assignment, the teacher can keep the same code or set a new one — it is just a convenience default, not a security mechanism.

### 4.4 `sources`
Permanent. One assignment can have up to **8 sources**. Used for Document-Based and Source Analysis prompt types.

```sql
id             uuid  PRIMARY KEY DEFAULT gen_random_uuid()
assignment_id  uuid  REFERENCES assignments(id) ON DELETE CASCADE
teacher_id     uuid  REFERENCES teachers(id) ON DELETE CASCADE
source_type    text  NOT NULL  -- text | pdf | image | docx
label          text            -- tab label shown to student, e.g. "Document A"
sort_order     int  DEFAULT 0  -- controls tab order in Source Analysis
text_content   text            -- used when source_type = 'text'
                               -- also stores Mammoth-extracted HTML for docx fallback
storage_path   text            -- Supabase Storage path for pdf / image / docx files
storage_url    text            -- public or signed URL cached here for fast access
created_at     timestamptz DEFAULT now()
```

**Storage bucket:** `assignment-sources` (public read, authenticated write/delete).

**Source rendering behaviour (client-side):**
- `text` → rendered as plain text in the source panel
- `pdf` → PDF.js in-browser render; if render fails, extracted text shown as fallback
- `image` → native `<img>` tag; no fallback needed
- `docx` → Mammoth.js converts to formatted HTML (bold, italics, headings preserved); rendered as HTML in the source panel

**Upload pipeline (teacher side):**
1. Teacher selects file(s) in the assignment form
2. File is uploaded to Supabase Storage (`assignment-sources/{teacher_id}/{assignment_id}/{filename}`)
3. A signed URL (or public URL if bucket is public) is stored in `storage_url`
4. A `sources` row is inserted with the appropriate `source_type`

### 4.5 `sessions`
Ephemeral. One row per live run of an assignment. Purged on assignment end.

```sql
id             uuid  PRIMARY KEY DEFAULT gen_random_uuid()
assignment_id  uuid  REFERENCES assignments(id) ON DELETE CASCADE
teacher_id     uuid  REFERENCES teachers(id) ON DELETE CASCADE
status         text  DEFAULT 'active'
                     -- active | paused | ended
join_code      text  UNIQUE NOT NULL  -- short alphanumeric, e.g. "EAGLE7"
                                      -- auto-generated at session open
started_at     timestamptz DEFAULT now()
paused_at      timestamptz
ended_at       timestamptz
last_active_at timestamptz DEFAULT now()
                            -- updated on each student autosave; used by 24h purge check
created_at     timestamptz DEFAULT now()
```

**Join code generation:** 5–6 character alphanumeric, uppercase, generated server-side (Supabase Edge Function or RPC) to avoid collisions with currently active sessions. A new code is generated each time a session is opened or reopened after a pause.

### 4.6 `submissions`
Ephemeral. One row per student per session. Purged on assignment end.

```sql
id                   uuid  PRIMARY KEY DEFAULT gen_random_uuid()
session_id           uuid  REFERENCES sessions(id) ON DELETE CASCADE
assignment_id        uuid  REFERENCES assignments(id) ON DELETE CASCADE
teacher_id           uuid  REFERENCES teachers(id) ON DELETE CASCADE
student_display_name text  NOT NULL
class_period         text
essay_text           text  DEFAULT ''
process_log          jsonb DEFAULT '[]'
word_count           int   DEFAULT 0
started_at           timestamptz DEFAULT now()
last_saved_at        timestamptz
last_active_at       timestamptz  -- updated on autosave; used to compute "Away" status
submitted_at         timestamptz
is_submitted         boolean DEFAULT false
```

### 4.7 Row-Level Security Policies

```sql
-- Teachers own their data
CREATE POLICY "teacher_owns_assignments" ON assignments
  FOR ALL USING (teacher_id = auth.uid());

CREATE POLICY "teacher_owns_sources" ON sources
  FOR ALL USING (teacher_id = auth.uid());

CREATE POLICY "teacher_owns_sessions" ON sessions
  FOR ALL USING (teacher_id = auth.uid());

CREATE POLICY "teacher_owns_submissions" ON submissions
  FOR ALL USING (teacher_id = auth.uid());

CREATE POLICY "teacher_owns_classes" ON classes
  FOR ALL USING (teacher_id = auth.uid());

-- Students: can read session metadata to validate join code
CREATE POLICY "student_can_read_active_session" ON sessions
  FOR SELECT USING (status = 'active');

-- Students: can read assignment + sources for their active session
CREATE POLICY "student_can_read_assignment" ON assignments
  FOR SELECT USING (
    id IN (SELECT assignment_id FROM sessions WHERE status = 'active')
  );

CREATE POLICY "student_can_read_sources" ON sources
  FOR SELECT USING (
    assignment_id IN (SELECT assignment_id FROM sessions WHERE status = 'active')
  );

-- Students: can insert their own submission row
CREATE POLICY "student_can_insert_submission" ON submissions
  FOR INSERT WITH CHECK (
    session_id IN (SELECT id FROM sessions WHERE status = 'active')
  );

-- Students: can update only their own submission row
CREATE POLICY "student_can_update_own_submission" ON submissions
  FOR UPDATE USING (
    session_id IN (SELECT id FROM sessions WHERE status = 'active' OR status = 'paused')
    -- paused allowed so final autosave on lock can still write
  );
```

---

## 5. Behavioral Signals

Five signals are captured. Deliberately limited to avoid overwhelming teachers and to stay within the product's non-surveillance framing.

### 5.1 Captured Signals

| Signal | Trigger | Logged | Display label |
|---|---|---|---|
| Paste event | `paste` in textarea | timestamp, elapsed, char count, first 80 chars | "Paste event" |
| Window left focus | `visibilitychange` (hidden) or `blur` | timestamp, elapsed | "Window left focus" |
| Window returned | `visibilitychange` (visible) or `focus` | timestamp, elapsed, absence duration (seconds) | "Window returned — [N]s away" |
| Time to first keystroke | First `keydown` / `input` in textarea | elapsed seconds from session open | "Writing began at [elapsed]" |
| Paste-then-delete | Paste followed by 100+ char deletion within 90 seconds | timestamp, elapsed, chars deleted | "Content removed shortly after paste" |

### 5.2 Signals Explicitly Not Captured

- Clipboard contents (requires browser permission prompt; legally restricted in some jurisdictions)
- Keystroke dynamics or typing speed
- Screen content or screenshots
- Camera or microphone
- Network activity from other tabs
- Right-click events (removed — low signal value, easily triggered accidentally)
- Idle gaps (removed — indistinguishable from thinking)
- Delete bursts not preceded by a paste (removed — too easily misread)
- Tab switches within the source panel in Source Analysis assignments (these are legitimate reading behaviour)

### 5.3 Process Log Event Format

```json
{ "type": "paste", "timestamp": "2026-03-15T10:23:41.000Z",
  "elapsed_seconds": 483, "char_count": 312,
  "content_preview": "The Civil War was fundamentally a conflict over..." }

{ "type": "window_blur", "timestamp": "2026-03-15T10:31:02.000Z",
  "elapsed_seconds": 924 }

{ "type": "window_focus", "timestamp": "2026-03-15T10:33:18.000Z",
  "elapsed_seconds": 1060, "absence_seconds": 136 }

{ "type": "first_keystroke", "timestamp": "2026-03-15T09:04:12.000Z",
  "elapsed_seconds": 252 }

{ "type": "paste_then_delete", "timestamp": "2026-03-15T10:25:10.000Z",
  "elapsed_seconds": 609, "char_count": 287 }
```

### 5.4 Live "Away" Status (Teacher Dashboard)

A student's current status is derived from their process log:
- **Not started** — no `first_keystroke` event yet
- **Writing** — last event was `window_focus` or `first_keystroke`, or no blur has occurred
- **Away** — last event was `window_blur` with no subsequent `window_focus`; display time away as `(now - blur_timestamp)`
- **Submitted** — `is_submitted = true`

The teacher dashboard computes this client-side on each polling cycle. The "Away" count drives the Chrome extension badge.

### 5.5 Pause Behaviour

When a teacher pauses a session, students currently writing receive a banner: *"Your teacher has paused this session. Your work has been saved. This window will lock in 60 seconds."* After 60 seconds, the textarea is disabled and autosave fires one final time. Students who attempt to join a paused session see: *"This session is currently paused. Ask your teacher when it will reopen."*

---

## 6. Session Lifecycle & Submission Flow

### 6.1 Student Autosave

- Essay text and process log saved to Supabase every 30 seconds
- Student can trigger a manual save at any time
- If connection is lost, app retries silently and shows a connection warning banner
- On timer expiry: auto-submit fires, textarea locks, student transitions to submitted screen
- On session pause: one final autosave fires before textarea locks

### 6.2 Student Submission

Students can submit at any time before the timer expires or a pause occurs. Submission is confirmed via a modal. Once submitted, the essay is read-only.

### 6.3 End-of-Assignment Flow (Teacher)

This is the product's primary privacy mechanism and must be strictly enforced in the UI:

```
Teacher clicks "End Assignment"
    ↓
Modal: "Download the session report before ending.
        Once ended, all student work is permanently deleted
        from PaperTrail's servers within 24 hours."
    ↓
[ Download Report ] ← required first step; button is prominent
    ↓
  .zip downloads containing:
    - session-report.json  (full fidelity)
    - session-report.tsv   (paste into Google Sheets)
    ↓
Checkbox appears: "I have downloaded the report and understand
                   that student data will be deleted."
    ↓
[ End Assignment ] button becomes active
    ↓
Supabase: session.status → 'ended', ended_at → now()
Supabase: deletes all submissions rows for this session
Supabase: deletes session row
    ↓
Confirmation screen: "Assignment ended. Student data has been
                       removed from PaperTrail's servers."
```

The Download Report button must be clicked and produce a successful download before the checkbox appears. The End Assignment button must remain disabled until the checkbox is checked.

---

## 7. Source Materials

### 7.1 Supported Types

| Type | Upload method | Student rendering |
|---|---|---|
| Plain text | Paste into textarea in assignment form | Rendered as plain text in source panel |
| PDF | File upload | PDF.js in-browser render; falls back to extracted text on render failure |
| Image | File upload (JPG, PNG, WebP, GIF) | Native `<img>` tag; no fallback needed |
| DOCX | File upload | Mammoth.js client-side → formatted HTML (bold, italics, headings preserved) |

### 7.2 Limits

- Maximum **8 sources per assignment** (applies to Source Analysis; Document-Based typically uses 1–2)
- Maximum file size: **20MB per file** (enforced client-side before upload)
- Accepted MIME types enforced on upload: `application/pdf`, `image/*`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`

### 7.3 Storage

- Bucket: `assignment-sources` in the `papertrail-write` Supabase project
- Path pattern: `{teacher_id}/{assignment_id}/{uuid}-{filename}`
- Files are stored permanently with the assignment and survive session end/purge
- Files are deleted only when the assignment itself is deleted
- Signed URLs (1-hour expiry, refreshed on page load) used for student access — prevents hotlinking

### 7.4 Assignment Copy Behaviour

When a teacher copies an assignment to another class, the following is duplicated:
- Title, prompt type, prompt text
- Source materials (new `sources` rows pointing to the same `storage_path` — files are not re-uploaded)
- Time limit and all settings
- Join code (teacher can keep the same or change it before saving)

A new `assignment_id` is created; the copy is independent of the original.

---

## 8. Report Format

The downloadable report is a `.zip` file containing two files. Generated entirely client-side using JSZip — no server involvement.

### 8.1 `session-report.tsv`
Tab-separated. Columns:

```
Student Name | Period | Word Count | Submitted | Submitted At |
Paste Events | Largest Paste (chars) | Times Window Left Focus |
Total Time Away (seconds) | Time to First Keystroke (seconds) | Essay Text
```

### 8.2 `session-report.json`
Full fidelity. Includes complete `process_log` for each student.

```json
{
  "session": {
    "assignment_title": "Rhetorical Analysis — MLK",
    "prompt_type": "document_based",
    "join_code": "EAGLE7",
    "started_at": "2026-03-15T09:00:00Z",
    "ended_at": "2026-03-15T10:45:00Z"
  },
  "submissions": [
    {
      "student_display_name": "Jordan M.",
      "class_period": "Period 3",
      "word_count": 487,
      "is_submitted": true,
      "submitted_at": "2026-03-15T10:38:22Z",
      "time_to_first_keystroke_seconds": 47,
      "essay_text": "...",
      "process_log": [...]
    }
  ]
}
```

---

## 9. Chrome Extension Architecture

### 9.1 Manifest Version
Manifest V3.

### 9.2 Extension Components

| Component | Purpose |
|---|---|
| `popup.html` / `popup.js` | Teacher dashboard UI — mirrors web dashboard at 400px width |
| `background.js` (service worker) | Supabase polling, badge updates, desktop notifications |
| `manifest.json` | Permissions, metadata |

### 9.3 Permissions

```json
{
  "permissions": ["storage", "notifications", "alarms"],
  "host_permissions": ["https://*.supabase.co/*"]
}
```

No access to student browser tabs. No content scripts injected on student devices.

### 9.4 Extension-Specific Features

- **Badge counter:** Number of students currently "Away" (purple badge). Updates every 30 seconds.
- **Desktop notifications:** Fires when a student has been away for a teacher-configurable threshold (default 3 minutes; options: 1, 3, 5, 10 minutes, or off). Format: *"[Name] has been away for [N] minutes — [Assignment title]"*
- **Persistent auth:** Teacher auth token stored in `chrome.storage.local`
- **One-click download:** Report download triggered directly from popup

### 9.5 Shared Code Strategy

Teacher dashboard UI is written as framework-agnostic HTML/CSS/JS. Extension popup includes the same stylesheet and JS modules. Supabase client calls are identical in both contexts.

---

## 10. Authentication & Accounts

### 10.1 Teacher Authentication

Supabase Auth (email + password). Teachers sign up and log in at the PaperTrail Write website. Email verification required. Password reset via Supabase Auth email flow. The Chrome extension stores the session token in `chrome.storage.local`.

### 10.2 Student Access

Students have no accounts. They access a session by:
1. Navigating to the PaperTrail Write URL
2. Entering a join code
3. Entering or selecting their display name
4. Optionally selecting their class period
5. Viewing the transparency notice (cannot skip)
6. Clicking "Begin Writing"

If a submission already exists for that name + session, the student resumes their previous work. If the session is paused, they see a paused message. If the session has ended, they see a closed message.

### 10.3 Class Rosters & CSV Import

Teachers can preload a class roster so students select their name from a dropdown rather than typing. Roster management supports:
- Manual add/edit/remove of individual names
- **CSV import** (v1): upload a CSV with one display name per row; names are validated against the `First L.` format before import
- Rosters are stored permanently in the `classes` table
- Display names only — no student IDs, emails, or full legal names

---

## 11. Trial Plan Limits & Billing

### 11.1 Plans

| Plan | Limits | Enforcement |
|---|---|---|
| Trial (free) | 3 assignments, 1 class, 30-day expiry | Supabase RLS + Edge Function check |
| Teacher Pro | Unlimited assignments + classes | Single account |
| School | Multiple teacher seats | Volume pricing |

### 11.2 Limit Enforcement

Limits are enforced **server-side** via a Supabase Edge Function called before any insert on `assignments` or `classes`. Client-side gating is a UX convenience only — it cannot be relied on for security.

The Edge Function checks:
- `plan` and `plan_expires` on the `teachers` row
- Count of existing `assignments` or `classes` for that teacher
- Returns a structured error that the client surfaces as a plan upgrade prompt

### 11.3 Billing

Lemon Squeezy (existing PaperTrail store). Write is a standalone product — purchasing Write does not grant access to Inspect/StyleMatch/Verify/Oral, and vice versa. Webhooks update the `plan` and `plan_expires` fields on the `teachers` row.

---

## 12. V2 Feature: AI Prompt & Source Generator

*Parked for v2. Schema and UI in v1 are designed to support this without migration.*

The AI prompt generator will appear as an optional step in the assignment creation flow:

1. Teacher selects prompt type, grade level, subject (all in v1 schema)
2. Teacher clicks "Generate prompt ideas"
3. Claude generates 2–3 prompt options appropriate to type and level
4. Teacher selects and edits, saves as normal
5. For document-based/source analysis: Claude can summarise or generate a source text

**Infrastructure:** Anthropic API call via Supabase Edge Function (API key never on client). Billed as a paid add-on tier via Lemon Squeezy.

---

## 13. Infrastructure & Cost Summary

| Layer | Technology | Cost |
|---|---|---|
| Frontend | Vanilla HTML/CSS/JS | Free |
| Hosting | Vercel (Hobby → Pro as needed) | Free → $20/month |
| Database + Auth + Realtime | Supabase Pro (`papertrail-write` project) | $25/month base |
| File storage | Supabase Storage (same project) | ~$0.021/GB overage beyond 100GB |
| Storage egress | Supabase | $0.09/GB beyond 250GB |
| Billing | Lemon Squeezy (existing store) | % of revenue |
| Fonts | Google Fonts | Free |
| DOCX parsing | Mammoth.js (client-side) | Free |
| PDF rendering | PDF.js (client-side) | Free |
| ZIP generation | JSZip (client-side) | Free |
| Extension distribution | Chrome Web Store | $5 one-time (already paid) |

**Storage cost estimate at scale:** 100 teachers × 50 assignments × 3 sources × 3MB average = ~45GB. Well within the Pro plan's 100GB inclusion. Egress scales with student usage — monitor once live.

---

## 14. Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend (web) | Vanilla HTML/CSS/JS |
| Frontend (extension) | Same HTML/CSS/JS, wrapped in Chrome MV3 |
| Database | Supabase Postgres (`papertrail-write` project) |
| Auth | Supabase Auth (email + password) |
| Realtime | Supabase Realtime (websocket subscriptions) |
| File storage | Supabase Storage |
| Server logic | Supabase Edge Functions (join code generation, plan enforcement, 24h purge) |
| Billing | Lemon Squeezy |
| PDF rendering | PDF.js (client-side) |
| DOCX rendering | Mammoth.js (client-side) |
| ZIP generation | JSZip (client-side) |
| Fonts | Google Fonts — Lora + DM Sans |
| Hosting | Vercel |

---

## 15. Out of Scope (All Versions Unless Explicitly Revisited)

- Student-side browser extension or lockdown browser
- Desktop / Electron application
- Mobile application
- LMS integrations (Google Classroom, Canvas, Schoology)
- Video, audio, or screen monitoring
- AI-generated grades or rubrics
- Parent-facing features
- Peer review or collaborative writing
- OCR on uploaded images
- Server-side PDF-to-image conversion
