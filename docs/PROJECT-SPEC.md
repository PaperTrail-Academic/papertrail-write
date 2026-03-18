# PaperTrail Write — Project Specification
**Version:** 0.2
**Last updated:** March 2026
**Status:** Specification — ready for development

---

## 1. Product Summary

**Product name:** PaperTrail Write 🖊️
**Accent color:** `#7B5EA7` (muted purple)
**Tagline:** *"Let them write. Then see how they wrote."*

PaperTrail Write is a timed, monitored writing environment for classroom use. Teachers create assignments with prompts and optional source materials. Students write in a focused, plain-text environment. A small set of behavioral signals is captured during the session. After students submit, the teacher reviews a session report, downloads it, and ends the assignment — at which point all student data is permanently deleted from PaperTrail's servers within 24 hours.

**Core value proposition:** Prevention over detection. Students who know their session is documented are less likely to use unauthorised sources. The session report gives the teacher context for any follow-up conversation — not a verdict, just documentation.

**Standalone product.** PaperTrail Write has its own Supabase project, its own Lemon Squeezy listing, and its own website. It does not share infrastructure or billing with PaperTrail Inspect, StyleMatch, Verify, or Oral.

---

## 2. Users

### 2.1 Teacher
- Has a PaperTrail Write account (trial or paid)
- Creates and manages assignments, including source materials
- Opens, pauses, reopens, and ends sessions
- Monitors live sessions
- Reviews and downloads session reports
- Manages class rosters
- May use the web dashboard or Chrome extension interchangeably

### 2.2 Student
- Has no account
- Accesses a session via join code
- Enters display name (or selects from preloaded roster)
- Writes in a timed, plain-text environment with source materials visible if applicable
- Can submit at any time; is auto-submitted on timer expiry or session timeout
- Sees a transparency notice before writing begins (cannot skip)

---

## 3. User Flows

### 3.1 Teacher — First-Time Setup

```
Sign up (email + password)
    → Verify email
    → Create first class (name + period + optional roster)
    → Create first assignment
    → Dashboard
```

### 3.2 Teacher — Create Assignment

```
Dashboard → New Assignment
    → Title
    → Class (select or "no class")
    → Prompt type (Timed Essay | Document-Based | Open Response | Source Analysis)
    → Prompt text (textarea)
    → If Document-Based or Source Analysis:
          Add source(s) — up to 8 per assignment
          Each source: label + one of:
            - Paste text
            - Upload PDF
            - Upload image (JPG, PNG, WebP, GIF)
            - Upload DOCX
    → Time limit (minutes, or "no limit")
    → Join code (pre-filled from assignment default, editable)
    → Allow spell/grammar check (toggle, default off)
    → Grade level (optional: 6-8 | 9-10 | 11-12 | College)
    → Subject (optional: ELA | History | Science | Other)
    → Save
```

### 3.3 Teacher — Copy Assignment to Another Class

```
Assignment card → Copy
    → Select target class
    → Review copied fields (title, prompt, sources, settings all copied)
    → Set join code (pre-filled with original, editable)
    → Save as new assignment
```

### 3.4 Teacher — Open a Session

```
Dashboard → assignment card → Open Session
    → System generates a join code for this session
    → Live session view opens with join code displayed prominently
    → Students can now enter
```

### 3.5 Teacher — Pause a Session

```
Live session view → Pause Session
    → Students receive 60-second warning banner
    → After 60 seconds: textarea locks, final autosave fires
    → Session status → paused
    → Students attempting to join see: "Session is paused"
```

### 3.6 Teacher — Reopen a Session

```
Dashboard → assignment card → Reopen Session
    → New join code generated
    → Students re-enter with existing name; resume saved work
    → Previously submitted students remain submitted
```

### 3.7 Teacher — End Assignment

```
Assignment card → End Assignment
    → Modal: download warning
    → Download Report → .zip (JSON + TSV)
    → Checkbox: confirm download + understand deletion
    → End Assignment (now active)
    → Supabase: purges submissions + session rows
    → Confirmation screen
```

### 3.8 Teacher — Monitor Live Session

The live session view polls via Supabase Realtime. For each student:
- Name + period
- Status: Not started / Writing / Away (+ duration) / Submitted
- Word count
- Paste events count
- Time away (cumulative seconds)

Teacher clicks any row to expand the full process log for that student.

### 3.9 Student — Join Session

```
Navigate to PaperTrail Write URL
    → "I'm a Student"
    → Enter join code
    → Enter display name OR select from roster dropdown
    → Select class period (if applicable)
    → Transparency notice (cannot skip)
    → "I understand — Begin Writing"
    → Writing environment opens
```

If a submission already exists for that name + session: student resumes saved work.
If session is paused: student sees paused message.
If session has ended: student sees closed message.

