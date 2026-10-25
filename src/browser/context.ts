import { chromium, type BrowserContext, type Page } from 'playwright';
import type { Job } from '../db/jobs.js';
import { PAGE_SCRIPT } from './inpage.js';

/** Which job each tab belongs to (the capture binding maps a page back to its job). */
const pageJobs = new WeakMap<Page, string>();

export function jobIdOf(page: Page): string | undefined {
  return pageJobs.get(page);
}

/**
 * Launch installed Chrome with applypipe's own persistent profile (not the owner's
 * everyday one), headed, with the in-page helpers injected into every frame.
 */
export async function launchBrowser(profileDir: string): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  });
  await context.addInitScript({ content: PAGE_SCRIPT });
  return context;
}

/** A new tab for this job, remembered so capture and close events map back to it. */
export async function newJobTab(context: BrowserContext, job: Job): Promise<Page> {
  const page = await context.newPage();
  pageJobs.set(page, job.id);
  return page;
}
