import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { greenhouseAdapter } from '../../src/adapters/greenhouse/index.js';
import type { FillContext } from '../../src/adapters/types.js';
import { createProfileProvider } from '../../src/answers/profileProvider.js';
import type { AnswerProvider } from '../../src/answers/provider.js';
import { pickCombobox } from '../../src/browser/fill.js';
import { PAGE_SCRIPT } from '../../src/browser/inpage.js';
import type { FillRow } from '../../src/db/fills.js';
import type { Job } from '../../src/db/jobs.js';
import { parseProfile } from '../../src/profile/load.js';

// Real installed Chrome, headless. Skipped where Chrome isn't installed.
let browser: Browser | undefined;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() => undefined);
});
afterAll(async () => browser?.close());
beforeEach(async (t) => {
  if (!browser) return t.skip();
  const context = await browser.newContext();
  await context.addInitScript({ content: PAGE_SCRIPT });
  page = await context.newPage();
});

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('pickCombobox', () => {
  beforeEach(async () => {
    await page.setContent(fixture('combobox.html'));
  });
  const body = () => page.locator('body');

  it('picks from the open list and accepts a shorter displayed value', async () => {
    const r = await pickCombobox(page.locator('#country'), 'United States', body());
    expect(r).toEqual({ ok: true, actualValue: 'United States' });
  });

  it('searches when options only appear after typing', async () => {
    const r = await pickCombobox(page.locator('#school'), 'University of California, Irvine', body());
    expect(r).toEqual({ ok: true, actualValue: 'University of California - Irvine' });
  });

  it('reports failure (and selects nothing) when no option matches', async () => {
    const r = await pickCombobox(page.locator('#answer'), 'Maybe', body());
    expect(r.ok).toBe(false);
    expect(await page.locator('#answer-wrap .select__single-value').isHidden()).toBe(true);
  });

  it('never submits the form', async () => {
    await pickCombobox(page.locator('#answer'), 'No', body());
    expect(await page.evaluate(() => (window as unknown as { __submitted?: boolean }).__submitted ?? false)).toBe(false);
  });
});

describe('greenhouse adapter on a saved form', () => {
  const profileData = parse(readFileSync(new URL('../../profile.example.yaml', import.meta.url), 'utf8'));
  const loaded = parseProfile(profileData);
  if (!loaded.ok) throw new Error('example profile should be valid');
  const dir = mkdtempSync(join(tmpdir(), 'applypipe-gh-'));
  const resume = join(dir, 'Alex_Example_resume.pdf');
  writeFileSync(resume, '%PDF-1.4\n%%EOF\n');

  // The saved page has no scripts, so its dropdowns can't open; they're covered above.
  const base = createProfileProvider(loaded.profile, loaded.locked, resume);
  const answers: AnswerProvider = {
    resolve: async (field, job) => (field.type === 'combobox' ? { value: null, source: 'none', category: 'general' } : base.resolve(field, job)),
  };

  function ctx(token: string, rows: Omit<FillRow, 'jobId'>[]): FillContext {
    return {
      page,
      job: { id: 'test', reqId: token, applyUrl: null, sourceUrl: '', company: 'Epic Games' } as Job,
      profile: loaded.ok ? loaded.profile : (null as never),
      resumePath: resume,
      answers,
      fills: { record: (row) => rows.push(row) },
      credentials: { workdayEmail: '', getWorkdayPassword: async () => '' },
      screenshot: async () => '',
    };
  }

  beforeEach(async () => {
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'https://boards.greenhouse.io/embed/job_app?token=6232770004') {
        return route.fulfill({ status: 200, contentType: 'text/html', body: fixture('greenhouse/epic-embed.html') });
      }
      if (url.startsWith('https://boards.greenhouse.io/embed/job_app')) return route.fulfill({ status: 404, body: 'Not found' });
      return route.abort();
    });
  });

  it('discovers the fields, fills them, attaches the resume, parks without submitting', { timeout: 90_000 }, async () => {
    const rows: Omit<FillRow, 'jobId'>[] = [];
    let submitted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST') submitted = true;
    });

    const outcome = await greenhouseAdapter.run(ctx('6232770004', rows));

    const labels = rows.map((r) => r.questionText);
    expect(labels).toEqual(
      expect.arrayContaining(['First Name', 'Last Name', 'Email', 'Phone', 'Resume/CV', 'School', 'Gender Identity', 'LinkedIn Profile']),
    );
    expect(labels).not.toContain('Search'); // the phone widget's country search is excluded
    expect(rows.find((r) => r.questionText === 'Resume/CV')).toMatchObject({ fieldType: 'file', required: true, filledValue: 'Alex_Example_resume.pdf' });
    expect(rows.find((r) => r.questionText === 'Country')).toMatchObject({ fieldType: 'combobox', required: true });
    expect(rows.find((r) => r.questionText === 'Preferred First Name')).toMatchObject({ required: false });

    expect(await page.inputValue('#first_name')).toBe('Alex');
    expect(await page.inputValue('#last_name')).toBe('Example');
    expect(await page.inputValue('#email')).toBe('alex@example.com');
    expect(await page.inputValue('#phone')).toBe('555-555-0100');
    expect(await page.inputValue('#question_20370949004')).toBe('https://www.linkedin.com/in/your-handle');
    expect(await page.locator('#resume').evaluate((el) => (el as HTMLInputElement).files?.[0]?.name)).toBe('Alex_Example_resume.pdf');

    // Unanswered required dropdowns → needs you; nothing was submitted.
    expect(outcome.status).toBe('needs_you');
    expect(rows.filter((r) => r.flag === 'red').length).toBeGreaterThan(0);
    expect(submitted).toBe(false);
  });

  it('skips a closed posting (404)', async () => {
    const outcome = await greenhouseAdapter.run(ctx('999', []));
    expect(outcome).toEqual({ status: 'skipped', reason: 'posting closed' });
  });
});