### 3.10 Student — Write and Submit

```
Writing environment:
    - Sticky header: assignment title | student name | timer | word count | autosave status
    - Transparency bar: "● This session is being documented."
    - Source panel (if applicable): collapsible / split / tabbed depending on prompt type
    - Plain-text textarea
    - Autosave every 30 seconds
    - "Save Now" button
    → "Submit Essay"
    → Confirmation modal
    → Submitted screen: read-only essay, copy to clipboard
```

---

## 4. Screens — Student Side

### S0: Landing (Role Select)
- "I'm a Student" / "Teacher Dashboard"
- PaperTrail Write branding, purple accent
- Tagline: *"Let them write. Then see how they wrote."*

### S1: Student Login
- Join code field (uppercase, monospace styling)
- Display name (text input or roster dropdown if preloaded)
- Class period (text input or dropdown)
- Error states: invalid code, session paused, session ended, name already submitted

### S2: Transparency Notice
Cannot be skipped. Default text (teacher cannot disable this screen):

> *"This is a monitored writing session. Your teacher will be able to see how long you spent writing, whether you left this page, and whether you pasted content from another source. Your work is saved automatically."*

Lists clearly: what IS captured, and what is NOT (no clipboard, no keystrokes, no camera, no other tabs).

Single CTA: "I understand — Begin Writing"

### S3: Writing Environment

**Sticky header:** Assignment title | Student name | Countdown timer | Word count | Autosave status

**Transparency bar** (below header, always visible):
`● This session is being documented.`

**Source panel** — layout depends on prompt type:
- **Timed Essay / Open Response:** Collapsible prompt panel above textarea. No source materials.
- **Document-Based:** Split layout — source panel left (read-only, scrollable), textarea right. Right-click disabled on source panel. Tab switches within the source panel are not logged.
- **Source Analysis:** Tabbed panel above or beside textarea. Up to 8 tabs. Tab switches within the panel are not logged.

**Textarea:** Plain text. `spellcheck`, `autocorrect`, `autocapitalize`, `autocomplete` all set per assignment's `allow_spellcheck` toggle.

**Footer:** "Save Now" | "Submit Essay →"

**Timer states:**
- Normal: white text
- Under 10 minutes: amber
- Under 3 minutes: red

**On timer expiry:** auto-submit fires, textarea locks, transition to S4.

**On session pause:** 60-second warning banner appears. Textarea locks after countdown. Final autosave fires.

### S4: Submitted (Locked)
- Confirmation message
- Read-only copy of submitted essay
- "Copy to Clipboard" button
- Summary: word count, submission time
- *"Your teacher has a record of this session."*

---

## 5. Screens — Teacher Side (Web Dashboard)

### T0: Landing / Login / Sign-up
- Email + password login
- Sign-up link → email verification flow
- Password reset link
- PaperTrail suite navigation (links to Inspect, StyleMatch, Verify, Oral)

### T1: Dashboard
Two-panel layout:

**Left panel — Assignments**
- Filter by class, subject, prompt type
- "New Assignment" button
- Each assignment card shows: title, class, prompt type, last session date, status pill
- Card actions: Open Session / Reopen Session | Edit | Copy | Delete | End Assignment

**Right panel — Classes & Rosters**
- List of classes
- Add / edit / delete class
- Per class: name, period, roster management (see T5)

### T2: Assignment Form (New / Edit)
Full-page form. Fields in order:

1. **Title** (text input)
2. **Class** (select or "no class")
3. **Prompt type** (segmented control: Timed Essay | Document-Based | Open Response | Source Analysis)
4. **Prompt text** (textarea, expands to fit)
5. **Sources** (appears for Document-Based and Source Analysis only):
   - "Add Source" button
   - Each source: label field + type selector + content (paste text / upload file)
   - Reorder via drag handle
   - Remove button per source
   - Max 8 sources shown; "Add Source" disabled at limit
6. **Time limit** (number + "minutes" | "No time limit" toggle)
7. **Join code** (text input, monospace — pre-filled from assignment default, editable)
8. **Allow spell/grammar check** (toggle, default off)
9. **Grade level** (optional select: 6-8 | 9-10 | 11-12 | College)
10. **Subject** (optional select: ELA | History | Science | Other)

Source upload UI per source:
- Type tabs: Plain Text | PDF | Image | Word Document
- Plain Text: textarea
- PDF / Image / DOCX: drag-and-drop upload zone + file picker; shows filename and size after upload; remove button

### T3: Live Session View
- Join code displayed prominently: *"Share this code: EAGLE7"*
- Session status pill (Active / Paused)
- Realtime subscription active — updates as events arrive
- Note: *"Status updates in real time. Word count updates every 30 seconds."*
- "Pause Session" button | "End Assignment" button (top right)

