# 01 — Product

## Pitch

Applying to SWE internships means retyping the same profile into Greenhouse, Lever, Ashby and Workday dozens of times a week, creating a new Workday account per employer, and clicking through 5–7 pages per application. applypipe turns that into: **react ✅ in Discord → later, click through Chrome tabs already parked on their review pages and press Submit.** It gets smarter over time because every correction made on a review page becomes the answer next time.

## User

One person (the owner), a CS/SWE student on an M1 Pro MacBook, applying to ~20–75 internships per week in peak season. Comfortable with TypeScript and the terminal. Postings already arrive in a Discord channel via a GitHub Action webhook. Personal tool, run locally; may be open-sourced later (hence no personal data in the repo).

## Core loop

1. A posting arrives in the Discord channel (existing webhook, unchanged).
2. The owner reacts ✅ (phone or desktop, any time).
3. When the owner runs `npm start`, the bot queues every ✅'d post it hasn't processed (live reactions are queued immediately while running).
4. The worker opens each job in a dedicated Chrome window, detects the ATS, signs in / creates the account, fills every page, and stops on the review page. Status emoji update on the Discord post.
5. The owner reviews each parked tab (flagged fields are highlighted), fixes anything, and clicks Submit. The tool records the final values and marks the post 📨.

**v1 works when:** for a Greenhouse, Lever, Ashby and Workday posting each, a ✅ results in a tab parked on the review page with every field the profile can answer filled correctly, without the owner touching the keyboard before review — and nothing is ever submitted automatically.

## Features

### MVP (Phases 1–6)

**F1 — Discord trigger & catch-up**
- Bot reads the feed channel; a ✅ from the owner's Discord user ID queues the post.
- On startup, scans the channel back 14 days / 500 messages for ✅ reactions not yet in the DB (the whole window every time, so a ✅ added offline to an older post still counts).
- Removing ✅ while the job is still `queued` removes it from the queue.
- Acceptance: ✅ on a post while running → `jobs` row `queued` within 5 s and bot adds 👀. Restart after reacting to 3 posts while offline → all 3 queued at startup, none twice.

**F2 — Link resolution & dedupe**
- Extract the application URL from message content and embeds; resolve redirects and known wrapper pages (Simplify, GitHub README links) to the real ATS URL.
- Normalize URLs; a job whose normalized URL or (ATS, company, requisition ID) already exists is not re-queued — bot reacts 🔁.
- Acceptance: two posts for the same Greenhouse job with different `utm_*`/`gh_src` params → one job; second post gets 🔁.

**F3 — Worker & parking**
- One persistent Chrome context; up to `MAX_PARALLEL` (default 3) jobs filling at once, max 1 per Workday tenant. Parked tabs stay open and don't count toward the limit.
- Each finished job sits on its review page (single-page forms: scrolled to the Submit button, not clicked).
- Acceptance: queue 5 jobs → at most 3 filling at once; all 5 end up as open tabs in `ready`/`needs_you`/`skipped`; no Submit clicked (verified by the submit-guard test and by the absence of confirmation pages).

**F4 — ATS adapters**: Greenhouse (incl. iframe embeds on company sites), Lever, Ashby, Workday.
- Fill identity, contact, links, education, resume upload, work authorization, standard answers, EEO from the profile.
- Acceptance per ATS: on a real posting, all profile-answerable fields filled; resume attached; tab parked; a `field_fills` row exists for every field discovered.

**F5 — Workday accounts**
- Create an account per tenant with the profile's Workday email and the Keychain password; if the account exists, sign in. If email verification is required, mark `needs_you`, keep the tab open, and retry sign-in every 30 s for 15 min.
- Acceptance: first Workday job at a new tenant → `workday_accounts` row created; second job at the same tenant signs in without creating.

**F6 — Submit capture**
- Injected script captures every field's value when the owner clicks Submit (and, on Workday, each Next / Save and Continue). Final values are stored on the job's `field_fills` rows; confirmation page → `submitted`, bot reacts 📨.
- Acceptance: edit one field on a parked Greenhouse tab, submit → that row has `edited = 1` and `final_value` = the edited text; job `submitted`.

**F7 — Unknown ATS & failures**
- Unknown ATS: open the page, generic-fill obvious fields (name, email, phone, LinkedIn, GitHub, resume), mark `needs_you` ("unsupported ATS").
- Closed / 404 postings → `skipped`; selector misses or page errors → `needs_you` with a screenshot saved; tab closed without submitting → `abandoned`.
- Acceptance: each case produces the stated status, emoji and reason.

**F8 — Status & batch summary**
- Emoji on the original post track status (see `03-screens.md`). When the queue drains, the bot DMs the owner one summary message.
- Acceptance: a batch of mixed outcomes produces exactly one DM listing counts and each `needs_you` reason.

### V2 — answer brain (Phases 7–9)

**F9 — Answer bank & matching**
- Bank entries keyed by normalized question; new phrasings matched by local fuzzy match, with Claude choosing among the top 5 candidates when the score is ambiguous.
- Exported to `~/.applypipe/answer-bank.json` on every change; hand edits to that file are imported at startup.
- Acceptance: "Will you now or in the future require sponsorship?" and "Do you need visa sponsorship (now or later)?" resolve to the same entry; editing an answer in the JSON and restarting changes what gets filled.

**F10 — Claude fallback with confidence**
- New questions get an answer from Claude, grounded in the profile, resume text and job description, with a 0–1 confidence. Below 0.7 → yellow highlight. Locked categories are never sent for generation.
- Acceptance: an unseen free-text question gets a filled answer and a `field_fills.source = 'llm'` row with confidence; a sponsorship question with no profile value is left blank and red.

**F11 — Review aid overlay**
- Parked tabs show colored outlines (yellow AI guess, red needs you, green locked) and a floating checklist of flagged fields with jump-to; Workday lists flags from earlier pages too.
- Acceptance: a job with 2 flagged fields shows both in the checklist; clicking one scrolls to and focuses it.

**F12 — Learning from edits**
- After submit, every edited field updates the bank: global scope by default, company scope for company-specific questions. Edits to locked fields never change the bank; the bot DMs a reminder to update `profile.yaml` instead.
- Acceptance: edit "How did you hear about us?" on one application → next application at a different company fills the edited answer with `source = 'bank'`.

**F13 — "Why this company" drafts**
- For why-company / why-role questions, Claude drafts an answer from the job description + profile + resume, respecting the field's character limit; always flagged yellow; stored in `company_drafts`.
- Acceptance: a Greenhouse posting with a "Why are you interested in X?" textarea gets a draft within the limit, highlighted yellow.

## Out of scope (do not build)

- Auto-submitting, ever.
- LinkedIn Easy Apply or any LinkedIn automation (against LinkedIn's terms).
- Multi-user, hosted, or cloud deployment.
- **V3:** resume-variant routing (SWE vs PM resume), outcome analytics / callback tracking, email watcher (auto-clicking Workday verification links, reading rejections/OA invites).
- A Chrome-extension "queue this page" button (possible later, reusing the queue).
- A web UI for the answer bank (the JSON file is the UI).
