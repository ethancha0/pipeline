import { isDiscordHost, isKnownAtsUrl, isWrapperHost } from '../jobs/detect.js';

export interface EmbedLike {
  url?: string | null;
  title?: string | null;
  description?: string | null;
  fields?: { name: string; value: string }[];
}

/** The parts of a Discord message the parser reads (also the fixture format). */
export interface MessageLike {
  content: string;
  embeds: EmbedLike[];
}

export interface ParsedMessage {
  /** Chosen application link, or null when the message has none. */
  url: string | null;
  /** Every http(s) URL found, in message order. */
  urls: string[];
  company: string | null;
  title: string | null;
}

const URL_RE = /https?:\/\/[^\s<>"'`()[\]{}|]+/gi;
const TRAILING_PUNCT = /[.,;:!?*_~]+$/;

/**
 * Extract the apply URL, company and title from a feed post.
 * Default rules (05-decisions.md OQ1): the real webhook format is unconfirmed,
 * so content, embed URLs, descriptions and field values are all searched.
 */
export function parseMessage(msg: MessageLike): ParsedMessage {
  const urls = collectUrls(msg);
  const url =
    urls.find((u) => isKnownAtsUrl(u)) ??
    urls.find((u) => isWrapperHost(new URL(u).hostname)) ??
    urls.find((u) => !isDiscordHost(new URL(u).hostname)) ??
    null;
  return { url, urls, ...extractCompanyTitle(msg) };
}

function collectUrls(msg: MessageLike): string[] {
  const texts = [msg.content];
  for (const e of msg.embeds) {
    texts.push(e.url ?? '', e.description ?? '', ...(e.fields ?? []).map((f) => f.value));
  }
  const seen = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(URL_RE)) {
      const candidate = match[0].replace(TRAILING_PUNCT, '');
      try {
        new URL(candidate);
        seen.add(candidate);
      } catch {
        // not a real URL; skip
      }
    }
  }
  return [...seen];
}

const COMPANY_KEY = /^(company|employer|organization)$/i;
const TITLE_KEY = /^(role|title|position|job|job title)$/i;
// `Company — Title`, `Company – Title`, `Company | Title`, `Company - Title` (spaces required around the hyphen).
const SEPARATOR = /\s+[—–]\s+|\s*\|\s*|\s+-\s+/;

function extractCompanyTitle(msg: MessageLike): { company: string | null; title: string | null } {
  let company: string | null = null;
  let title: string | null = null;

  // 1. Labelled embed fields and `Company: X` / `Role: Y` lines.
  const pairs: [string, string][] = [];
  for (const e of msg.embeds) for (const f of e.fields ?? []) pairs.push([clean(f.name), clean(f.value)]);
  for (const line of [msg.content, ...msg.embeds.map((e) => e.description ?? '')].flatMap((t) => t.split('\n'))) {
    const m = clean(line).match(/^([A-Za-z ]{2,20}?)\s*[:：]\s*(.+)$/);
    if (m) pairs.push([m[1]!, m[2]!]);
  }
  for (const [key, value] of pairs) {
    if (!value) continue;
    if (!company && COMPANY_KEY.test(key)) company = value;
    if (!title && TITLE_KEY.test(key)) title = value;
  }
  if (company && title) return { company, title };

  // 2. `Company — Title` in the embed title or the first content line that has one.
  const lines = [...msg.embeds.map((e) => e.title ?? ''), ...msg.content.split('\n')];
  for (const line of lines) {
    const text = clean(line);
    if (!text || /^[A-Za-z ]{2,20}[:：]/.test(text)) continue;
    const parts = text.split(SEPARATOR).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { company: company ?? parts[0]!, title: title ?? parts.slice(1).join(' · ') };
    }
  }
  return { company, title };
}

/** Strip Discord markdown, links and leading emoji/bullets from one line. */
function clean(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/<https?:\/\/[^>]+>/g, '')
    .replace(URL_RE, '')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|\s)[*_](\S)/g, '$1$2')
    .replace(/(\S)[*_](\s|$)/g, '$1$2')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/[\s:—–|-]+$/, '')
    .trim();
}
