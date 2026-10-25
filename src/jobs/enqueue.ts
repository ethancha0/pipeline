import type { Db } from '../db/db.js';
import { deleteJob, getByDedupeKey, getByMessageId, getByNormalizedUrl, insertJob, jobLabel, type Job } from '../db/jobs.js';
import { parseMessage, type MessageLike } from '../discord/parse.js';
import type { SetStatusEmoji } from '../discord/status.js';
import { log } from '../log.js';
import { normalize, type NormalizedUrl } from './normalize.js';
import type { ResolveResult } from './resolve.js';

export interface FeedMessage extends MessageLike {
  id: string;
}

export interface EnqueueDeps {
  db: Db;
  resolve(url: string): Promise<ResolveResult>;
  setStatusEmoji: SetStatusEmoji;
}

export type EnqueueOutcome =
  /** New job; status is `queued`, `needs_you` (link not resolved) or `failed` (no link). */
  | { kind: 'created'; job: Job }
  /** Post resolved to an existing job; no job created, post gets 🔁. */
  | { kind: 'duplicate'; existing: Job }
  /** This message already has a job; nothing changed. */
  | { kind: 'exists'; job: Job };

/** parse → resolve → normalize → dedupe → insert, then set the post's status emoji. */
export async function enqueueFromMessage(msg: FeedMessage, deps: EnqueueDeps): Promise<EnqueueOutcome> {
  const { db } = deps;
  log.debug({ message: { id: msg.id, content: msg.content, embeds: msg.embeds } }, 'feed message');

  const already = getByMessageId(db, msg.id);
  if (already) return { kind: 'exists', job: already };

  const parsed = parseMessage(msg);
  if (!parsed.url) {
    const job = insertJob(db, {
      sourceUrl: '',
      discordMessageId: msg.id,
      company: parsed.company,
      title: parsed.title,
      status: 'failed',
      needsReason: 'no link found',
    });
    log.info(`❌ ${jobLabel(job)}: no link found`);
    await deps.setStatusEmoji(msg.id, 'failed');
    return { kind: 'created', job };
  }

  const resolved = await deps.resolve(parsed.url);
  const norm = normalize(resolved.url);

  const existing = findDuplicate(db, norm);
  if (existing) {
    log.info(`🔁 duplicate of ${jobLabel(existing)} (${existing.id.slice(0, 8)})`);
    await deps.setStatusEmoji(msg.id, 'duplicate');
    return { kind: 'duplicate', existing };
  }

  const job = insertJob(db, {
    sourceUrl: parsed.url,
    discordMessageId: msg.id,
    applyUrl: resolved.ok ? resolved.url : null,
    normalizedUrl: norm.normalizedUrl,
    ats: norm.ats,
    atsTenant: norm.tenant,
    reqId: norm.reqId,
    company: parsed.company,
    title: parsed.title,
    status: resolved.ok ? 'queued' : 'needs_you',
    needsReason: resolved.ok ? null : resolved.reason,
  });
  if (resolved.ok) log.info(`👀 ${jobLabel(job)} (${job.ats})`);
  else log.info(`⚠️ ${jobLabel(job)}: ${resolved.reason}`);
  await deps.setStatusEmoji(msg.id, job.status);
  return { kind: 'created', job };
}

export function findDuplicate(db: Db, norm: NormalizedUrl): Job | null {
  return (
    getByNormalizedUrl(db, norm.normalizedUrl) ?? (norm.reqId ? getByDedupeKey(db, norm.ats, norm.tenant, norm.reqId) : null)
  );
}

/** Owner removed ✅: drop the job if it's still `queued`, else leave it. Returns the removed job. */
export async function dequeueMessage(messageId: string, deps: Omit<EnqueueDeps, 'resolve'>): Promise<Job | null> {
  const job = getByMessageId(deps.db, messageId);
  if (!job || job.status !== 'queued') return null;
  deleteJob(deps.db, job.id);
  log.info(`✖ removed from queue: ${jobLabel(job)}`);
  await deps.setStatusEmoji(messageId, null);
  return job;
}
