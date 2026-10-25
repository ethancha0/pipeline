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
