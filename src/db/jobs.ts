import { monotonicFactory } from 'ulid';
import { nowIso, type Db } from './db.js';

// Monotonic so jobs created in the same millisecond still sort in insertion order.
const ulid = monotonicFactory();

export const JOB_STATUSES = [
  'queued',
  'filling',
  'ready',
  'needs_you',
  'submitted',
  'skipped',
  'failed',
  'abandoned',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export type AtsId = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'unknown';

export interface Job {
  id: string;
  discordMessageId: string | null;
  sourceUrl: string;
  applyUrl: string | null;
  normalizedUrl: string | null;
  ats: AtsId;
  atsTenant: string | null;
  reqId: string | null;
  company: string | null;
  title: string | null;
  jobDescription: string | null;
  status: JobStatus;
  needsReason: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
  submittedAt: string | null;
}

interface JobRow {
  id: string;
  discord_message_id: string | null;
  source_url: string;
  apply_url: string | null;
  normalized_url: string | null;
  ats: AtsId;
  ats_tenant: string | null;
  req_id: string | null;
  company: string | null;
  title: string | null;
  job_description: string | null;
  status: JobStatus;
  needs_reason: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  submitted_at: string | null;
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    discordMessageId: r.discord_message_id,
    sourceUrl: r.source_url,
    applyUrl: r.apply_url,
    normalizedUrl: r.normalized_url,
    ats: r.ats,
    atsTenant: r.ats_tenant,
    reqId: r.req_id,
    company: r.company,
    title: r.title,
    jobDescription: r.job_description,
    status: r.status,
    needsReason: r.needs_reason,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    readyAt: r.ready_at,
    submittedAt: r.submitted_at,
  };
}

export interface NewJob {
  sourceUrl: string;
  discordMessageId?: string | null;
  applyUrl?: string | null;
  normalizedUrl?: string | null;
  ats?: AtsId;
  atsTenant?: string | null;
  reqId?: string | null;
  company?: string | null;
  title?: string | null;
  status?: JobStatus;
  needsReason?: string | null;
}

export function insertJob(db: Db, input: NewJob): Job {
  const now = nowIso();
  const row: JobRow = {
    id: ulid(),
    discord_message_id: input.discordMessageId ?? null,
    source_url: input.sourceUrl,
    apply_url: input.applyUrl ?? null,
    normalized_url: input.normalizedUrl ?? null,
    ats: input.ats ?? 'unknown',
    ats_tenant: input.atsTenant ?? null,
    req_id: input.reqId ?? null,
    company: input.company ?? null,
    title: input.title ?? null,
    job_description: null,
    status: input.status ?? 'queued',
    needs_reason: input.needsReason ?? null,
    error: null,
    created_at: now,
    updated_at: now,
    ready_at: null,
    submitted_at: null,
  };
  db.prepare(
    `INSERT INTO jobs (id, discord_message_id, source_url, apply_url, normalized_url, ats, ats_tenant, req_id,
       company, title, job_description, status, needs_reason, error, created_at, updated_at, ready_at, submitted_at)
     VALUES (@id, @discord_message_id, @source_url, @apply_url, @normalized_url, @ats, @ats_tenant, @req_id,
       @company, @title, @job_description, @status, @needs_reason, @error, @created_at, @updated_at, @ready_at, @submitted_at)`,
  ).run(row);
  return toJob(row);
}

export function getJob(db: Db, id: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function getByMessageId(db: Db, discordMessageId: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE discord_message_id = ?').get(discordMessageId) as
    | JobRow
    | undefined;
  return row ? toJob(row) : null;
}

export function getByNormalizedUrl(db: Db, normalizedUrl: string): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE normalized_url = ?').get(normalizedUrl) as JobRow | undefined;
  return row ? toJob(row) : null;
}

/** Existing job for the same (ats, tenant, req id), the second dedupe key. */
export function getByDedupeKey(db: Db, ats: AtsId, atsTenant: string | null, reqId: string): Job | null {
  const row = db
    .prepare('SELECT * FROM jobs WHERE ats = ? AND ats_tenant IS ? AND req_id = ?')
    .get(ats, atsTenant, reqId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function deleteJob(db: Db, id: string): void {
  db.prepare('DELETE FROM jobs WHERE id = ?').run(id);
}

/** "Company — Title" for logs and messages, falling back to the link's host. */
export function jobLabel(job: Pick<Job, 'company' | 'title' | 'applyUrl' | 'sourceUrl'>): string {
  let company = job.company;
  if (!company) {
    try {
      company = new URL(job.applyUrl ?? job.sourceUrl).hostname;
    } catch {
      company = 'Unknown company';
    }
  }
  return `${company} — ${job.title ?? 'untitled'}`;
}

export interface StatusDetail {
  /** Human-readable, shown in Discord/status. Cleared when omitted. */
  needsReason?: string | null;
  /** Technical detail. Cleared when omitted. */
  error?: string | null;
}

/** Set a job's status; stamps `updated_at`, plus `ready_at` / `submitted_at` on those transitions. */
export function setStatus(db: Db, id: string, status: JobStatus, detail: StatusDetail = {}): void {
  const now = nowIso();
  const info = db
    .prepare(
      `UPDATE jobs SET status = @status, needs_reason = @needs_reason, error = @error, updated_at = @now,
         ready_at = CASE WHEN @status = 'ready' THEN @now ELSE ready_at END,
         submitted_at = CASE WHEN @status = 'submitted' THEN @now ELSE submitted_at END
       WHERE id = @id`,
    )
    .run({ id, status, needs_reason: detail.needsReason ?? null, error: detail.error ?? null, now });
  if (info.changes === 0) throw new Error(`no job with id ${id}`);
}

export interface ListOptions {
  /** Only jobs updated at or after this ISO timestamp. */
  since?: string;
}

/** Jobs in the given statuses (all statuses when empty/omitted), oldest first. */
export function listByStatus(db: Db, statuses: readonly JobStatus[] = [], opts: ListOptions = {}): Job[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (statuses.length > 0) {
    where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  if (opts.since) {
    where.push('updated_at >= ?');
    params.push(opts.since);
  }
  const sql = `SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
  return (db.prepare(sql).all(...params) as JobRow[]).map(toJob);
}

export function countJobs(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM jobs').get() as { n: number }).n;
}
