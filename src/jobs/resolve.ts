import { log } from '../log.js';
import { isKnownAtsUrl, isWrapperHost, manualOnlyBoard } from './detect.js';

export type ResolveResult =
  | { ok: true; url: string }
  /** `url` is the furthest URL reached; `reason` is shown to the owner. */
  | { ok: false; url: string; reason: string };

export interface PageLink {
  href: string;
  text: string;
}

export interface ResolveDeps {
  fetch?: typeof fetch;
  maxRedirects?: number;
  timeoutMs?: number;
  /** Load a wrapper page in a background browser tab and return its links (absolute hrefs). */
  readLinks?(url: string): Promise<PageLink[]>;
}

export const NO_APPLY_LINK = "couldn't find the application link";

/**
 * The application link on a wrapper page: the first known-ATS link, else a link
 * labelled "apply" that leaves the wrapper. A GitHub page (a README listing many
 * jobs) only resolves when it links exactly one ATS posting.
 */
export function pickApplyLink(pageUrl: string, links: PageLink[]): string | null {
  const offWrapper = links.filter((l) => {
    try {
      return !isWrapperHost(new URL(l.href).hostname);
    } catch {
      return false;
    }
  });
  const ats = [...new Set(offWrapper.map((l) => l.href).filter((h) => isKnownAtsUrl(h)))];
  if (new URL(pageUrl).hostname.endsWith('github.com')) return ats.length === 1 ? ats[0]! : null;
  if (ats.length > 0) return ats[0]!;
  return offWrapper.find((l) => /\bapply\b/i.test(l.text))?.href ?? null;
}

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

/**
 * Turn a link from a feed post into the application URL.
 * Known ATS URLs are returned as-is; LinkedIn/Indeed links are never requested
 * and come back unresolved ("apply manually"); anything else has its HTTP redirects
 * followed (max 5). Wrapper pages (Simplify, GitHub) are read in a background tab
 * via `readLinks`. A network failure keeps the last URL reached rather than failing the job.
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
    if (!deps.readLinks) return { ok: false, url: current, reason: NO_APPLY_LINK };
    let picked: string | null = null;
    try {
      picked = pickApplyLink(current, await deps.readLinks(current));
    } catch (err) {
      log.warn({ url: current, err: String(err) }, 'resolve: wrapper page failed to load');
    }
    if (!picked) return { ok: false, url: current, reason: NO_APPLY_LINK };
    const linkBoard = manualOnlyBoard(new URL(picked).hostname);
    if (linkBoard) return { ok: false, url: picked, reason: `${linkBoard} link — apply manually` };
    return { ok: true, url: picked };
  }
  return { ok: true, url: current };
}
