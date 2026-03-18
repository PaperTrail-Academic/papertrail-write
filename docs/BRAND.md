# PaperTrail Academic — Brand Guidelines
## Write Edition 🖊️

> For the full suite brand reference, see the PaperTrail Academic main brand doc.
> This document covers Write-specific additions and the complete token set needed for web app and Chrome extension development.

---

## Suite Identity

**Name:** PaperTrail Academic
**Tagline:** *"You've read thousands of student essays. Trust that instinct — then document it."*
**Domain:** papertrailacademic.com
**Contact:** hello@papertrailacademic.com

**What it is:** A suite of academic writing tools for educators — structured, repeatable, documentable. Not a plagiarism detector. Not an AI detector. Not a verdict machine.

---

## Voice & Tone

**Register:** Teacher-to-teacher. One educator speaking to another — someone who has read thousands of essays, who can feel when something is off, who needs a structured way to document that instinct.

**Rules:**
- Never cute, never clever at the expense of clarity
- Never alarmist — data is data, not a verdict
- Never condescending — the teacher is the expert, the tool is a resource
- Always frame around educator judgment; always include a disclaimer
- Avoid "detect," "catch," "flag" — prefer "surface," "document," "note," "capture"
- Never use "AI detector," "plagiarism checker," or verdict language
- No exclamation points in body copy
- No emoji in UI copy (product emoji in suite navigation only)

**Write-specific register:** Write also addresses the student directly (transparency screen, writing environment). Student-facing copy should be clear, calm, and matter-of-fact — not intimidating, not friendly-corporate. A straightforward explanation of what is happening, with no attempt to soften or alarm.

---

## Product Suite

| Product | Emoji | Color | Tagline |
|---|---|---|---|
| Inspect | ✏️ | Blue `#4A6FA5` | *"Something about this essay doesn't add up."* |
| StyleMatch | 🔍 | Gold `#C9A84C` | *"This doesn't sound like them."* |
| Verify | 🔬 | Teal `#2a7a6b` | *"I want to be thorough before I have this conversation."* |
| Write | 🖊️ | Purple `#7B5EA7` | *"Let them write. Then see how they wrote."* |

Each tagline is written in the teacher's voice — the professional moment that prompts the tool, not a feature description.

---

## Design Tokens

### Colors

```css
/* Suite-wide */
--pt-ink:    #1a2235;   /* Body text, headings — near-black navy */
--pt-light:  #f5f7fa;   /* Page backgrounds, panels */
--pt-border: #dde2ec;   /* Subtle dividers */
--pt-muted:  #6b7a99;   /* Secondary text, captions, disclaimer blocks */

/* Product accents — one per product, never mixed */
--pt-blue:   #4A6FA5;   /* Inspect */
--pt-gold:   #C9A84C;   /* StyleMatch */
--pt-teal:   #2a7a6b;   /* Verify */
--pt-write:  #7B5EA7;   /* Write */

/* Write — extended palette for web app and extension */
--pt-write-d:    #5f4585;   /* Darker — hover states, pressed buttons */
--pt-write-l:    #9b7dc4;   /* Lighter — header accents, transparency bar */
--pt-write-pale: #f3effb;   /* Very light — hover backgrounds, selected states */
```

**Color assignment principle:** Each product owns one accent color. That color drives primary buttons, active states, icon tint, focus rings, and accent headings. Never use another product's color within Write's UI.

### Typography

```html
<link href="https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
```

| Role | Font | Usage |
|---|---|---|
| Headings / display | Lora | Hero text, section titles, card titles, product name lockups |
| Body / UI | DM Sans | All body copy, labels, buttons, navigation, form elements |
| Monospace | DM Mono | Join codes, timers, word counts, process log timestamps |

**Type scale:**

```css
--text-xs:   0.75rem;    /* 12px — fine print, timestamps */
--text-sm:   0.875rem;   /* 14px — secondary labels, captions */
--text-base: 1rem;       /* 16px — body default */
--text-lg:   1.125rem;   /* 18px — lead text, form labels */
--text-xl:   1.25rem;    /* 20px — subheadings */
--text-2xl:  1.5rem;     /* 24px — section headings */
--text-3xl:  1.875rem;   /* 30px — page titles */
--text-4xl:  2.25rem;    /* 36px — hero headings */
```

### Spacing & Radius

```css
--radius-sm:  4px;
--radius-md:  8px;
--radius-lg:  12px;
--radius-xl:  16px;

--space-xs:   4px;
--space-sm:   8px;
--space-md:   16px;
--space-lg:   24px;
--space-xl:   40px;
--space-2xl:  64px;
```

### Shadows

```css
--shadow-card:  0 2px 12px rgba(26, 34, 53, 0.08);
--shadow-modal: 0 8px 32px rgba(26, 34, 53, 0.16);
```

---

## UI Component Conventions

### Buttons

