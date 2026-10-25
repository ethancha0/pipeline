# 02 — Architecture

## Stack and why

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict, ESM), Node LTS, run via `tsx` | Owner's daily language; in-page scripts (capture, overlay) are JS anyway, so one language end to end |
| Browser | Playwright, `chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: false, viewport: null })` | Real installed Chrome is less often flagged by bot detection than bundled Chromium; persistent profile keeps cookies and ATS sessions between runs |
| Discord | discord.js (gateway client, runs locally) | Webhook posts can't take button clicks, but a bot in the same server can read posts and reactions; no hosting needed |
| DB | SQLite via better-sqlite3 (synchronous) | Single local user, single process; simple and fast |
| LLM | @anthropic-ai/sdk, model from `ANTHROPIC_MODEL` | Tool use / JSON output for answers with confidence |
| Validation | zod | Profile, env, answer-bank JSON, LLM outputs |
| Config | yaml (profile), dotenv (`~/.applypipe/.env`) | Hand-editable |
| CLI | commander | `run`, `status`, `profile check`, `setup password`, `skip` |
| Logging | pino (pretty in dev) | Structured; secrets masked |
| Resume text | a PDF text extractor (e.g. `unpdf` or `pdf-parse`, current stable) | V2 grounding; extracted once and cached |
| Tests | vitest; Playwright against local HTML fixtures | Pure logic unit-tested; adapters tested on fixtures |
| Keychain | macOS `security` CLI via `child_process.execFile` | No native module; `keytar` is unmaintained |

Use current stable versions of all packages.

## System diagram

```
GitHub Action ──webhook──▶ Discord #jobs channel
                               │  (owner reacts ✅)
                               ▼
┌──────────────── applypipe process (npm start) on the Mac ────────────────┐
│ discord/bot.ts ── parse + resolve + dedupe ──▶ SQLite jobs (queued)       │
│        ▲ status emoji / DMs                         │                     │
│        │                                            ▼                     │
│   queue/scheduler.ts ── picks queued jobs ──▶ worker (Playwright Chrome)  │
│                                                 │ detect ATS              │
│                                                 ▼                         │
│                                      adapters/<ats> ──▶ answers/provider  │
│                                                 │        (profile → bank  │
│                                                 │         → Claude)       │
│                                                 ▼                         │
│                           tab parked on review page + overlay injected    │
│                                                 │ owner clicks Submit     │
│                                  capture script ─┘──▶ field_fills.final   │
│                                                      ──▶ learn (V2)       │
└───────────────────────────────────────────────────────────────────────────┘
Data: ~/.applypipe/{.env, profile.yaml, resume.pdf, applypipe.db, answer-bank.json, chrome-profile/, artifacts/}
Secret: macOS Keychain item service="applypipe-workday"
```

## Directory layout

```
applypipe/
├── CLAUDE.md
├── package.json            scripts: start, status, profile:check, setup:password, test, typecheck
├── tsconfig.json           strict, ESM, NodeNext
├── .gitignore              node_modules, dist, .env*, *.db, *.sqlite, answer-bank*.json, artifacts/, chrome-profile/
├── profile.example.yaml    placeholders only
├── env.example             placeholders only
├── src/
│   ├── cli.ts              commander entry
│   ├── config.ts           paths + env (zod)
│   ├── log.ts              pino, maskSecrets()
│   ├── db/
│   │   ├── schema.sql
│   │   ├── db.ts           open, migrate (user_version pragma), typed queries
│   │   └── jobs.ts | fills.ts | bank.ts | accounts.ts | drafts.ts | meta.ts
│   ├── profile/
│   │   ├── schema.ts       zod schema
│   │   └── load.ts         load + validate + derived locked map
│   ├── discord/
│   │   ├── bot.ts          client, intents, reaction handlers, catch-up
│   │   ├── parse.ts        extract URL/company/title from message (pure)
│   │   └── status.ts       emoji transitions, DMs
│   ├── jobs/
│   │   ├── normalize.ts    URL normalization + dedupe keys (pure)
│   │   ├── detect.ts       ATS detection from URL/page (pure + page check)
│   │   └── resolve.ts      redirects + wrapper pages → apply URL
│   ├── queue/scheduler.ts  concurrency, per-tenant locks, lifecycle events
│   ├── browser/
│   │   ├── context.ts      persistent Chrome context, new tab per job
│   │   ├── fill.ts         fillText, fillTextarea, selectNative, pickCombobox, setRadio, setCheckbox, uploadFile
│   │   ├── guard.ts        safeClick + submit regex + nav allowlist
│   │   ├── capture.ts      init script + exposed binding, confirmation detection
│   │   └── overlay.ts      highlights + checklist (V2, Phase 8)
│   ├── adapters/
│   │   ├── types.ts        AtsAdapter, FormField, FillContext, FillOutcome
│   │   ├── run.ts          common loop: discover → resolve answers → fill → log
│   │   ├── greenhouse/{index.ts, selectors.ts}
│   │   ├── lever/{index.ts, selectors.ts}
│   │   ├── ashby/{index.ts, selectors.ts}
│   │   ├── workday/{index.ts, selectors.ts, account.ts, pages.ts}
│   │   └── generic/index.ts
│   ├── answers/
│   │   ├── provider.ts     AnswerProvider interface
│   │   ├── profileProvider.ts   MVP: profile mapping + standard_answers
│   │   └── brain/          V2: normalize.ts, categorize.ts, match.ts, llm.ts, learn.ts, export.ts, drafts.ts, brainProvider.ts
│   └── secrets/keychain.ts
└── test/
    ├── unit/               normalize, parse, detect, guard, profile schema, matching, diff
    └── fixtures/           saved HTML per ATS + sample Discord message JSON
```

