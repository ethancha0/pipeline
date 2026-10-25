# 04 — Build plan

Each phase ends with something runnable. Verify its acceptance criteria, then commit. Don't start a phase before the previous one passes. When testing on live postings, **never submit**.

---

## Phase 1 — Scaffold, config, data

**Goal:** the project builds, config and profile validate, the DB exists, and the CLI runs.

Tasks:
1. `package.json` (type: module), `tsconfig.json` (strict, NodeNext), `.gitignore` (per `02-architecture.md`), vitest config. Install current stable: `discord.js`, `playwright`, `better-sqlite3`, `@anthropic-ai/sdk`, `zod`, `yaml`, `dotenv`, `commander`, `pino`, `pino-pretty`, `ulid`; dev: `typescript`, `tsx`, `vitest`, `@types/node`, `@types/better-sqlite3`. Run `npx playwright install chrome` only if Chrome isn't already installed.
2. `src/config.ts`: resolve `APPLYPIPE_HOME` (default `~/.applypipe`), create it plus `artifacts/` and `chrome-profile/` if missing (mode 700); load `.env` from there; zod-validate (V2 keys optional until Phase 7).
3. `src/log.ts`: pino logger; `maskSecrets()` replaces any registered secret strings with `••••`.
4. `src/profile/schema.ts` + `load.ts`: the zod schema from `02-architecture.md`; derive the locked map.
5. `profile.example.yaml` and `env.example` in the repo root, placeholders only, every key commented.
6. `src/db/schema.sql`, `db.ts` (open with WAL, run migrations by `user_version`), and the typed query modules: `jobs.ts` (insert, getByMessageId, getByNormalizedUrl, setStatus, listByStatus), `meta.ts` (get/set).
7. `src/cli.ts` with commands `run` (Phase 1: validate config + profile, open the DB, log "ready", exit), `status`, `profile check`; wire the npm scripts.
8. Unit tests: profile schema (valid example passes; missing `work_auth` fails with a readable path), migrations run twice without error.

Files: `package.json`, `tsconfig.json`, `.gitignore`, `profile.example.yaml`, `env.example`, `src/{cli,config,log}.ts`, `src/profile/*`, `src/db/*`, `test/unit/profile.test.ts`, `test/unit/db.test.ts`.

**Verify:**
- [ ] `npm run typecheck` and `npm test` pass.
- [ ] With `APPLYPIPE_HOME=/tmp/ap-test` and the example profile copied there: `npm run profile:check` prints ✅ per section; deleting `work_auth` prints ❌ with the key path and exits 1.
- [ ] `npm start` creates `applypipe.db` with all tables; a second start is a no-op migration.
- [ ] `npm run status` prints "No jobs yet."
- [ ] `git status` shows no files from `APPLYPIPE_HOME`.

---

## Phase 2 — Discord trigger, parsing, dedupe, status emoji

**Goal:** ✅ on a feed post creates a queued job with the right URL, survives restarts, and dedupes. No browser yet.

Tasks:
1. `src/discord/parse.ts` (pure) per the contract; fixtures in `test/fixtures/discord/*.json` covering: URL in content; URL only in an embed; URL in an embed field; a Simplify link; a GitHub README link; no URL. Ask the owner for a real sample message and add it as a fixture (OQ1).
2. `src/jobs/normalize.ts` + `detect.ts` (pure) with unit tests for each ATS URL shape and the tracking-param stripping.
3. `src/jobs/resolve.ts`: redirect following via `fetch` only in this phase; wrapper pages → set the job `needs_you` "wrapper link — resolver lands in Phase 3". Keep the function signature final.
4. `src/discord/bot.ts`: client with the intents/partials from the spec; handlers for reaction add/remove; catch-up on `ready`; owner/channel/emoji filtering.
5. `src/discord/status.ts`: `setStatusEmoji(messageId, status)` — removes the bot's previous status emoji, adds the new one; failures logged only.
6. `enqueueFromMessage(msg)`: parse → normalize → dedupe → insert `queued` + 👀, or 🔁 on a duplicate; unparseable → ❌ + `failed` "no link found".
7. Update `last_processed_message_id` after catch-up and after each live enqueue.
8. `run` now starts the bot and stays running; Ctrl-C closes cleanly.
9. `README.md` (repo root) setup section: create the Discord app and bot, enable the Message Content intent, invite URL scopes/permissions (View Channel, Read Message History, Add Reactions, Send Messages for DMs), fill `.env`.

