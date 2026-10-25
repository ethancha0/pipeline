import type { BrowserContext, Page } from 'playwright';
import type { Db } from '../db/db.js';
import { captureFinalValues, type CapturedField } from '../db/fills.js';
import { getJob, jobLabel, setStatus } from '../db/jobs.js';
import type { SetStatusEmoji } from '../discord/status.js';
import { log } from '../log.js';
import { jobIdOf } from './context.js';
import { showBadge } from './overlay.js';

export const CONFIRMATION_RE = /thank you|application (has been )?(received|submitted)|we('ve| have) received/i;
const CONFIRMATION_PATH = /confirm|thank|submitted|success/i;
const WATCH_MS = 60_000;

export interface CapturePayload {
  kind: 'submit' | 'next';
  url: string;
  fields: CapturedField[];
}

export interface CaptureDeps {
  db: Db;
  setStatusEmoji: SetStatusEmoji;
}

/** Jobs whose owner just clicked Submit and whose confirmation we're watching for. */
const watching = new Set<string>();

export function isAwaitingConfirmation(jobId: string): boolean {
  return watching.has(jobId);
}

/**
 * Record final values when the owner clicks Submit (or a Workday Next), then
 * watch up to 60 s for a confirmation page → `submitted` 📨. applypipe only
 * listens here; the click is always the owner's.
 */
export async function installCapture(context: BrowserContext, deps: CaptureDeps): Promise<void> {
  await context.exposeBinding('__applypipeCapture', (source, payload: CapturePayload) => {
    try {
      handleCapture(source.page, payload, deps);
    } catch (err) {
      log.error({ err }, 'capture failed');
    }
  });
}

function handleCapture(page: Page, payload: CapturePayload, deps: CaptureDeps): void {
  const jobId = jobIdOf(page);
  if (!jobId) return;
  const job = getJob(deps.db, jobId);
  if (!job) return;

  // Single-page ATSs use page 0; Workday page tracking lands in Phase 5.
  const edited = captureFinalValues(deps.db, jobId, 0, payload.fields);
  log.info(`captured ${payload.fields.length} fields for ${jobLabel(job)} (${edited} changed by you)`);

  if (payload.kind === 'submit' && !watching.has(jobId)) {
    watching.add(jobId);
    void watchForConfirmation(page, jobId, payload.url, deps).finally(() => watching.delete(jobId));
  }
}

async function pageText(page: Page): Promise<string> {
  const texts = await Promise.all(
    page.frames().map((f) => f.locator('body').innerText({ timeout: 2_000 }).catch(() => '')),
  );
  return texts.join('\n');
}

async function watchForConfirmation(page: Page, jobId: string, submitUrl: string, deps: CaptureDeps): Promise<void> {
  const deadline = Date.now() + WATCH_MS;
  // If the form itself already says "thank you", only a move to a confirmation URL counts.
  const textCounts = !CONFIRMATION_RE.test(await pageText(page));
  while (Date.now() < deadline && !page.isClosed()) {
    await new Promise((r) => setTimeout(r, 1_000));
    if (page.isClosed()) break;
    const url = page.url();
    const moved = url !== submitUrl && CONFIRMATION_PATH.test(new URL(url).pathname + new URL(url).search);
    if (moved || (textCounts && CONFIRMATION_RE.test(await pageText(page)))) {
      setStatus(deps.db, jobId, 'submitted');
      const job = getJob(deps.db, jobId);
      log.info(`📨 submitted: ${job ? jobLabel(job) : jobId}`);
      if (job?.discordMessageId) await deps.setStatusEmoji(job.discordMessageId, 'submitted');
      await showBadge(page, `applypipe · ${job?.company ?? ''} · submitted`, 'submitted');
      return;
    }
  }
  // No confirmation: probably a validation error. Stay `ready` and accept the next capture.
}