## Config and data paths

`APPLYPIPE_HOME` (default `~/.applypipe/`) contains:

| Path | Purpose |
|---|---|
| `.env` | secrets + settings (below) |
| `profile.yaml` | owner profile (schema below) |
| `resume.pdf` | path is set in profile; default here |
| `applypipe.db` | SQLite |
| `answer-bank.json` | V2 export / hand-edit surface |
| `chrome-profile/` | Playwright persistent user data dir — **not** the owner's everyday Chrome profile |
| `artifacts/<jobId>/` | screenshots on failure, `fill-log.json` |

`.env` keys (validated with zod at startup; missing required keys → print which ones and exit 1):

| Key | Required | Default |
|---|---|---|
| `DISCORD_TOKEN` | yes | — |
| `DISCORD_CHANNEL_ID` | yes | — |
| `DISCORD_OWNER_ID` | yes | — (only this user's ✅ counts) |
| `ANTHROPIC_API_KEY` | V2 | — |
| `ANTHROPIC_MODEL` | V2 | current Sonnet-class model ID, set in `env.example` at build time |
| `MAX_PARALLEL` | no | `3` |
| `CATCHUP_DAYS` | no | `14` |
| `LLM_CONFIDENCE_FLAG` | no | `0.7` |

## Profile schema (`profile.yaml`)

```yaml
identity:
  first_name: string
  last_name: string
  preferred_name: string?        # optional
  email: string
  phone: string                  # E.164 or local; adapters format per field
  location: { city: string, state: string, country: string, zip: string? }
links:
  linkedin: url
  github: url
  portfolio: url?
education:                        # first entry = current school
  - { school: string, degree: string, major: string, start: "YYYY-MM", end: "YYYY-MM", gpa: string? }
experience:                       # used where a form asks for work history
  - { company: string, title: string, location: string?, start: "YYYY-MM", end: "YYYY-MM | present", summary: string }
work_auth:                        # LOCKED
  authorized_us: boolean
  needs_sponsorship_now: boolean
  needs_sponsorship_future: boolean
availability:
  terms: [string]                 # e.g. ["Summer 2027"]
  earliest_start: "YYYY-MM-DD"?
  willing_to_relocate: boolean
eeo:                              # LOCKED; each value is the option text to choose, or "decline"
  gender: string
  race_ethnicity: string
  hispanic_latino: string
  veteran: string
  disability: string
resume:
  path: string                    # default ~/.applypipe/resume.pdf
workday:
  email: string                   # account email for all Workday tenants
standard_answers:                 # MVP bank seed; V2 imports these into answer_bank
  - { question: string, answer: string, locked: boolean? }
```

Derived locked categories: `work_auth`, `graduation` (from `education[0].end`), `location`, `eeo`, plus any `standard_answers` with `locked: true`.

`profile:check` validates with zod, checks the resume file exists and is a PDF, and prints each locked category's value (EEO shown as "set"/"decline", not the values).

## Data model (SQLite, `schema.sql`, migrated via `PRAGMA user_version`)

```sql
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,                 -- ULID
  discord_message_id TEXT UNIQUE,      -- null if queued another way later
  source_url TEXT NOT NULL,            -- URL found in the message
  apply_url TEXT,                      -- after resolve
  normalized_url TEXT UNIQUE,
  ats TEXT NOT NULL DEFAULT 'unknown', -- greenhouse|lever|ashby|workday|unknown
  ats_tenant TEXT,                     -- e.g. Workday host, Greenhouse board token
  req_id TEXT,                         -- requisition/job id from URL when available
  company TEXT,
  title TEXT,
  job_description TEXT,                -- captured page text (V2 grounding)
  status TEXT NOT NULL,                -- queued|filling|ready|needs_you|submitted|skipped|failed|abandoned
  needs_reason TEXT,                   -- human-readable, shown in Discord/status
  error TEXT,                          -- technical detail, not shown in Discord
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  ready_at TEXT, submitted_at TEXT
);
CREATE UNIQUE INDEX jobs_dedupe ON jobs(ats, ats_tenant, req_id) WHERE req_id IS NOT NULL;

CREATE TABLE field_fills (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  page_index INTEGER NOT NULL DEFAULT 0,   -- Workday page number, 0 for single-page
  field_key TEXT NOT NULL,                 -- adapter-stable locator id
  question_text TEXT NOT NULL,             -- visible label as shown
  question_key TEXT,                       -- normalized key (V2)
  category TEXT,                           -- identity|contact|links|education|work_auth|graduation|location|eeo|availability|why_company|why_role|general
  field_type TEXT NOT NULL,                -- text|textarea|select|combobox|radio|checkbox|file|date
  options_json TEXT,
  required INTEGER NOT NULL DEFAULT 0,
  max_length INTEGER,
  filled_value TEXT,                       -- what applypipe filled (masked if secret)
  source TEXT NOT NULL,                    -- profile|locked|bank|llm|draft|generic|none
  confidence REAL,
  flag TEXT,                               -- null|yellow|red|green
  final_value TEXT,                        -- captured at Next/Submit
  edited INTEGER,                          -- 1 if normalized final != filled
  captured_at TEXT,
  UNIQUE(job_id, page_index, field_key)
);

CREATE TABLE answer_bank (                 -- V2
  id INTEGER PRIMARY KEY,
  question_key TEXT NOT NULL,
  canonical_text TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]', -- phrasings seen
  category TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',    -- global|company
  company TEXT,                            -- set when scope=company
  answer TEXT NOT NULL,
  locked INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,                    -- profile|learned|llm|manual
  times_used INTEGER NOT NULL DEFAULT 0,
  last_confirmed_at TEXT,                  -- last time a submit kept it unedited
  updated_at TEXT NOT NULL,
  UNIQUE(question_key, scope, company)
);

CREATE TABLE workday_accounts (
  tenant_host TEXT PRIMARY KEY,            -- e.g. acme.wd5.myworkdayjobs.com
  email TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, last_login_at TEXT
);

CREATE TABLE company_drafts (              -- V2
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  company TEXT NOT NULL,
  question_text TEXT NOT NULL,
  draft TEXT NOT NULL,
  final_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: last_processed_message_id, bank_exported_at
```

What must never be lost: `answer_bank` (exported to JSON on every write). Everything else can be regenerated or re-queued.

## Module contracts

### Discord (`discord/`)

- Intents: `Guilds`, `GuildMessages`, `GuildMessageReactions`, `MessageContent`, `DirectMessages`; partials `Message`, `Reaction`, `Channel`, `User` (so reactions on uncached webhook messages fire).
- `messageReactionAdd`: ignore unless channel = `DISCORD_CHANNEL_ID`, user = `DISCORD_OWNER_ID`, emoji = ✅. Fetch partial message, then `enqueueFromMessage(msg)`.
- `messageReactionRemove` (✅ by owner): if the job is `queued`, delete it and clear bot emoji; otherwise ignore.
- Catch-up at `ready`: page backwards from the newest message until `CATCHUP_DAYS` / 500 messages; for each message with an owner ✅ that isn't already in `jobs` and doesn't carry the bot's 🔁, enqueue (oldest first). The whole window is scanned every start — stopping at `last_processed_message_id` would miss a ✅ added while offline to a post that arrived while the bot was running (D20). Update `last_processed_message_id` to the newest message scanned (kept for reference; not a stop condition).
- `parse.ts` (pure): input = `{ content, embeds: [{ url, title, description, fields: [{name, value}] }] }`. Collect all http(s) URLs from content, embed URLs, descriptions and field values. Choose the apply URL in this order: (1) a URL whose host matches a known ATS, (2) a URL on a known wrapper host (`simplify.jobs`, `github.com`), (3) the first URL that isn't Discord. Company/title: from embed title or content patterns like `**Company** — Title` / `Company | Title`; else null (filled from page later). **Default** because the real message format is unconfirmed (see `05-decisions.md` OQ1); keep parsing rules in one function with fixture tests.

### Resolve & dedupe (`jobs/`)

- `normalize(url)`: lowercase host; drop fragment; drop query params `utm_*`, `gh_src`, `source`, `ref`, `lever-source`, `src`; strip trailing slash; for Greenhouse keep `gh_jid` (company-hosted embeds). Returns `{ normalizedUrl, ats, tenant, reqId }`.
- Req ID extraction: Greenhouse `/jobs/<digits>` or `gh_jid`; Lever `/<company>/<uuid>`; Ashby `/<company>/<uuid>`; Workday the trailing `_<REQ>` path segment (e.g. `..._R12345`).
- `resolve(url)`: follow HTTP redirects (fetch, max 5). If the final host is a wrapper (`simplify.jobs`, `github.com`), open it in a background Playwright page and take the first link whose host is a known ATS or whose text matches /apply/i. If nothing resolves → job `needs_you` "couldn't find the application link".
- Dedupe: before insert, check `normalized_url` and `(ats, tenant, req_id)`; on hit, react 🔁 on the new post and don't create a job.

### ATS detection (`jobs/detect.ts`)

| ATS | Host / signal |
|---|---|
| greenhouse | `boards.greenhouse.io`, `job-boards.greenhouse.io`, or company page containing an iframe `#grnhse_iframe` / `gh_jid` param |
| lever | `jobs.lever.co` |
| ashby | `jobs.ashbyhq.com` |
| workday | `*.myworkdayjobs.com`, `*.myworkdaysite.com` |
| unknown | anything else after resolve |

### Scheduler (`queue/scheduler.ts`)

- Picks `queued` jobs oldest-first while `filling` count < `MAX_PARALLEL`. At most one `filling` job per Workday tenant (others wait).
- Lifecycle per job: set `filling` (⏳) → run adapter → set outcome status → emit event for Discord. Parked tabs stay open; `page.on('close')` on a `ready`/`needs_you` job → `abandoned`.
- When no jobs are `queued` or `filling` and at least one job finished since the last summary → send the batch summary DM.
- Unhandled adapter exception → screenshot to `artifacts/<jobId>/error.png`, status `needs_you` with reason "something broke on <page heading>", `error` = stack. Tab stays open.

### Adapter contract (`adapters/types.ts`)

```ts
type AtsId = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'unknown';

interface FormField {
  fieldKey: string;            // stable within this form (id/name/automation-id/label hash)
  label: string;               // visible question text
  type: 'text'|'textarea'|'select'|'combobox'|'radio'|'checkbox'|'file'|'date';
  options?: string[];
  required: boolean;
  maxLength?: number;
  locator: Locator;            // Playwright locator for the control
  pageIndex: number;
}

interface FillContext {
  page: Page; job: Job; profile: Profile;
  answers: AnswerProvider;
  fills: FillRecorder;         // writes field_fills rows
  credentials: { workdayEmail: string; getWorkdayPassword(): Promise<string> };
  screenshot(name: string): Promise<string>;
}

type FillOutcome =
  | { status: 'ready' }
  | { status: 'needs_you'; reason: string }
  | { status: 'skipped'; reason: string };

interface AtsAdapter {
  id: AtsId;
  run(ctx: FillContext): Promise<FillOutcome>;
}
```

Common loop in `adapters/run.ts` (adapters call it per page): `discover(page) → FormField[]` → for each field `answers.resolve(field, job)` → fill via `browser/fill.ts` → `fills.record(...)`. Fields the provider can't answer: required → flag red; optional → leave blank, no flag. If any red flag remains at the end → outcome `needs_you` "N fields need you"; else `ready`.

Closed-posting detection (all adapters): HTTP 404, or page text matching /no longer (accepting|available)|position (has been )?filled|job not found/i → `skipped` "posting closed".

### Submit guard (`browser/guard.ts`)

- `SUBMIT_RE = /\b(submit|send application|apply now|finish|complete application)\b/i`, plus exact-text "Apply" on a `button[type=submit]`.
- `safeClick(locator, { allowNav?: string[] })`: reads the control's accessible name; if it matches `SUBMIT_RE` and isn't in the adapter's nav allowlist → throw `SubmitGuardError`. Adapters must never call `locator.click()` directly (lint rule or grep test in CI: no `.click(` outside `guard.ts`).
- Workday allowlist: "Save and Continue", "Next", "Apply Manually", "Sign In", "Create Account", "Apply" **only** on the job description page before the application starts (detected by URL not containing `/apply/`).

### Fill helpers (`browser/fill.ts`)

- `fillText(locator, value)`: focus, select all, set value via the native `HTMLInputElement.prototype` value setter inside `evaluate`, dispatch `input` then `change` (bubbling), blur. Then read back; if the value didn't stick, fall back to `locator.pressSequentially(value)`.
- `pickCombobox(locator, optionText)`: click to open, type the first ~20 chars, choose the option whose normalized text equals or best-matches `optionText` (≥0.8 similarity); none → return `false` (caller flags red).
- `uploadFile(locator, path)`: `setInputFiles`; wait for the ATS's filename/parsed indicator up to 15 s.
- All helpers return `{ ok: boolean, actualValue?: string }`.

### Workday adapter (`adapters/workday/`)

Flow:
1. Job page → `safeClick('Apply')` → choose **Apply Manually**.
2. Account (`account.ts`): if a sign-in form shows, look up `workday_accounts[tenant]`. None → Create Account with `workday.email` + Keychain password, tick the account-terms checkbox if present, submit the account form (allowlisted). If the page says the email is already in use → Sign In instead. If it asks for email verification → `needs_you` "verify your email for <tenant>", keep the tab, retry Sign In every 30 s for 15 min, then continue automatically on success. Sign-in failure → `needs_you` "Workday password didn't work at <tenant>".
3. Pages (`pages.ts`): loop — identify the page by its step heading (My Information, My Experience, Application Questions, Voluntary Disclosures, Self Identify, Review); run the common loop; `safeClick('Save and Continue')`; wait for the heading to change or an error banner. Error banner → `needs_you` listing the banner's messages. Stop when the heading is **Review** → `ready`.
4. My Experience: upload resume; fill education and websites from the profile; leave work entries Workday parsed from the resume in place and flag the section yellow "check parsed work history" (**Default**, OQ3).
5. Selectors live in `selectors.ts`, keyed on `data-automation-id` attributes. Treat any selector listed there as a starting point to verify against a live tenant.

### Greenhouse / Lever / Ashby

Single-page forms. Discover all fields in the form (Greenhouse: operate inside `#grnhse_iframe` when embedded), fill, upload resume, then scroll the Submit button into view without clicking → `ready`. Greenhouse/Ashby selects are often custom comboboxes → `pickCombobox`. Ashby yes/no questions are button pairs → treat as `radio`.

### Generic adapter (unknown ATS)

Best-effort fill by matching input `name`/`id`/`autocomplete`/label text against identity, email, phone, LinkedIn, GitHub, portfolio, and the first `input[type=file]` for the resume. Always returns `needs_you` "unsupported ATS — partially filled".

### Submit capture (`browser/capture.ts`)

- `context.exposeBinding('__applypipeCapture', handler)` once per context; `context.addInitScript(captureScript)`.
- The capture script adds a capture-phase `click` listener and a `submit` listener. On a submit-like click, or a Workday Next / Save and Continue click, it serializes every visible control: `{ fieldKey, label, type, value }` using the same `fieldKey` rules as discovery (shared code, bundled as a string), then calls the binding with `{ url, kind: 'submit' | 'next', fields }`.
- Handler: match fields to `field_fills` by `(job, page_index, field_key)` (fall back to normalized label), set `final_value`, `edited`, `captured_at`. For `kind: 'submit'`, watch the page for 60 s: confirmation text (/thank you|application (has been )?(received|submitted)|we('ve| have) received/i) or a URL change to a confirmation path → `submitted` (📨), `submitted_at`; then (V2) run learning. If neither appears, keep `ready` (likely a validation error) and accept the next capture.
- The binding maps a page to its job via a `jobId` stored on the Page object when the tab was created.

### Answer provider (`answers/`)

```ts
interface Answer { value: string | null; source: 'profile'|'locked'|'bank'|'llm'|'draft'|'generic'|'none';
                   confidence?: number; flag?: 'yellow'|'red'|'green'; category: string; }
interface AnswerProvider { resolve(field: FormField, job: Job): Promise<Answer>; }
```

- **MVP `profileProvider`:** map field labels to profile paths with a keyword table (first name, last name, email, phone, city, LinkedIn, GitHub, school, degree, major, GPA, graduation, sponsorship now/future, authorized, relocate, EEO categories) and `standard_answers` by case-insensitive token overlap ≥0.8. Locked categories → flag green. No match → `{ value: null, source: 'none' }`.
- **V2 `brainProvider`** (replaces it in Phase 7, same interface), in order:
  1. **Categorize** (`categorize.ts`): keyword rules → category; ambiguous labels get categorized in the same Claude call as step 4.
  2. **Locked categories** (`work_auth`, `graduation`, `location`, `eeo`, locked standard answers) → profile value, flag green; missing → null, flag red. Never sent to Claude for generation.
  3. **Bank match** (`match.ts`): `normalizeQuestion(label)` = lowercase; strip `*`, "(required)", punctuation; collapse whitespace; drop filler words (please, kindly, are you, do you, will you); apply a synonym map (visa→sponsorship, sponsor→sponsorship, hear about→heard about, relocate→relocation). `question_key` = normalized text. Exact key or alias hit → answer. Otherwise trigram similarity against canonical text + aliases: ≥0.85 → hit; 0.55–0.85 → send the top 5 candidates to Claude, which returns `{ match: <id> | "new" }`; <0.55 → new. On a hit with a new phrasing, append it to `aliases_json`.
  4. **Claude answer** (`llm.ts`) for new questions: system prompt states the rules (answer as the applicant, concise, truthful to the profile, never invent experience, respect `maxLength`, for options choose exactly one given option). Input: profile (excluding EEO), cached resume text, job description (first 6k chars), company, title, question, type, options, maxLength. Output via a tool call: `{ category, answer, confidence (0-1) }`. Confidence < `LLM_CONFIDENCE_FLAG` → yellow, else no flag. Select/radio answers not in the options → map to the closest option, confidence ×0.8. Timeout 30 s, 1 retry, then `{ value: null, flag: 'red' }` "AI unavailable".
  5. **Why-company / why-role** (`drafts.ts`): 80–150 words (or ≤ maxLength), grounded in the JD + profile + resume; always flag yellow; stored in `company_drafts`.
  6. Option mapping for bank/profile answers on select/radio: normalized equality, then similarity ≥0.8; else Claude picks among options (yellow).

### Learning (`answers/brain/learn.ts`, V2)

Runs after a `submitted` capture. For each `field_fills` row with `edited = 1`:
- Locked category → don't touch the bank; DM "You changed '<label>' at <company> from X to Y. If that's your new answer, update profile.yaml."
- `why_company` / `why_role`, or a label containing the company name → store `final_text` on the `company_drafts` row (company scope); no global update.
- Otherwise upsert `answer_bank` (scope global, `source = 'learned'`, `answer = final_value`, add the label to aliases).

For unedited rows that came from the bank → `times_used++`, `last_confirmed_at = now`.

### Answer-bank export/import (`export.ts`)

- Every bank write schedules an export (debounced 1 s): write `answer-bank.json.tmp`, then rename over `answer-bank.json`; set `meta.bank_exported_at`.
- JSON shape: `{ version: 1, exported_at, entries: [{ question_key, canonical_text, aliases, category, scope, company, answer, locked, source }] }`.
- At startup: if the file's mtime is newer than `bank_exported_at` → validate with zod and replace bank rows from it (log a count diff). Invalid JSON → refuse to start, print the zod error path. If the file is missing and the bank is empty → seed from `profile.standard_answers`.

### Keychain (`secrets/keychain.ts`)

- Store: `security add-generic-password -U -s applypipe-workday -a <email> -w <password>` (run by `setup:password`, which reads the password with hidden input).
- Read: `security find-generic-password -s applypipe-workday -a <email> -w`. Missing → Workday jobs go `needs_you` "run npm run setup:password".
- Cache in memory for the process lifetime; never logged.

## External services and limits

| Service | Use | Failure behavior |
|---|---|---|
| Discord gateway | reactions, emoji, DMs | discord.js reconnects; emoji/DM failures are logged, never block a fill |
| ATS sites | filling | per-job `needs_you`/`skipped`; CAPTCHA detected (iframe from hcaptcha/recaptcha/challenges.cloudflare) → `needs_you` "CAPTCHA" |
| Claude API | V2 matching ties, answers, drafts | timeout 30 s, 1 retry → field blank + red |
| Keychain | Workday password | missing → Workday jobs `needs_you` |

Cost guard: at 75 apps/week and a handful of LLM calls per app, cost is small; still log token usage per job to `fill-log.json`.
