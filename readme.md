# PaperTrail Write 🖊️

> *"Let them write. Then see how they wrote."*

A timed, monitored writing environment for classroom use. Teachers create assignments with prompts and optional source materials. Students write in a focused, plain-text environment. A small set of behavioral signals is captured during the session. After students submit, the teacher downloads a session report and ends the assignment — at which point all student data is permanently deleted from PaperTrail's servers.

Part of the [PaperTrail Academic](https://papertrailacademic.com) suite. Standalone product — separate Supabase project, separate billing.

---

## Documentation

- [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md) — screens, user flows, prompt types, behavioral signals, monetisation
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — database schema, session model, source file pipeline, RLS policies, infrastructure
- [`docs/BRAND.md`](docs/BRAND.md) — colors, typography, voice, component conventions

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Hosting | Vercel |
| Database + Auth + Realtime | Supabase (dedicated `papertrail-write` project) |
| File storage | Supabase Storage |
| Server logic | Supabase Edge Functions |
| Billing | Lemon Squeezy |
| PDF rendering | PDF.js (client-side) |
| DOCX rendering | Mammoth.js (client-side) |
| ZIP generation | JSZip (client-side) |
| Fonts | Google Fonts — Lora + DM Sans |

---

## Repo Structure

```
papertrail-write/
├── web/                  # The web app — deployed to Vercel
│   └── index.html
├── extension/            # Chrome Extension MV3 — Phase 2
├── docs/
│   ├── ARCHITECTURE.md
│   ├── PROJECT_SPEC.md
│   └── BRAND.md
└── README.md
```

Vercel root directory is set to `web/`.

---

## Environment Variables

The app reads Supabase credentials from the environment. Set these in Vercel (and locally in a `.env` file — never commit it):

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

See `web/env.js` for how these are injected at runtime.

---

## Development Phases

| Phase | Scope | Status |
|---|---|---|
| 1 | Core web app — auth, assignments, sources, sessions, student writing, reports | 🔧 In progress |
| 2 | Chrome Extension (MV3) — mirrors web dashboard, badge, notifications | ⏳ Planned |
| 3 | Billing, trial enforcement, Web Store submission, marketing page | ⏳ Planned |
| 4 | V2 AI features — prompt + source generation via Claude API | ⏳ Future |

---

## Privacy Posture

Student submission data persists in Supabase only for the duration of an active assignment. On assignment end, all submissions and session rows are purged. A 24-hour automatic purge runs as a fallback for sessions the teacher never formally closed. PaperTrail never retains student writing after an assignment ends.

See [`docs/ARCHITECTURE.md §3`](docs/ARCHITECTURE.md) for the full data retention policy.
