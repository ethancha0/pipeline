import type { Page } from 'playwright';
import { CLOSED_RE } from '../closed.js';
import { discoverFields, fillFields, needsReason } from '../run.js';
import type { AtsAdapter, FillContext, FillOutcome, FormField } from '../types.js';
import { CLOSED_URL_PARAM, EXCLUDE, FORM, IFRAME, SUBMIT, embedUrl } from './selectors.js';

const CLOSED: FillOutcome = { status: 'skipped', reason: 'posting closed' };

/** Job id from a company page that embeds the Greenhouse iframe, if any. */
export async function tokenFromPage(page: Page, url: string): Promise<string | null> {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const src = await page
    .locator(IFRAME)
    .first()
    .getAttribute('src', { timeout: 10_000 })
    .catch(() => null);
  return src ? new URL(src, url).searchParams.get('token') : null;
}

async function bodyText(page: Page): Promise<string> {
  return page.locator('body').innerText({ timeout: 5_000 }).catch(() => '');
}

export const greenhouseAdapter: AtsAdapter = {
  id: 'greenhouse',
  async run(ctx: FillContext): Promise<FillOutcome> {
    const { page, job } = ctx;
    const token = job.reqId ?? (await tokenFromPage(page, job.applyUrl ?? job.sourceUrl));
    if (!token) return { status: 'needs_you', reason: "couldn't find the Greenhouse job id on the page" };

    const res = await page.goto(embedUrl(token), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (!res || res.status() === 404 || new URL(page.url()).searchParams.get(CLOSED_URL_PARAM) === 'true') return CLOSED;

    const form = page.locator(FORM).first();
    try {
      await form.waitFor({ state: 'visible', timeout: 20_000 });
    } catch {
      if (CLOSED_RE.test(await bodyText(page))) return CLOSED;
      return { status: 'needs_you', reason: "Greenhouse application form didn't load" };
    }
    if (CLOSED_RE.test(await bodyText(page))) return CLOSED;
    // Dropdowns only respond once React has hydrated.
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

    const root = page.locator('body');
    const seen = new Set<string>();
    const red: string[] = [];
    // Answers can reveal follow-up questions, so look again (twice at most) for fields not seen yet.
    for (let pass = 0; pass < 3; pass++) {
      const fresh: FormField[] = (await discoverFields(page.mainFrame(), FORM, EXCLUDE)).filter((f) => !seen.has(f.fieldKey));
      if (fresh.length === 0) break;
      fresh.forEach((f) => seen.add(f.fieldKey));
      const summary = await fillFields(ctx, fresh, root);
      red.push(...summary.red);
    }

    // Park: bring Submit into view for the owner. Never click it.
    await page.locator(SUBMIT).first().scrollIntoViewIfNeeded({ timeout: 5_000 }).catch(() => {});
    return red.length > 0 ? { status: 'needs_you', reason: needsReason(red) } : { status: 'ready' };
  },
};