```css
/* Primary — Write purple */
background: var(--pt-write);
color: #ffffff;
font-family: 'DM Sans', sans-serif;
font-weight: 600;
border-radius: var(--radius-md);
padding: 10px 20px;
border: none;

/* Primary hover */
background: var(--pt-write-d);

/* Secondary / ghost */
background: transparent;
color: var(--pt-write);
border: 1.5px solid var(--pt-write);
border-radius: var(--radius-md);

/* Secondary hover */
background: var(--pt-write-pale);

/* Disabled */
opacity: 0.45;
cursor: not-allowed;
```

### Cards / Panels

```css
background: #ffffff;
border: 1px solid var(--pt-border);
border-radius: var(--radius-lg);
box-shadow: var(--shadow-card);
padding: var(--space-lg);
```

### Disclaimer Blocks

Every screen that shows session data must include a disclaimer block. No exceptions.

```css
background: var(--pt-light);
border-left: 3px solid var(--pt-muted);
border-radius: 0 var(--radius-md) var(--radius-md) 0;
padding: var(--space-sm) var(--space-md);
font-size: var(--text-sm);
color: var(--pt-muted);
font-family: 'DM Sans', sans-serif;
line-height: 1.6;
```

Standard disclaimer text:
> *"This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation."*

### Transparency Bar (Writing Environment)

Always visible below the sticky header while a session is active.

```css
background: rgba(123, 94, 167, 0.15);
border-bottom: 1px solid rgba(123, 94, 167, 0.2);
padding: 0.35rem var(--space-lg);
font-size: var(--text-xs);
color: var(--pt-write-l);
font-weight: 500;
letter-spacing: 0.04em;
```

Text: `● This session is being documented.`
The dot pulses (CSS animation). Never remove or hide this element during an active session.

### Status Indicators

Never use red/green traffic-light framing that implies pass/fail.

```
Not started    →  muted text, no indicator
Writing        →  no special treatment needed
Away           →  pt-muted text, show duration (e.g. "Away — 4 min")
Submitted      →  success green text, checkmark — this is a neutral completion state
Notable event  →  pt-write-pale background, no icon, descriptive text only
```

---

## Write — Vocabulary Rules

| ✅ Use | ❌ Avoid |
|---|---|
| Paste event | Copied content detected |
| Window left focus | Left the exam / Tab switch |
| Window returned | Returned after attempting to cheat |
| Content removed shortly after paste | Deleted suspicious content |
| Notable | Suspicious / Flagged |
| Session | Exam / Test |
| Writing environment | Lockdown browser / Proctored exam |
| Educator judgment | Final verdict |
| Session is being documented | You are being monitored / watched |
| End assignment | Delete data |
| Join code | Password (avoid where possible) |

---

## Write — Process Log Labels

All event labels in the teacher's session report follow these exact strings:

| Event type | Label shown in UI |
|---|---|
| `paste` | Paste event |
| `window_blur` | Window left focus |
| `window_focus` | Window returned — [N]s away |
| `first_keystroke` | Writing began at [elapsed] |
| `paste_then_delete` | Content removed shortly after paste |

---

## Assets

### Icons

| File | Use |
|---|---|
| `icon16.png` | Browser tab favicon + Chrome toolbar button |
| `icon32.png` | Retina small contexts |
| `icon48.png` | `chrome://extensions` management page |
| `icon128.png` | Chrome Web Store listing |

Icon artwork uses the Write purple (`#7B5EA7`) as the background tint with the 🖊️ motif. Consistent with suite icon style.

### Favicon

`favicon16.png` and `favicon32.png` — same artwork as extension icons, served from `web/` root.

---

## Legal & Disclaimer Posture

Every report view, every expanded session log, and every screen surfacing behavioral data must carry the disclaimer. It is not fine print — it is part of the product philosophy.

> *"This log is one input among many. Educator judgment governs all interpretation and any subsequent conversation."*

For the student transparency screen specifically, the following must always appear (teacher can customise the wording but cannot disable the screen):

> *"This is a monitored writing session. Your teacher will be able to see how long you spent writing, whether you left this page, and whether you pasted content from another source. Your work is saved automatically."*

---

## Anti-Patterns (Never Do This)

- Do not use verdict language — no "flagged," "caught," "detected," "suspicious"
- Do not use "AI detector" or "plagiarism checker" in any copy
- Do not assign a score or rating to behavioral signals
- Do not suggest the tool makes decisions — it surfaces data; the teacher decides
- Do not remove or hide the transparency bar during an active session
- Do not allow the transparency screen to be skipped
- Do not omit the disclaimer from any screen showing session data
- Do not use `--pt-blue`, `--pt-gold`, or `--pt-teal` anywhere in the Write UI
- Do not use Playfair Display — the correct serif is Lora
- Do not store student writing after assignment end
- Do not read clipboard contents
- Do not access other browser tabs
