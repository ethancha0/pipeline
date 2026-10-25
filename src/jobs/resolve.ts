import { log } from '../log.js';
import { isKnownAtsUrl, isWrapperHost, manualOnlyBoard } from './detect.js';

export type ResolveResult =
  | { ok: true; url: string }
  /** `url` is the furthest URL reached; `reason` is shown to the owner. */
  | { ok: false; url: string; reason: string };

export interface ResolveDeps {
  fetch?: typeof fetch;
  maxRedirects?: number;
  timeoutMs?: number;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * Turn a link from a feed post into the application URL.
 * Known ATS URLs are returned as-is; LinkedIn/Indeed links are never requested
 * and come back unresolved ("apply manually"); anything else has its HTTP redirects
 * followed (max 5). A network failure keeps the last URL reached rather than failing the job.
 */
export async function resolve(url: string, deps: ResolveDeps = {}): Promise<ResolveResult> {
  const doFetch = deps.fetch ?? fetch;
  const maxRedirects = deps.maxRedirects ?? 5;
  let current = url;

  for (let hop = 0; hop < maxRedirects && !isKnownAtsUrl(current); hop++) {
    const board = manualOnlyBoard(new URL(current).hostname);
    if (board) return { ok: false, url: current, reason: `${board} link — apply manually` };

    let location: string | null = null;
    try {
      const res = await doFetch(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000),
      });
      await res.body?.cancel().catch(() => {});
      if (res.status >= 300 && res.status < 400) location = res.headers.get('location');
    } catch (err) {
      log.warn({ url: current, err: String(err) }, 'resolve: request failed; keeping this URL');
      break;
    }
    if (!location) break;
    current = new URL(location, current).toString();
  }

  const board = manualOnlyBoard(new URL(current).hostname);
  if (board) return { ok: false, url: current, reason: `${board} link — apply manually` };
  if (isWrapperHost(new URL(current).hostname)) {
    // Phase 3 replaces this with the background-page resolver (02-architecture.md → Resolve & dedupe).
    return { ok: false, url: current, reason: 'wrapper link — resolver lands in Phase 3' };
  }
  return { ok: true, url: current };
}
