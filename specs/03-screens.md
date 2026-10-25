# 03 — Screens and surfaces

applypipe has no app UI. The owner sees exactly three surfaces: **Discord**, **the parked Chrome tabs** (with the review aid), and **the terminal**.

## Navigation map

```
Discord feed post ──✅──▶ (status emoji on the same post) ──▶ batch summary DM
                                                     │
Terminal: npm start ──▶ live log ──▶ Chrome window (one tab per job) ──▶ review aid ──▶ owner clicks Submit
Terminal: npm run status | profile:check | setup:password | skip <id>
```

## 1. Discord

### 1a. Status emoji on the original feed post

The bot keeps exactly one status emoji of its own on the post (it removes its previous one when status changes). The owner's ✅ stays.

| Status | Emoji | When |
|---|---|---|
| queued | 👀 | job created |
| duplicate | 🔁 | post resolved to an existing job; no job created |
| filling | ⏳ | worker started |
| ready | 🟢 | parked on review page, nothing red |
| needs_you | ⚠️ | at least one red flag, CAPTCHA, verification, unsupported ATS, or error |
| submitted | 📨 | confirmation detected |
| skipped | ⏭️ | posting closed / 404 |
| failed | ❌ | could not even open the job (e.g. unresolvable link) |
| abandoned | (status emoji removed) | tab closed without submitting; ✅ again to requeue |

Requeue rule: if the owner removes and re-adds ✅ on a post whose job is `abandoned`, `skipped` or `failed`, reset it to `queued`.

States:
- **Bot offline:** reactions are picked up at the next `npm start` (catch-up), so nothing to show meanwhile.
- **Emoji API error:** logged; the job continues.

### 1b. Batch summary DM

Sent once when the queue drains. Plain text, no embeds:

```
applypipe batch done — 7 jobs
🟢 4 ready · ⚠️ 2 need you · ⏭️ 1 skipped

⚠️ Acme — SWE Intern: CAPTCHA on page load
⚠️ Initech — Software Engineering Intern: verify your email for initech.wd1.myworkdayjobs.com
⏭️ Globex — Backend Intern: posting closed
```

Each line links the job title to the original Discord post (message link). Empty batch (only duplicates) → no DM.

### 1c. Other DMs (V2)

- Locked-field edit reminder: "You changed 'Will you require sponsorship?' at Acme from No to Yes. If that's your new answer, update profile.yaml."
- At most one DM per job for these; batched into the summary when the summary hasn't been sent yet.

## 2. Parked Chrome tabs

- One dedicated Chrome window (the persistent `chrome-profile`), one tab per job, opened in queue order. The tab title is untouched; the review aid shows which job it is.
- **ready / needs_you:** the tab sits on the review page (Workday) or on the filled form scrolled to the Submit button (Greenhouse, Lever, Ashby).
- **filling:** the tab is visible while filling; the owner shouldn't type in it (the review aid shows "applypipe is filling…" during the fill).
- **skipped:** the tab is closed automatically after 5 s.

### 2a. Review aid (Phase 3 minimal, Phase 8 full)

Injected by `browser/overlay.ts` inside a Shadow DOM root so the page's CSS can't affect it and vice versa.

**Phase 3 minimal version:** a small fixed badge at the bottom right: "applypipe · <Company> · ready" or "… · needs you: <reason>".

**Phase 8 full version:**

- **Field highlights:** a 2px outline plus a small tag next to the field.
  - yellow `AI guess` — source `llm`/`draft`, or confidence below the threshold
  - red `Needs you` — required and unanswered, or a locked category missing from the profile
  - green `From profile (locked)` — locked categories, subtle (1px)
- **Checklist panel:** bottom-right, 320px wide, collapsible.
  - Header: company · title · status pill.
  - Rows grouped "Needs you" (red) then "Check" (yellow): the field label (truncated to 60 chars) and source. Clicking a row scrolls to the field, focuses it and pulses the outline once.
  - Workday: flags from earlier pages appear under "Earlier pages", labeled with the page name and "use Back to edit" (not clickable).
  - Footer: "Edits you make are learned when you submit." and a "Collapse" toggle (remembered per tab only).
  - **Empty state:** "Nothing flagged — review and submit."
- **Workday page changes:** the overlay is re-injected after each navigation (`page.on('framenavigated')`).
- The overlay never contains a submit button and never intercepts clicks outside itself.

## 3. Terminal

### `npm start`

1. Validate `.env` and `profile.yaml`. Errors → print each problem with the file and key, exit 1.
2. Log one line each: "Discord connected as <bot>", "catch-up: queued N, duplicates M", "Chrome ready".
3. Live log, one line per transition: `14:02 ⏳ Acme — SWE Intern (greenhouse)` → `14:03 🟢 Acme — SWE Intern (2 yellow)`.
4. Ctrl-C: stop picking new jobs, let `filling` jobs finish their current page (max 30 s), mark unfinished ones `queued` again, close Discord, leave Chrome open.

### `npm run status`

A table grouped by status: id (first 8 chars), company, title, ATS, status, reason, updated time. Flags: `--all` (default shows the last 7 days), `--json`.

### `npm run profile:check`

✅/❌ per section; locked categories listed with their values (EEO shown only as set/decline); resume path check. Exit 1 on any ❌.

### `npm run setup:password`

Prompts for the Workday email (default from the profile) and the password twice, with hidden input; stores it in Keychain; prints "Saved to Keychain (service applypipe-workday)".

### `npm run skip <id>`

Marks a job `skipped` (e.g. after the owner decides not to apply) and closes its tab.