Student status table:

| Student | Period | Status | Words | Paste Events | Time Away |
|---|---|---|---|---|---|
| Jordan M. | Per. 3 | Writing | 312 | 1 | — |
| Alex B. | Per. 3 | Away — 4 min | 0 | — | 4 min |
| Sam K. | Per. 3 | Submitted | 498 | — | — |
| Taylor R. | Per. 3 | Not started | 0 | — | — |

- Click any row → expand full process log (with brand-compliant labels)
- Disclaimer block at bottom of every expanded row and at bottom of page

### T4: End Assignment Modal
- Warning copy (see Architecture §6.3 for exact flow)
- Download Report button (prominent, required first step)
- Confirmation checkbox (appears after download)
- End Assignment button (disabled until checkbox checked)

### T5: Class & Roster Management
- List of classes (name, period, student count)
- Add / edit / delete class
- Per class:
  - Roster list (display names)
  - Add individual name (validated: First name + Last initial format, e.g. "Jordan M.")
  - **CSV import:** upload CSV with one name per row; names validated before import; invalid names shown for correction
  - Remove individual names

---

## 6. Screens — Chrome Extension

Extension popup mirrors the web dashboard at 400px wide. Same screens, same data.

**Extension-only features:**

- **Badge:** Count of students currently "Away" — purple background, white number
- **Notifications:** Fires at teacher-set threshold (default 3 min; options: 1, 3, 5, 10 min, off). Format: *"[Name] has been away for [N] minutes — [Assignment title]"*
- **Notification settings:** Accessible from extension settings screen
- **Persistent auth:** Token stored in `chrome.storage.local`
- **One-click download:** Report download from popup without opening web dashboard

---

## 7. Prompt Types — Full Specification

### 7.1 Timed Essay
- Prompt text shown in collapsible panel above textarea
- Full-width textarea
- Timer prominent in header
- No source materials

### 7.2 Document-Based
- Split layout: source panel left, textarea right
- Source panel: read-only, scrollable, right-click disabled
- Up to 2 sources typical (UI supports up to 8)
- Source panel tab switches are NOT logged
- Timer prominent in header

### 7.3 Open Response
- Same layout as Timed Essay
- Timer is optional and less visually prominent when `time_limit_minutes` is null
- Intended for shorter or ungraded writing; no sources

### 7.4 Source Analysis
- Tabbed source panel (above or beside textarea depending on screen width)
- Up to 8 source tabs
- Tabs labelled with teacher-set labels (e.g. "Document A", "Primary Source 1")
- Student can switch tabs freely; tab switches within source panel are NOT logged
- Timer in header

---

## 8. Behavioral Signals

Five signals. All UI copy follows brand vocabulary — no verdict language.

### 8.1 Signal Definitions

**Paste event**
- Trigger: `paste` in textarea
- Logged: timestamp, elapsed, char count, first 80 chars of pasted content
- Label: "Paste event"
- Notable: paste over 200 characters is additionally noted

**Window left focus**
- Trigger: `visibilitychange` (hidden) or window `blur`
- Logged: timestamp, elapsed
- Label: "Window left focus"

**Window returned**
- Trigger: `visibilitychange` (visible) or window `focus` after a blur
- Logged: timestamp, elapsed, absence duration in seconds
- Label: "Window returned — [N]s away"
- Notable: absence over 60 seconds additionally noted in live view

**Time to first keystroke**
- Trigger: first `keydown` or `input` event in textarea
- Logged: elapsed seconds from session open
- Label: "Writing began at [elapsed]"
- Notable: over 3 minutes before first keystroke is noted

**Paste-then-delete**
- Trigger: paste event followed by 100+ character deletion within 90 seconds
- Logged: timestamp, elapsed, chars deleted
- Label: "Content removed shortly after paste"

### 8.2 Not Logged
Clipboard contents, keystroke dynamics, screen content, camera/microphone, network from other tabs, right-click events, idle gaps, delete bursts not preceded by paste, tab switches within source panel.

### 8.3 Language Rules

| Event | Use | Never use |
|---|---|---|
| Paste | "Paste event" | "Copied content detected" |
| Window left | "Window left focus" | "Left the exam" / "Tab switch" |
| Window returned | "Window returned" | "Returned after attempting to cheat" |
| Paste-then-delete | "Content removed shortly after paste" | "Deleted suspicious content" |

Disclaimer on every screen showing session data:
> *"This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation."*

---

## 9. Assignment Lifecycle

### 9.1 States

| State | Meaning | Students can enter? |
|---|---|---|
| Draft | Created, never opened | No |
| Active | Session open, join code live | Yes |
| Paused | Teacher paused; data retained | No (see paused message) |
| Ended | Teacher ended; purge complete | No |

