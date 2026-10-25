import type { AtsId } from '../db/jobs.js';

export interface AtsInfo {
  ats: AtsId;
  /** Greenhouse/Lever/Ashby board slug, Workday host (plus site for myworkdaysite.com), or the company host for gh_jid embeds. */
  tenant: string | null;
  /** Requisition / job id from the URL, when present. */
  reqId: string | null;
}

const UNKNOWN: AtsInfo = { ats: 'unknown', tenant: null, reqId: null };

const GREENHOUSE_HOST = /^(job-)?boards(\.eu)?\.greenhouse\.io$/;
const LEVER_HOST = /^jobs(\.eu)?\.lever\.co$/;
const ASHBY_HOST = /^jobs\.ashbyhq\.com$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;

// Trailing Workday path segments that are actions, not the job slug.
const WORKDAY_ACTIONS = new Set(['apply', 'applymanually', 'autofillwithresume', 'usemylastapplication']);

/** Detect the ATS, tenant and requisition id from a URL alone (no network). */
export function detectFromUrl(input: string | URL): AtsInfo {
  let url: URL;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return UNKNOWN;
  }
  const host = url.hostname.toLowerCase();
  const segs = url.pathname.split('/').filter(Boolean).map(safeDecode);
  const q = url.searchParams;

  if (GREENHOUSE_HOST.test(host)) {
    // Embed form: /embed/job_app?for=<board>&token=<job id>
    if (segs[0] === 'embed') {
      return { ats: 'greenhouse', tenant: lower(q.get('for')), reqId: digitsOrNull(q.get('token') ?? q.get('gh_jid')) };
    }
    const reqId = segs[1] === 'jobs' && segs[2] && DIGITS.test(segs[2]) ? segs[2] : digitsOrNull(q.get('gh_jid'));
    return { ats: 'greenhouse', tenant: lower(segs[0]), reqId };
  }

  if (LEVER_HOST.test(host)) {
    return { ats: 'lever', tenant: lower(segs[0]), reqId: segs[1] && UUID.test(segs[1]) ? segs[1].toLowerCase() : null };
  }

  if (ASHBY_HOST.test(host)) {
    return { ats: 'ashby', tenant: lower(segs[0]), reqId: segs[1] && UUID.test(segs[1]) ? segs[1].toLowerCase() : null };
  }

  if (host.endsWith('.myworkdayjobs.com') || host.endsWith('.myworkdaysite.com')) {
    // myworkdaysite.com is shared: /recruiting/<tenant>/<site>/job/...
    const tenant =
      host.endsWith('.myworkdaysite.com') && segs[0] === 'recruiting' && segs[1] ? `${host}/${segs[1].toLowerCase()}` : host;
    const slug = segs.filter((s) => !WORKDAY_ACTIONS.has(s.toLowerCase())).at(-1);
    const reqId = slug?.match(/_([A-Za-z0-9][A-Za-z0-9-]*)$/)?.[1] ?? null;
    return { ats: 'workday', tenant, reqId };
  }

  // Company career page hosting a Greenhouse board (iframe embed) — the page check lands in Phase 3.
  const ghJid = digitsOrNull(q.get('gh_jid'));
  if (ghJid) return { ats: 'greenhouse', tenant: host, reqId: ghJid };

  return UNKNOWN;
}

export function isKnownAtsUrl(url: string | URL): boolean {
  return detectFromUrl(url).ats !== 'unknown';
}

const WRAPPER_HOSTS = ['simplify.jobs', 'github.com'];

/** Pages that link to the real application (Simplify, GitHub README) rather than being it. */
export function isWrapperHost(host: string): boolean {
  const h = host.toLowerCase();
  return WRAPPER_HOSTS.some((w) => h === w || h.endsWith(`.${w}`));
}

const DISCORD_HOSTS = ['discord.com', 'discordapp.com', 'discordapp.net', 'discord.gg'];

export function isDiscordHost(host: string): boolean {
  const h = host.toLowerCase();
  return DISCORD_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

const lower = (s: string | null | undefined) => (s ? s.toLowerCase() : null);
const digitsOrNull = (s: string | null) => (s && DIGITS.test(s) ? s : null);
