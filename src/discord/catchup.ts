import type { Db } from '../db/db.js';
import { getByMessageId } from '../db/jobs.js';
import { setMeta } from '../db/meta.js';
import type { EnqueueOutcome, FeedMessage } from '../jobs/enqueue.js';

export interface CatchupMessage extends FeedMessage {
  createdTimestamp: number;
  /** The bot already reacted 🔁 (a duplicate post, which has no job row). */
  botMarkedDuplicate: boolean;
  /** Whether the owner reacted ✅; may call the Discord API, so only asked when needed. */
  ownerChecked(): Promise<boolean>;
}

export interface CatchupSource {
  /** Up to 100 messages older than `before` (newest first); empty when exhausted. */
  fetchPage(before?: string): Promise<CatchupMessage[]>;
}

export interface CatchupOptions {
  db: Db;
  days: number;
  maxMessages?: number;
  now?: number;
  enqueue(msg: FeedMessage): Promise<EnqueueOutcome>;
}

export interface CatchupResult {
  scanned: number;
  queued: number;
  duplicates: number;
  /** Jobs created as needs_you / failed (unresolved or no link). */
  other: number;
}

/**
 * Scan the channel back CATCHUP_DAYS / 500 messages and enqueue (oldest first)
 * every post with an owner ✅ that isn't handled yet. The whole window is
 * scanned each start: a ✅ added offline to an older post must still count.
 */
export async function catchUp(source: CatchupSource, opts: CatchupOptions): Promise<CatchupResult> {
  const maxMessages = opts.maxMessages ?? 500;
  const cutoff = (opts.now ?? Date.now()) - opts.days * 24 * 3600 * 1000;
  const pending: CatchupMessage[] = [];
  let scanned = 0;
  let newestId: string | null = null;
  let before: string | undefined;

  scan: while (scanned < maxMessages) {
    const page = await source.fetchPage(before);
    if (page.length === 0) break;
    for (const msg of page) {
      if (msg.createdTimestamp < cutoff || scanned >= maxMessages) break scan;
      newestId ??= msg.id;
      scanned++;
      if (msg.botMarkedDuplicate || getByMessageId(opts.db, msg.id)) continue;
      if (await msg.ownerChecked()) pending.push(msg);
    }
    before = page.at(-1)!.id;
  }

  const result: CatchupResult = { scanned, queued: 0, duplicates: 0, other: 0 };
  for (const msg of pending.reverse()) {
    const outcome = await opts.enqueue(msg);
    if (outcome.kind === 'duplicate') result.duplicates++;
    else if (outcome.kind === 'created' && outcome.job.status === 'queued') result.queued++;
    else if (outcome.kind === 'created') result.other++;
  }

  if (newestId) setMeta(opts.db, 'last_processed_message_id', newestId);
  return result;
}