Files: `src/discord/{bot,parse,status}.ts`, `src/jobs/{normalize,detect,resolve}.ts`, `test/unit/{parse,normalize,detect}.test.ts`, `test/fixtures/discord/*`, `README.md`.

**Verify:**
- [ ] Unit tests pass for every parse fixture and URL shape.
- [ ] Running: ✅ on a feed post → within 5 s `npm run status` shows it `queued` with the correct `apply_url`/`ats`, and the post shows 👀.
- [ ] Removing ✅ → job deleted, 👀 removed.
- [ ] Stop the process, ✅ three posts (one a duplicate of an existing job), start again → two new jobs queued, the duplicate gets 🔁, nothing is queued twice on a second restart.
- [ ] A ✅ from another Discord user is ignored.

---

## Phase 3 — Worker, Greenhouse end to end, submit capture

**Goal:** the full loop on the simplest ATS.

Tasks:
1. `browser/context.ts`: launch the persistent context (`channel: 'chrome'`, headed); `newJobTab(job)` stores `jobId` on the page.
2. `browser/guard.ts` + tests: `safeClick` throws on submit-like names; add a test that greps `src/adapters/**` for `.click(` and fails if found.
3. `browser/fill.ts` helpers with read-back verification.
4. `adapters/types.ts`, `adapters/run.ts` (common loop + `FillRecorder` writing `field_fills`).
5. `answers/provider.ts` + `profileProvider.ts` (keyword table + standard answers).
6. `adapters/greenhouse/` (incl. iframe-embedded boards), closed-posting detection, park by scrolling Submit into view.
7. `queue/scheduler.ts`: concurrency, lifecycle, emoji updates, `page.on('close')` → abandoned, error screenshot.
8. `browser/capture.ts`: init script + binding; final values → `field_fills`; confirmation detection → `submitted` + 📨.
9. `jobs/resolve.ts`: the wrapper-page resolver via a background page.
10. Minimal overlay badge (company · status).
11. Fixture test: a saved Greenhouse form HTML served locally → adapter discovers the expected fields and fills them (assert the DOM values).

**Verify:**
- [ ] Fixture test passes; guard tests pass.
- [ ] Live: ✅ a Greenhouse posting → tab opens, all profile fields filled, resume attached, scrolled to Submit, post shows 🟢 (or ⚠️ listing red fields).
- [ ] Edit one field, click Submit yourself → the job becomes `submitted`, 📨 appears, and that field's row has `edited = 1` and the new `final_value`.
- [ ] Close a parked tab without submitting → `abandoned`, emoji removed.
- [ ] A closed Greenhouse posting → `skipped` ⏭️.

---

## Phase 4 — Lever and Ashby

Tasks: `adapters/lever/`, `adapters/ashby/` (yes/no button pairs as radio; comboboxes), fixtures + fixture tests for each, register them in detection.

**Verify:**
- [ ] Fixture tests pass.
- [ ] Live: one Lever and one Ashby posting each reach 🟢/⚠️ with resume attached and profile fields filled.

---

## Phase 5 — Workday

Tasks:
1. `secrets/keychain.ts` + `setup:password` command.
2. `adapters/workday/selectors.ts` (automation-ids), `account.ts` (create / sign in / verification wait-and-retry), `pages.ts` (page loop, error banners, stop at Review).
3. Per-tenant lock in the scheduler.
4. Capture on Next / Save and Continue with `page_index`.

