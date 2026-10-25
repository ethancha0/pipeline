import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../../src/db/db.js';
import { getByMessageId, listByStatus, setStatus } from '../../src/db/jobs.js';
import { getMeta } from '../../src/db/meta.js';
import { catchUp, type CatchupMessage } from '../../src/discord/catchup.js';
import type { EmojiStatus } from '../../src/discord/status.js';
import { dequeueMessage, enqueueFromMessage, type FeedMessage } from '../../src/jobs/enqueue.js';
import type { ResolveResult } from '../../src/jobs/resolve.js';

let db: Db;
let emoji: [string, EmojiStatus | null][];
let deps: Parameters<typeof enqueueFromMessage>[1];

const identity = async (url: string): Promise<ResolveResult> =>
  url.includes('simplify.jobs') ? { ok: false, url, reason: 'wrapper link — resolver lands in Phase 3' } : { ok: true, url };

beforeEach(() => {
  db = openDb(':memory:').db;
  emoji = [];
  deps = { db, resolve: identity, setStatusEmoji: vi.fn(async (id, s) => void emoji.push([id, s])) };
});

const post = (id: string, content: string): FeedMessage => ({ id, content, embeds: [] });

describe('enqueueFromMessage', () => {
  it('queues a post with an ATS link and reacts 👀', async () => {
    const out = await enqueueFromMessage(
      post('100', '**Acme** — SWE Intern https://boards.greenhouse.io/acme/jobs/1?gh_src=x'),
      deps,
    );
    expect(out.kind).toBe('created');
    expect(getByMessageId(db, '100')).toMatchObject({
      status: 'queued',
      ats: 'greenhouse',
      atsTenant: 'acme',
      reqId: '1',
      company: 'Acme',
      title: 'SWE Intern',
      applyUrl: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=x',
      normalizedUrl: 'https://boards.greenhouse.io/acme/jobs/1',
    });
    expect(emoji).toEqual([['100', 'queued']]);
  });

  it('dedupes tracking variants of the same job and reacts 🔁 (F2)', async () => {
    await enqueueFromMessage(post('100', 'https://boards.greenhouse.io/acme/jobs/1?utm_source=a'), deps);
    const out = await enqueueFromMessage(post('101', 'https://boards.greenhouse.io/acme/jobs/1?gh_src=b'), deps);
    expect(out.kind).toBe('duplicate');
    expect(listByStatus(db)).toHaveLength(1);
    expect(getByMessageId(db, '101')).toBeNull();
    expect(emoji.at(-1)).toEqual(['101', 'duplicate']);
  });

  it('dedupes on (ats, tenant, req id) across URL shapes', async () => {
    await enqueueFromMessage(post('100', 'https://boards.greenhouse.io/acme/jobs/1'), deps);
    const out = await enqueueFromMessage(post('101', 'https://job-boards.greenhouse.io/acme/jobs/1'), deps);
    expect(out.kind).toBe('duplicate');
  });

  it('marks a post with no link failed and reacts ❌', async () => {
    await enqueueFromMessage(post('100', 'no links here'), deps);
    expect(getByMessageId(db, '100')).toMatchObject({ status: 'failed', needsReason: 'no link found' });
    expect(emoji).toEqual([['100', 'failed']]);
  });

  it('marks an unresolved wrapper link needs_you and reacts ⚠️', async () => {
    await enqueueFromMessage(post('100', 'https://simplify.jobs/p/abc'), deps);
    expect(getByMessageId(db, '100')).toMatchObject({
      status: 'needs_you',
      needsReason: 'wrapper link — resolver lands in Phase 3',
      applyUrl: null,
    });
    expect(emoji).toEqual([['100', 'needs_you']]);
  });

  it('is a no-op for a message that already has a job', async () => {
    await enqueueFromMessage(post('100', 'https://jobs.lever.co/a/b'), deps);
    const out = await enqueueFromMessage(post('100', 'https://jobs.lever.co/a/b'), deps);
    expect(out.kind).toBe('exists');
    expect(listByStatus(db)).toHaveLength(1);
    expect(emoji).toHaveLength(1);
  });
});

