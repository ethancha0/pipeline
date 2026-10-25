import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import { genericAdapter } from '../adapters/generic/index.js';
import { greenhouseAdapter } from '../adapters/greenhouse/index.js';
import type { AtsAdapter, FillContext, FillOutcome } from '../adapters/types.js';
import type { AnswerProvider } from '../answers/provider.js';
import { isAwaitingConfirmation } from '../browser/capture.js';
import { newJobTab } from '../browser/context.js';
import { showBadge } from '../browser/overlay.js';
import type { Db } from '../db/db.js';
import { recordFill } from '../db/fills.js';
import { getJob, jobLabel, listByStatus, setStatus, type AtsId, type Job } from '../db/jobs.js';
import type { SetStatusEmoji } from '../discord/status.js';
import { log } from '../log.js';
import type { Profile } from '../profile/schema.js';

/** Adapters available so far; jobs for other ATSs stay queued until their phase lands. */
const ADAPTERS: Partial<Record<AtsId, AtsAdapter>> = {
  greenhouse: greenhouseAdapter,
  unknown: genericAdapter,
};

export interface SchedulerDeps {
  db: Db;
  context: BrowserContext;
  profile: Profile;
  resumePath: string;
  answers: AnswerProvider;
  artifactsDir: string;
  maxParallel: number;
  setStatusEmoji: SetStatusEmoji;
}

export interface Scheduler {
  /** New queued work may exist. */
  notify(): void;
  /** Stop picking jobs (fills in progress keep running). */
  stop(): void;
}

const SKIPPED_TAB_CLOSE_MS = 5_000;

export function startScheduler(deps: SchedulerDeps): Scheduler {
  const { db } = deps;
  const inflight = new Set<string>();
  const announcedWaiting = new Set<string>();
  let stopped = false;

  // A crash or kill mid-fill leaves jobs in `filling`; they go back in the queue.
  for (const job of listByStatus(db, ['filling'])) setStatus(db, job.id, 'queued');

  const emojiFor = (job: Job, status: Parameters<SetStatusEmoji>[1]) =>
    job.discordMessageId ? deps.setStatusEmoji(job.discordMessageId, status) : Promise.resolve();

  function pump(): void {
    if (stopped) return;
    for (const job of listByStatus(db, ['queued'])) {
      if (inflight.size >= deps.maxParallel) break;
      if (inflight.has(job.id)) continue;
      const adapter = ADAPTERS[job.ats];
      if (!adapter) {
        if (!announcedWaiting.has(job.id)) {
          announcedWaiting.add(job.id);
          log.info(`⏸ ${jobLabel(job)} (${job.ats}) waits in the queue: no ${job.ats} adapter yet`);
        }
        continue;
      }
      inflight.add(job.id);
      void run(job, adapter).finally(() => {
        inflight.delete(job.id);
        pump();
      });
    }
  }

  async function run(job: Job, adapter: AtsAdapter): Promise<void> {
    setStatus(db, job.id, 'filling');
    log.info(`⏳ ${jobLabel(job)} (${job.ats})`);
    await emojiFor(job, 'filling');

    let page: Page | undefined;
    try {
      page = await newJobTab(deps.context, job);
      page.on('close', () => onTabClosed(job.id));
      page.on('load', () => {
        const current = getJob(db, job.id);
        if (current?.status === 'filling') void showBadge(page!, `applypipe · ${job.company ?? ''} · filling…`, 'filling');
      });

      const ctx: FillContext = {
        page,
        job,
        profile: deps.profile,
        resumePath: deps.resumePath,
        answers: deps.answers,
        fills: { record: (row) => recordFill(db, { ...row, jobId: job.id }) },
        credentials: {
          workdayEmail: deps.profile.workday.email,
          getWorkdayPassword: () => Promise.reject(new Error('Workday lands in Phase 5')),
        },
        screenshot: (name) => screenshot(page!, job.id, name),
      };
      const outcome = await adapter.run(ctx);
      await finish(job, outcome, page);
    } catch (err) {
      if (!page || page.isClosed()) {
        markAbandoned(job.id, 'tab closed during fill');
        return;
      }
      const heading = await pageHeading(page);
      const shot = await screenshot(page, job.id, 'error').catch(() => null);
      setStatus(db, job.id, 'needs_you', {
        needsReason: `something broke on ${heading}`,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
      log.error({ err, screenshot: shot }, `⚠️ ${jobLabel(job)}: something broke on ${heading}`);
      await emojiFor(job, 'needs_you');
      await showBadge(page, `applypipe · ${job.company ?? ''} · needs you: something broke`, 'needs_you');
    }
  }

  async function finish(job: Job, outcome: FillOutcome, page: Page): Promise<void> {
    if (outcome.status === 'skipped') {
      setStatus(db, job.id, 'skipped', { needsReason: outcome.reason });
      log.info(`⏭️ ${jobLabel(job)}: ${outcome.reason}`);
      await emojiFor(job, 'skipped');
      setTimeout(() => void page.close().catch(() => {}), SKIPPED_TAB_CLOSE_MS);
      return;
    }
    if (outcome.status === 'needs_you') {
      setStatus(db, job.id, 'needs_you', { needsReason: outcome.reason });
      log.info(`⚠️ ${jobLabel(job)}: ${outcome.reason}`);
      await emojiFor(job, 'needs_you');
      await showBadge(page, `applypipe · ${job.company ?? ''} · needs you: ${outcome.reason}`, 'needs_you');
      return;
    }
    setStatus(db, job.id, 'ready');
    log.info(`🟢 ${jobLabel(job)}${outcome.note ? ` (${outcome.note})` : ''}`);
    await emojiFor(job, 'ready');
    await showBadge(page, `applypipe · ${job.company ?? ''} · ready`, 'ready');
  }

  function onTabClosed(jobId: string): void {
    const job = getJob(db, jobId);
    if (!job || (job.status !== 'ready' && job.status !== 'needs_you')) return;
    if (isAwaitingConfirmation(jobId)) {
      log.warn(`${jobLabel(job)}: tab closed before a confirmation page appeared; leaving it ${job.status}`);
      return;
    }
    markAbandoned(jobId, 'tab closed without submitting');
  }

  function markAbandoned(jobId: string, why: string): void {
    const job = getJob(db, jobId);
    if (!job) return;
    setStatus(db, jobId, 'abandoned', { needsReason: why });
    log.info(`✖ ${jobLabel(job)}: ${why}`);
    void emojiFor(job, 'abandoned');
  }

  async function screenshot(page: Page, jobId: string, name: string): Promise<string> {
    const dir = join(deps.artifactsDir, jobId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, `${name}.png`);
    await page.screenshot({ path, fullPage: true });
    return path;
  }

  pump();
  return {
    notify: pump,
    stop() {
      stopped = true;
    },
  };
}

async function pageHeading(page: Page): Promise<string> {
  const h1 = await page
    .locator('h1')
    .first()
    .innerText({ timeout: 2_000 })
    .catch(() => '');
  const title = h1.trim() || (await page.title().catch(() => ''));
  return title.trim().slice(0, 80) || 'the page';
}