**Verify:**
- [ ] `npm run setup:password` stores the password; `security find-generic-password -s applypipe-workday -w` returns it; nothing is written to disk by applypipe.
- [ ] Live: a Workday posting at a new tenant creates the account (row in `workday_accounts`), walks every page, and stops on Review → 🟢/⚠️.
- [ ] A second posting at the same tenant signs in without creating an account.
- [ ] If the tenant requires email verification → ⚠️ "verify your email…"; after verifying, the job continues on its own within the 15-min window.
- [ ] Two Workday jobs at the same tenant never fill at the same time.

---

## Phase 6 — Unknown ATS, summary DM, hardening  ← MVP done

Tasks: `adapters/generic/`; CAPTCHA detection; batch summary DM; requeue rule; Ctrl-C graceful shutdown; `skip` command; `fill-log.json` per job.

**Verify:**
- [ ] An iCIMS/SmartRecruiters posting opens, gets partially filled, and shows ⚠️ "unsupported ATS — partially filled".
- [ ] A batch of mixed outcomes produces exactly one summary DM matching `03-screens.md`.
- [ ] Removing and re-adding ✅ on an abandoned job requeues it.
- [ ] Ctrl-C during a fill → that job returns to `queued`; the next start resumes it.
- [ ] End-to-end MVP check: one job per ATS (Greenhouse, Lever, Ashby, Workday) all parked correctly; zero submissions made by the tool.

---

## Phase 7 — Answer bank and matching (V2)

Tasks: `brain/normalize.ts`, `categorize.ts`, `match.ts` (trigram similarity + thresholds), the Claude tie-break call in `llm.ts` (structured output), `db/bank.ts`, `export.ts` (debounced atomic export + startup import + seeding from `standard_answers`), `brainProvider.ts` implementing `AnswerProvider`; switch the worker to it behind a config flag `ANSWER_PROVIDER=brain` (default `brain` after this phase).

**Verify:**
- [ ] Unit tests: the sponsorship phrasing pair resolves to the same key; unrelated questions score < 0.55; an export/import round trip is lossless.
- [ ] Editing an answer in `answer-bank.json` and restarting → the new answer is filled next time.
- [ ] A corrupted `answer-bank.json` → startup refuses with the zod error path; the DB is unchanged.

---

## Phase 8 — Claude fallback + full review aid (V2)

Tasks: the answer generation call in `llm.ts` (tool output `{category, answer, confidence}`), the locked-category guard, option mapping, resume text extraction + cache, job description capture into `jobs.job_description`, the full overlay (highlights + checklist + Workday earlier-page flags + re-inject on navigation).

**Verify:**
- [ ] An unseen free-text question is filled with `source = 'llm'` and a confidence; below 0.7 it shows yellow in the overlay and the checklist.
- [ ] A sponsorship question with the profile value removed → blank, red, never sent to Claude (assert in a test with the LLM client mocked).
- [ ] Claude unreachable (bad API key) → affected fields red "AI unavailable", the job still parks.
- [ ] Clicking a checklist row scrolls to and focuses the field.

---

## Phase 9 — Learning, locked enforcement, why-us drafts (V2)  ← V2 done

Tasks: `learn.ts` per the contract (global vs company scope, locked-edit DM, `times_used` / `last_confirmed_at`), `drafts.ts` + `company_drafts`, wiring learning into the `submitted` handler.

**Verify:**
- [ ] Edit "How did you hear about us?" at company A, submit → at company B the edited answer is filled with `source = 'bank'`.
- [ ] Edit a "Why <Company>?" answer → stored on `company_drafts.final_text`, no global bank change.
- [ ] Edit a locked field → bank unchanged, DM reminder sent.
- [ ] A "Why are you interested in <Company>?" textarea gets a draft within `maxLength`, highlighted yellow.
