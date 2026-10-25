import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseMessage, type MessageLike } from '../../src/discord/parse.js';

interface Fixture {
  description: string;
  message: MessageLike;
  expected: { url: string | null; company: string | null; title: string | null };
}

const dir = new URL('../fixtures/discord/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f, JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Fixture] as const);

describe('parseMessage fixtures', () => {
  it('has fixtures', () => expect(fixtures.length).toBeGreaterThanOrEqual(6));

  it.each(fixtures)('%s', (_name, fx) => {
    const parsed = parseMessage(fx.message);
    expect({ url: parsed.url, company: parsed.company, title: parsed.title }).toEqual(fx.expected);
  });
});

describe('parseMessage URL choice', () => {
  it('falls back to the first non-Discord URL', () => {
    const parsed = parseMessage({
      content: 'https://discord.gg/abc then https://careers.example.com/jobs/42 and https://other.example.com',
      embeds: [],
    });
    expect(parsed.url).toBe('https://careers.example.com/jobs/42');
    expect(parsed.urls).toHaveLength(3);
  });

  it('returns null when only Discord links are present', () => {
    expect(parseMessage({ content: 'https://discord.com/channels/1/2', embeds: [] }).url).toBeNull();
  });

  it('keeps hyphenated company names intact', () => {
    const parsed = parseMessage({ content: 'Mercedes-Benz | Software Intern https://jobs.lever.co/mb/x', embeds: [] });
    expect(parsed.company).toBe('Mercedes-Benz');
  });
});

describe('company/title order', () => {
  const title = (t: string) => parseMessage({ content: '', embeds: [{ url: 'https://jobs.lever.co/a/b', title: t }] });

  it('reads the feed shape Title — Company', () => {
    expect(title('Software Engineering Intern — Experian')).toMatchObject({ company: 'Experian', title: 'Software Engineering Intern' });
  });

  it('keeps a hyphenated suffix in the title', () => {
    expect(title('SWE Intern - Summer 2027 — Datadog')).toMatchObject({ company: 'Datadog', title: 'SWE Intern - Summer 2027' });
  });

  it('flips to Company — Title when role words say so', () => {
    expect(title('Datadog — Backend Intern')).toMatchObject({ company: 'Datadog', title: 'Backend Intern' });
  });

  it('defaults to Title — Company for embed titles when ambiguous', () => {
    expect(title('Platform — Acme')).toMatchObject({ company: 'Acme', title: 'Platform' });
  });
});
