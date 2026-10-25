# 05 — Decisions

## Decision log

| # | Decision | Why |
|---|---|---|
| D1 | Never auto-submit; stop on the review page | Owner wants final control; avoids bad or spammy submissions |
| D2 | Trigger = ✅ reaction on the existing webhook post, read by a bot running locally | Webhooks can't take button clicks; a local gateway bot needs no hosting; reactions work from a phone |
| D3 | Manual pick per posting (no auto-queue by filters) | Quality over volume |
| D4 | Review in tabs in a dedicated Chrome window | Simplest review surface; no extra UI to build |
| D5 | Volume target 20–75/week → `MAX_PARALLEL=3` | Enough throughput; low bot-detection and LLM cost |
| D6 | Unknown ATS → open, generic-fill, `needs_you` | Doesn't lose jobs; add adapters when an ATS keeps recurring |
| D7 | One shared Workday password, stored in macOS Keychain | Owner's choice for simplicity; Keychain keeps it out of files |
| D8 | Low confidence → fill best guess + yellow highlight | Fastest review; edits become training data |
| D9 | Profile = hand-edited YAML | Accurate; one-time ~20 min |
| D10 | EEO answers filled from the profile | Owner's choice |
| D11 | Edits update answers globally; company-specific questions stay per-company | Matches how the owner answers most questions |
| D12 | Personal data outside the repo (`~/.applypipe`) | May go public later |
| D13 | TypeScript + Playwright (real Chrome) + discord.js + SQLite + Claude | Owner's stack; one language including in-page scripts |
| D14 | Matching: local fuzzy first, Claude only for ambiguous cases | Cheap, explainable, good enough at this volume |
| D15 | Manual `npm start`, catch-up at startup | No surprise Chrome windows; reactions queue while offline |
| D16 | Status = emoji on the original post + one summary DM per batch | Glanceable, low noise |
| D17 | Review aid = highlights + checklist | Catches flags on earlier Workday pages |
| D18 | Answer bank UI = the exported JSON file | Zero UI to build |
| D19 | Why-us drafts from JD + profile only | Fast and cheap; owner adds the specific hook while reviewing |
| D20 | Catch-up scans the full `CATCHUP_DAYS` / 500-message window on every start instead of stopping at `last_processed_message_id` | A ✅ added offline to a post older than the last one scanned would otherwise be missed (the Phase 2 restart check); cost is ≤5 history pages plus one reaction lookup per unhandled ✅ post |
| D21 | LinkedIn/Indeed links → `needs_you` "apply manually", never fetched or opened | ~60% of the live feed is LinkedIn/Indeed; automating them breaks their terms and risks the owner's accounts. Owner's choice (2026-10-24). Better fix lives upstream: have the scraper post the company's direct apply URL (e.g. JobSpy `job_url_direct`) when available |

## Rejected alternatives

- **Chrome extension + local server** (instead of Playwright): runs in the everyday browser and is less detectable, but needs extension↔server messaging and MV3 service workers get killed. Revisit only if bot detection becomes a real problem.
- **Python stack:** fine, but the in-page code would still be JS.
- **Embeddings for matching:** needs a separate provider (Anthropic has no embeddings API) and is harder to debug.
- **Claude for every question:** slower and costlier per application.
- **Auto-start via launchd:** queued jobs would fill while the owner is away, but Chrome windows would appear unexpectedly; not worth it for v1.
- **Thread per job in Discord:** too noisy.
- **Leave low-confidence answers blank:** slower review.
- **Unique password per Workday tenant:** safer; rejected by the owner for simplicity. Switching later is contained in `secrets/keychain.ts` + `workday/account.ts` (account = tenant).
- **Existing tools (Simplify, Jobright, JobPrefill):** none combine account creation, page progression and a learning answer bank while leaving the final submit to the user.

## Defaults the build should use (owner may revisit)

- Submit capture also fires on Workday Next / Save and Continue, so edits on earlier pages are learned.
- Dedupe on normalized URL and on (ATS, tenant, req ID).
- Removing ✅ only dequeues jobs still `queued`.
- Catch-up window: 14 days or 500 messages.
- Confidence threshold 0.7 (`LLM_CONFIDENCE_FLAG`).
- Why-us drafts are 80–150 words unless the field limit is lower.
- Workday: "Apply Manually" rather than Workday's own resume autofill.
- Skipped tabs auto-close after 5 s; abandoned jobs can be requeued with ✅.
- Email verification: retry sign-in every 30 s for 15 min.

## Open questions (with the interim default to build)

- **OQ1 — Webhook message format (affects Phase 2).** *Resolved 2026-10-24 from the live channel:* posts are embed-only — embed `url` is the apply link (direct to the ATS/job board; no Simplify/GitHub wrappers seen in 100 posts), embed `title` is `Title — Company`, `description` is the location, fields `Posted` and `Source` (e.g. "Greenhouse (direct)", "LinkedIn", "Indeed"). The channel also carries scraper status posts with no link. Fixtures: `test/fixtures/discord/real-*.json`. The parser still searches content and fields so other formats work.
- **OQ2 — Shared Workday password.** One leak exposes every tenant. *Interim:* shared password as decided; keep `account.ts` written so a per-tenant password is a small change.
- **OQ3 — Workday parsed work history.** Whether to keep the entries Workday parses from the resume or replace them from `profile.experience`. *Interim:* keep the parsed entries and flag the section yellow.
- **OQ4 — Confidence threshold.** 0.7 is a guess; tune it after ~20 applications by checking how often yellow answers were edited (`field_fills`).
- **OQ5 — Bot detection on Workday/Greenhouse.** If CAPTCHAs become frequent, lower `MAX_PARALLEL` and add random 300–900 ms delays between fields before considering the extension route.
