import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, SCHEMA_VERSION } from '../../src/db/db.js';
import { getByMessageId, getByNormalizedUrl, getJob, insertJob, listByStatus, setStatus } from '../../src/db/jobs.js';
import { getMeta, setMeta } from '../../src/db/meta.js';

const TABLES = ['answer_bank', 'company_drafts', 'field_fills', 'jobs', 'meta', 'workday_accounts'];

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'applypipe-db-'));
  file = join(dir, 'applypipe.db');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('migrations', () => {
  it('create every table and run twice without error', () => {
    const first = openDb(file);
    expect(first.migration).toEqual({ from: 0, to: SCHEMA_VERSION });
    const tables = first.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(TABLES);
    expect(first.db.pragma('journal_mode', { simple: true })).toBe('wal');
    first.db.close();

    const second = openDb(file);
    expect(second.migration).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION });
    expect(second.db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    second.db.close();
  });
});

describe('jobs queries', () => {
  it('insert, look up, change status, list', () => {
    const { db } = openDb(file);
    const job = insertJob(db, {
      sourceUrl: 'https://boards.greenhouse.io/acme/jobs/123?gh_src=x',
      discordMessageId: '111111111111111111',
      normalizedUrl: 'https://boards.greenhouse.io/acme/jobs/123',
      ats: 'greenhouse',
      atsTenant: 'acme',
      reqId: '123',
    });
    expect(job.status).toBe('queued');
    expect(getByMessageId(db, '111111111111111111')?.id).toBe(job.id);
    expect(getByNormalizedUrl(db, 'https://boards.greenhouse.io/acme/jobs/123')?.id).toBe(job.id);

    setStatus(db, job.id, 'needs_you', { needsReason: '2 fields need you' });
    expect(getJob(db, job.id)).toMatchObject({ status: 'needs_you', needsReason: '2 fields need you' });

    setStatus(db, job.id, 'ready');
    const ready = getJob(db, job.id)!;
    expect(ready.needsReason).toBeNull();
    expect(ready.readyAt).not.toBeNull();

    expect(listByStatus(db, ['ready']).map((j) => j.id)).toEqual([job.id]);
    expect(listByStatus(db, ['queued'])).toEqual([]);
    expect(listByStatus(db)).toHaveLength(1);
    db.close();
  });

  it('enforces dedupe on normalized_url and (ats, tenant, req_id)', () => {
    const { db } = openDb(file);
    const base = { sourceUrl: 'https://jobs.lever.co/acme/abc', ats: 'lever' as const, atsTenant: 'acme', reqId: 'abc' };
    insertJob(db, { ...base, normalizedUrl: 'https://jobs.lever.co/acme/abc' });
    expect(() => insertJob(db, { ...base, normalizedUrl: 'https://jobs.lever.co/acme/abc' })).toThrow(/UNIQUE/);
    expect(() => insertJob(db, { ...base, normalizedUrl: 'https://jobs.lever.co/acme/abc/apply' })).toThrow(/UNIQUE/);
    db.close();
  });

  it('setStatus on an unknown id throws', () => {
    const { db } = openDb(file);
    expect(() => setStatus(db, 'nope', 'ready')).toThrow(/no job/);
    db.close();
  });
});

describe('meta', () => {
  it('gets and upserts values', () => {
    const { db } = openDb(file);
    expect(getMeta(db, 'last_processed_message_id')).toBeNull();
    setMeta(db, 'last_processed_message_id', '1');
    setMeta(db, 'last_processed_message_id', '2');
    expect(getMeta(db, 'last_processed_message_id')).toBe('2');
    db.close();
  });
});
