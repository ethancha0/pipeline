import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { createProfileProvider } from '../../src/answers/profileProvider.js';
import type { AnswerProvider } from '../../src/answers/provider.js';
import { installCapture } from '../../src/browser/capture.js';
import { PAGE_SCRIPT } from '../../src/browser/inpage.js';
import { openDb, type Db } from '../../src/db/db.js';
import { listFills } from '../../src/db/fills.js';
import { getJob, insertJob, type Job, type JobStatus } from '../../src/db/jobs.js';
import type { EmojiStatus } from '../../src/discord/status.js';
import { parseProfile } from '../../src/profile/load.js';
import { startScheduler } from '../../src/queue/scheduler.js';

// The whole Phase 3 loop against a saved Greenhouse form. Every request is answered
// locally (route), so nothing reaches Greenhouse; the "owner" edit and Submit click
// below are the test acting as the owner, and the confirmation page is fake.
let browser: Browser | undefined;
let context: BrowserContext;
let db: Db;
const emoji: [string, EmojiStatus | null][] = [];

const FORM = readFileSync(new URL('../fixtures/greenhouse/epic-embed.html', import.meta.url), 'utf8');
const FORM_TOKENS = new Set(['6232770004', '1111']);

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => undefined);
  if (!browser) return;
  context = await browser.newContext();
  await context.addInitScript({ content: PAGE_SCRIPT });
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'boards.greenhouse.io') return route.abort();
    // The saved form has no scripts or input names, so a submit is a bare GET of the form action.
    if (!url.searchParams.has('token')) {
      return route.fulfill({ contentType: 'text/html', body: '<h1>Thank you for applying!</h1>' });
    }
    const token = url.searchParams.get('token') ?? '';
    return FORM_TOKENS.has(token)
      ? route.fulfill({ contentType: 'text/html', body: FORM })
      : route.fulfill({ status: 404, body: 'Not found' });
  });
  db = openDb(':memory:').db;
}, 30_000);
afterAll(async () => browser?.close());

async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const statusOf = (job: Job) => getJob(db, job.id)?.status as JobStatus;
const tabFor = (token: string) => context.pages().find((p) => p.url().includes(`token=${token}`)) as Page;

describe('scheduler → adapter → park → capture', () => {
  it('runs the full loop', { timeout: 150_000 }, async (t) => {
    if (!browser) return t.skip();
    const loaded = parseProfile(parse(readFileSync(new URL('../../profile.example.yaml', import.meta.url), 'utf8')));
    if (!loaded.ok) throw new Error('example profile should be valid');
    const dir = mkdtempSync(join(tmpdir(), 'applypipe-e2e-'));
    const resume = join(dir, 'Alex_Example_resume.pdf');
    writeFileSync(resume, '%PDF-1.4\n%%EOF\n');
    const base = createProfileProvider(loaded.profile, loaded.locked, resume);
    // The saved form has no scripts, so dropdowns can't open; leave them for the owner.
    const answers: AnswerProvider = {
      resolve: async (f, j) => (f.type === 'combobox' ? { value: null, source: 'none', category: 'general' } : base.resolve(f, j)),
    };
    const setStatusEmoji = async (id: string, s: EmojiStatus | null) => void emoji.push([id, s]);

    const gh = (msg: string, token: string) =>
      insertJob(db, { sourceUrl: `https://careers.example.com/?gh_jid=${token}`, discordMessageId: msg, ats: 'greenhouse', reqId: token, company: 'Epic Games' });
    const submitJob = gh('m1', '6232770004');
    const closeJob = gh('m2', '1111');
    const closedPosting = gh('m3', '999');
    const workday = insertJob(db, { sourceUrl: 'https://x.wd1.myworkdayjobs.com/job/Intern_R1', discordMessageId: 'm4', ats: 'workday', reqId: 'R1' });

    await installCapture(context, { db, setStatusEmoji });
    const scheduler = startScheduler({
      db, context, profile: loaded.profile, resumePath: resume, answers,
      artifactsDir: join(dir, 'artifacts'), maxParallel: 3, setStatusEmoji,
    });

    // Parked: required dropdowns unanswered → needs_you; closed posting → skipped; Workday waits.
    const parked = (s: JobStatus) => s === 'needs_you' || s === 'ready';
    expect(await waitFor(() => statusOf(submitJob), parked)).toBe('needs_you');
    expect(await waitFor(() => statusOf(closeJob), parked)).toBe('needs_you');
    expect(await waitFor(() => statusOf(closedPosting), (s) => s === 'skipped')).toBe('skipped');
    expect(statusOf(workday)).toBe('queued');
    expect(getJob(db, submitJob.id)?.needsReason).toMatch(/^\d+ fields? needs? you$/);
    expect(emoji).toEqual(expect.arrayContaining([['m1', 'filling'], ['m1', 'needs_you'], ['m3', 'skipped']]));
    expect(listFills(db, submitJob.id).length).toBeGreaterThan(20);

    // Review badge in a shadow root.
    const page = tabFor('6232770004');
    const badge = await page.evaluate(() => document.getElementById('applypipe-overlay')?.shadowRoot?.textContent);
    expect(badge).toMatch(/^applypipe · Epic Games · needs you: /);

    // Closing a parked tab without submitting → abandoned, emoji removed.
    await tabFor('1111').close();
    expect(await waitFor(() => statusOf(closeJob), (s) => s === 'abandoned')).toBe('abandoned');
    expect(emoji).toContainEqual(['m2', 'abandoned']); // STATUS_EMOJI.abandoned is null: emoji removed

    // The owner edits a field and clicks Submit (the test acting as the owner). Required fields are
    // still empty, so the browser blocks the submit: values are captured, the job is NOT submitted.
    await page.fill('#first_name', 'Alexander');
    await page.locator('button[type="submit"]').click();
    const firstName = () => listFills(db, submitJob.id).find((f) => f.fieldKey === 'first_name');
    expect((await waitFor(firstName, (f) => f?.finalValue === 'Alexander', 5_000))?.finalValue).toBe('Alexander');
    await new Promise((r) => setTimeout(r, 2_000));
    expect(statusOf(submitJob)).toBe('needs_you');

    // The owner completes the form and submits again → confirmation page → submitted 📨.
    await page.evaluate(() => {
      (document.querySelector('form') as HTMLFormElement).noValidate = true; // stands in for filling the rest
    });
    await page.locator('button[type="submit"]').click();
    expect(await waitFor(() => statusOf(submitJob), (s) => s === 'submitted', 20_000)).toBe('submitted');
    expect(emoji).toContainEqual(['m1', 'submitted']);
    const fills = Object.fromEntries(listFills(db, submitJob.id).map((f) => [f.fieldKey, f]));
    expect(fills.first_name).toMatchObject({ filledValue: 'Alex', finalValue: 'Alexander', edited: true });
    expect(fills.last_name).toMatchObject({ filledValue: 'Example', finalValue: 'Example', edited: false });
    expect(getJob(db, submitJob.id)?.submittedAt).not.toBeNull();

    // The skipped posting's tab closes on its own after 5 s.
    await waitFor(() => context.pages().some((p) => p.url().includes('token=999')), (open) => !open, 10_000);
    expect(context.pages().some((p) => p.url().includes('token=999'))).toBe(false);
    scheduler.stop();
  });
});