describe('LinkedIn / Indeed posts', () => {
  it('become needs_you "apply manually" without any request', async () => {
    const { resolve } = await import('../../src/jobs/resolve.js');
    const fetch = vi.fn();
    deps.resolve = (url) => resolve(url, { fetch });
    await enqueueFromMessage(
      { id: '100', content: '', embeds: [{ url: 'https://www.linkedin.com/jobs/view/4012345678', title: 'SWE Intern — Acme' }] },
      deps,
    );
    expect(getByMessageId(db, '100')).toMatchObject({
      status: 'needs_you',
      needsReason: 'LinkedIn link — apply manually',
      company: 'Acme',
      title: 'SWE Intern',
    });
    expect(emoji).toEqual([['100', 'needs_you']]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('dequeueMessage', () => {
  it('deletes a queued job and clears the emoji', async () => {
    await enqueueFromMessage(post('100', 'https://jobs.lever.co/a/b'), deps);
    expect(await dequeueMessage('100', deps)).not.toBeNull();
    expect(getByMessageId(db, '100')).toBeNull();
    expect(emoji.at(-1)).toEqual(['100', null]);
  });

  it('leaves non-queued jobs alone', async () => {
    await enqueueFromMessage(post('100', 'https://jobs.lever.co/a/b'), deps);
    setStatus(db, getByMessageId(db, '100')!.id, 'ready');
    expect(await dequeueMessage('100', deps)).toBeNull();
    expect(getByMessageId(db, '100')?.status).toBe('ready');
  });
});

describe('catchUp', () => {
  const NOW = Date.UTC(2026, 9, 24);
  const DAY = 24 * 3600 * 1000;

  function msg(id: string, content: string, opts: { ageDays?: number; owner?: boolean; dupMark?: boolean } = {}): CatchupMessage {
    return {
      ...post(id, content),
      createdTimestamp: NOW - (opts.ageDays ?? 1) * DAY,
      botMarkedDuplicate: opts.dupMark ?? false,
      ownerChecked: async () => opts.owner ?? false,
    };
  }

  /** Serves `messages` (newest first) in pages of `size`, honouring `before`. */
  function source(messages: CatchupMessage[], size = 2) {
    return {
      fetchPage: vi.fn(async (before?: string) => {
        const start = before ? messages.findIndex((m) => m.id === before) + 1 : 0;
        return messages.slice(start, start + size);
      }),
    };
  }

  const run = (src: ReturnType<typeof source>, maxMessages?: number) =>
    catchUp(src, { db, days: 14, now: NOW, maxMessages, enqueue: (m) => enqueueFromMessage(m, deps) });

  it('queues owner-✅ posts oldest first, flags duplicates, and is idempotent across restarts', async () => {
    // An existing job from an earlier run.
    await enqueueFromMessage(post('050', 'https://jobs.lever.co/acme/aaaaaaaa-1111-2222-3333-444444444444'), deps);
    emoji = [];
    const messages = [
      msg('400', 'not reacted https://jobs.lever.co/x/y'),
      msg('300', 'dup https://jobs.lever.co/acme/aaaaaaaa-1111-2222-3333-444444444444?lever-source=x', { owner: true }),
      msg('200', 'B https://boards.greenhouse.io/b/jobs/2', { owner: true }),
      msg('100', 'A https://boards.greenhouse.io/a/jobs/1', { owner: true }),
    ];

    const first = await run(source(messages));
    expect(first).toEqual({ scanned: 4, queued: 2, duplicates: 1, other: 0 });
    expect(listByStatus(db, ['queued']).map((j) => j.discordMessageId)).toEqual(['050', '100', '200']);
    expect(emoji).toEqual([
      ['100', 'queued'],
      ['200', 'queued'],
      ['300', 'duplicate'],
    ]);
    expect(getMeta(db, 'last_processed_message_id')).toBe('400');

    // Second restart: the bot's 🔁 is now on 300; nothing new.
    messages[1] = { ...messages[1]!, botMarkedDuplicate: true };
    const second = await run(source(messages));
    expect(second).toEqual({ scanned: 4, queued: 0, duplicates: 0, other: 0 });
    expect(listByStatus(db)).toHaveLength(3);
  });

  it('picks up a ✅ added offline to a post older than the last processed one', async () => {
    const messages = [msg('200', 'https://jobs.lever.co/x/new'), msg('100', 'https://jobs.lever.co/x/old')];
    await run(source(messages));
    expect(listByStatus(db)).toHaveLength(0);

    messages[1] = msg('100', 'https://jobs.lever.co/x/old', { owner: true });
    const result = await run(source(messages));
    expect(result.queued).toBe(1);
  });

  it('stops at the day window and the message cap', async () => {
    const messages = [
      msg('300', 'https://jobs.lever.co/x/1', { owner: true }),
      msg('200', 'https://jobs.lever.co/x/2', { owner: true }),
      msg('100', 'https://jobs.lever.co/x/3', { owner: true, ageDays: 20 }),
    ];
    expect((await run(source(messages))).scanned).toBe(2);
    db = openDb(':memory:').db;
    deps.db = db;
    expect((await run(source(messages), 1)).scanned).toBe(1);
  });

  it('asks Discord for reaction users only for unhandled posts', async () => {
    await enqueueFromMessage(post('100', 'https://jobs.lever.co/x/1'), deps);
    const checked = vi.fn(async () => true);
    await run(source([{ ...msg('100', 'https://jobs.lever.co/x/1'), ownerChecked: checked }]));
    expect(checked).not.toHaveBeenCalled();
  });
});
