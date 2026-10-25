-- Migration 1: initial schema (02-architecture.md → Data model).
-- db.ts applies migrations in order and records progress in PRAGMA user_version.

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
CREATE INDEX jobs_status ON jobs(status, created_at);

CREATE TABLE field_fills (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
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
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  company TEXT NOT NULL,
  question_text TEXT NOT NULL,
  draft TEXT NOT NULL,
  final_text TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- keys: last_processed_message_id, bank_exported_at
