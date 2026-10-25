import { detectFromUrl, type AtsInfo } from './detect.js';

export interface NormalizedUrl extends AtsInfo {
  normalizedUrl: string;
}

// Query params that only track where a click came from. gh_jid (Greenhouse
// embeds) and Greenhouse's embed `for`/`token` params identify the job and stay.
const TRACKING_PARAMS = [/^utm_/i, /^gh_src$/i, /^source$/i, /^ref$/i, /^lever-source/i, /^src$/i];

/**
 * Canonical form of a job URL for dedupe: https, lowercase host, no fragment,
 * no tracking params, remaining params sorted, no trailing slash. Throws on an invalid URL.
 */
export function normalize(input: string): NormalizedUrl {
  const url = new URL(input.trim());
  if (url.protocol === 'http:') url.protocol = 'https:';
  url.hash = '';

  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((re) => re.test(key))) url.searchParams.delete(key);
  }
  url.searchParams.sort();

  const path = url.pathname.replace(/\/+$/, '');
  const search = url.searchParams.size > 0 ? `?${url.searchParams.toString()}` : '';
  const normalizedUrl = `${url.origin}${path}${search}`;

  return { normalizedUrl, ...detectFromUrl(new URL(normalizedUrl)) };
}
