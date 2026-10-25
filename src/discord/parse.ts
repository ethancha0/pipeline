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
 * The real feed (05-decisions.md OQ1) posts embed-only messages: URL = apply link,
 * title = `Title — Company`. Content, descriptions and field values are searched
 * too so other formats (fixtures) keep working.
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
// Strongest first: em/en dash, pipe, then a hyphen with spaces around it (so "Mercedes-Benz" stays whole).
const SEPARATORS = [/\s+[—–]\s+/g, /\s*\|\s*/g, /\s+-\s+/g];
const ROLE_WORDS =
  /\b(intern(ship)?s?|engineer(ing)?|developer|software|swe|co-?op|analyst|scientist|research(er)?|designer|programmer|technician|apprentice|fellow(ship)?)\b/i;

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

  // 2. A `Title — Company` / `Company — Title` pair in the embed title or the first content line that has one.
  //    The real feed's embed titles are `Title — Company` (05-decisions.md OQ1), so that's the embed default.
  const lines = [
    ...msg.embeds.map((e) => ({ text: e.title ?? '', titleFirst: true })),
    ...msg.content.split('\n').map((text) => ({ text, titleFirst: false })),
  ];
  for (const line of lines) {
    const text = clean(line.text);
    if (!text || /^[A-Za-z ]{2,20}[:：]/.test(text)) continue;
    const pair = splitPair(text, line.titleFirst);
    if (pair) return { company: company ?? pair.company, title: title ?? pair.title };
  }
  return { company, title };
}

/**
 * Split "A — B" into company and title. Role words ("Intern", "Engineer"…) on
 * exactly one side decide which is the title; otherwise `titleFirstDefault` does.
 * Splits at the side nearest the company so a title like "SWE Intern - Summer 2027" stays whole.
 */
function splitPair(text: string, titleFirstDefault: boolean): { company: string; title: string } | null {
  for (const re of SEPARATORS) {
    const seps = [...text.matchAll(re)];
    if (seps.length === 0) continue;
    const first = seps[0]!;
    const last = seps.at(-1)!;
    const left = text.slice(0, first.index).trim();
    const right = text.slice(first.index + first[0].length).trim();
    if (!left || !right) return null;

    const leftRole = ROLE_WORDS.test(left);
    const rightRole = ROLE_WORDS.test(right);
    const titleFirst = leftRole !== rightRole ? leftRole : titleFirstDefault;

    if (titleFirst) {
      return { title: text.slice(0, last.index).trim(), company: text.slice(last.index + last[0].length).trim() };
    }
    return { company: left, title: right };
  }
  return null;
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