### 9.2 Reuse

Assignments are permanent templates. The same assignment can be:
- Opened as a new session any number of times (each gets a fresh join code)
- Copied to another class (produces a new independent assignment)
- Reused across school years without recreation

Student submission data from previous sessions is purged on end; the assignment template remains.

---

## 10. Monetisation

Billing via Lemon Squeezy (existing PaperTrail store). Write is sold as a standalone product.

### 10.1 Plans

| Plan | Price | Limits |
|---|---|---|
| Trial | Free | 3 assignments, 1 class, 30-day expiry |
| Teacher Pro | TBD / year | Unlimited assignments + classes |
| School | TBD / year | Multiple teacher seats, volume pricing |

Pricing TBD by product owner before Phase 3.

### 10.2 Limit Enforcement

Server-side via Supabase Edge Function. Client-side gating is UX only.

---

## 11. Brand Application

### 11.1 Colors

```css
--pt-write:  #7B5EA7;  /* Primary accent — buttons, active states, icon tint */
--pt-ink:    #1a2235;  /* Body text, headings */
--pt-light:  #f5f7fa;  /* Page backgrounds, panels */
--pt-border: #dde2ec;  /* Dividers */
--pt-muted:  #6b7a99;  /* Secondary text, captions, disclaimer blocks */
```

Never use `--pt-blue`, `--pt-gold`, or `--pt-teal` (other PaperTrail products) within the Write UI.

### 11.2 Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
```

- Headings / display: Lora, 600 weight
- Body / UI / buttons: DM Sans, 400–600 weight

### 11.3 Voice

- Teacher-to-teacher register. Peer, not vendor.
- No exclamation points in body copy
- No emoji in UI copy (🖊️ in suite navigation only)
- No verdict language anywhere (see §8.3)
- Disclaimer block on every screen showing session data
- "Session" not "exam" or "test"; "notable" not "suspicious"; "educator judgment" not "final verdict"

---

## 12. Development Phases

### Phase 1 — Core Web App
- Supabase project setup + schema migration
- Teacher auth (sign up, login, email verify, password reset)
- Class + roster management (including CSV import)
- Assignment creation — all four prompt types
- Source material upload (PDF, image, DOCX, text) + storage
- Assignment copy to another class
- Session open / pause / reopen flow
- Join code generation (Edge Function)
- Student join + transparency screen + resume logic
- Writing environment — all four layout variants
- Behavioral signal capture — all five signals
- Session pause: 60-second warning + textarea lock
- Autosave (30 seconds) + manual save
- Student submit + auto-submit on timer expiry
- Live session view (Supabase Realtime)
- End assignment flow — download ZIP + purge
- Trial plan limit enforcement (Edge Function)
- 24-hour auto-purge (Supabase scheduled function)

### Phase 2 — Chrome Extension
- MV3 scaffolding
- Mirror web dashboard in popup (400px)
- Badge counter (Away students)
- Desktop notifications with configurable threshold
- Persistent auth via `chrome.storage.local`
- One-click report download from popup

### Phase 3 — Polish & Launch
- Lemon Squeezy billing integration
- Plan upgrade prompts in UI
- Chrome Web Store submission
- Marketing page (consistent with PaperTrail suite site)
- Onboarding flow for new teachers

### Phase 4 — V2 AI Features
- AI prompt generator (Claude API via Supabase Edge Function)
- AI source text summariser / generator
- Paid add-on tier via Lemon Squeezy

---

## 13. Open Questions (Resolved)

| # | Question | Resolution |
|---|---|---|
| 1 | Hosting | Vercel (Hobby → Pro as needed) |
| 2 | Join code model | Per-session auto-generated; teacher can also set a default on the assignment |
| 3 | Tagline | *"Let them write. Then see how they wrote."* |
| 4 | Pricing amounts | TBD by product owner before Phase 3 |
| 5 | Auto-purge window | 24 hours from last active |
| 6 | Roster CSV import | In v1 |
| 7 | Source text format | Plain text + PDF + image + DOCX; visual rendering (PDF.js / img / Mammoth.js) |
| 8 | PDF/image rendering | In-browser first; extracted text fallback on failure |
| 9 | DOCX rendering | Mammoth.js → formatted HTML |
| 10 | Max sources | 8 per assignment |
| 11 | Sources stored with | Assignment (permanent); not purged with session |
| 12 | Pause behaviour | 60-second warning banner, then textarea locks |
| 13 | Student submit control | Student can submit at any time |
| 14 | Assignment copy scope | Title, prompt type, prompt text, sources, all settings; new join code (editable) |
| 15 | Separate Supabase project | Yes — `papertrail-write` is standalone |
