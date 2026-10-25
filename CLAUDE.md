# applypipe — guidance for Claude Code

applypipe is a personal, local job-application pipeline. A Discord feed (posted by an existing GitHub Action webhook) carries internship postings. The owner reacts ✅ to a post; a local worker opens the application in real Chrome, creates/signs into the ATS account if needed, fills every page, and **stops on the review page**. The owner reviews and clicks Submit himself.

Read `specs/README.md` first. Specs are the source of truth; if code and spec disagree, ask or fix the spec in the same change.

## Non-negotiable rules

1. **Never submit an application.** No code path may click a Submit / Send application / final Apply control. All clicks in adapters go through `safeClick()` (see `specs/02-architecture.md` → Submit guard), which throws on submit-like controls unless the control is on the per-ATS navigation allowlist (e.g. Workday "Save and Continue"). Tests must cover the guard.
2. **No personal data in the repo.** Profile, resume, database, answer bank, Chrome profile, screenshots and secrets live under `~/.applypipe/` (overridable with `APPLYPIPE_HOME`). The repo ships only `profile.example.yaml` and `env.example` with placeholders. `.gitignore` must exclude anything that could hold personal data.
3. **Secrets:** the Workday password lives only in macOS Keychain (via the `security` CLI). Never log it, never write it to SQLite, fill logs, screenshots metadata or JSON exports. Mask it as `••••` anywhere a value would be logged. API keys and the Discord token come from `~/.applypipe/.env`.
4. **Locked answers are never guessed.** Work authorization, sponsorship, graduation date, location and EEO answers come only from `profile.yaml`. If one is missing, leave the field blank and flag it red; never ask the LLM to invent it.
5. **An external failure never crashes the run.** Claude API, Discord, or a page error marks that one job `needs_you`/`failed` with a reason and the worker moves on.

## Stack

TypeScript (strict, ESM) on Node LTS · Playwright driving installed Chrome (`channel: "chrome"`, persistent context) · discord.js · better-sqlite3 · @anthropic-ai/sdk · zod · yaml · commander · vitest · pino. Use current stable versions of every package; do not pin versions from memory. Run TS with `tsx`.

The Claude model ID comes from `ANTHROPIC_MODEL` in `.env`; default `env.example` to the current Sonnet-class model ID at build time (look it up, don't guess).

## Commands (to exist after Phase 1)

- `npm start` → `applypipe run` (Discord bot + worker, one process)
- `npm run status` → table of jobs by status
- `npm run profile:check` → validate `~/.applypipe/profile.yaml`
- `npm run setup:password` → store the Workday password in Keychain
- `npm test` → vitest

## Conventions

- One adapter per ATS in `src/adapters/`; all ATS selectors in that adapter's `selectors.ts` so a site change is a one-file fix. Prefer `data-automation-id`, `name`, `id` and accessible labels over CSS classes.
- Fill values through the helpers in `src/browser/fill.ts` (native value setter + `input`/`change` events), never raw `.value =`.
- Every filled field is recorded as a `field_fills` row (see data model) — this is what learning depends on.
- Keep modules small and pure where possible; unit-test pure logic (normalization, matching, diffing, parsing).
- Commit at the end of each build phase once its acceptance criteria pass.

## Build order

Follow `specs/04-build-plan.md` phase by phase. Verify each phase's acceptance criteria before starting the next. When testing against live postings, never submit.
