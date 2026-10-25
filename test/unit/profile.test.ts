import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { issuesBySection, parseProfile } from '../../src/profile/load.js';

const example = () => parse(readFileSync(new URL('../../profile.example.yaml', import.meta.url), 'utf8'));

describe('profile schema', () => {
  it('accepts profile.example.yaml', () => {
    const result = parseProfile(example());
    expect(result.ok).toBe(true);
  });

  it('derives the locked map', () => {
    const result = parseProfile(example());
    if (!result.ok) throw new Error('example should be valid');
    expect(result.locked.graduation).toBe('2027-06');
    expect(result.locked.work_auth.needs_sponsorship_now).toBe(false);
    expect(result.locked.location.city).toBe('Springfield');
    expect(result.locked.eeo.gender).toBe('decline');
    expect(result.locked.standard).toEqual([{ question: 'Are you at least 18 years old?', answer: 'Yes' }]);
  });

  it('rejects a missing work_auth with a readable path', () => {
    const data = example();
    delete data.work_auth;
    const result = parseProfile(data);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual([{ path: 'work_auth', message: 'missing' }]);
    const sections = issuesBySection(result.issues);
    expect(sections.get('work_auth')).toHaveLength(1);
    expect(sections.get('identity')).toHaveLength(0);
  });

  it('reports nested paths for bad values', () => {
    const data = example();
    data.education[0].end = 'June 2027';
    delete data.work_auth.needs_sponsorship_future;
    const result = parseProfile(data);
    if (result.ok) throw new Error('should fail');
    expect(result.issues.map((i) => i.path).sort()).toEqual(['education.0.end', 'work_auth.needs_sponsorship_future']);
    expect(result.issues.find((i) => i.path === 'education.0.end')?.message).toBe('must be YYYY-MM');
  });

  it('treats blank optional keys as omitted', () => {
    const data = example();
    data.identity.preferred_name = null;
    data.links.portfolio = null;
    data.education[0].gpa = null;
    const result = parseProfile(data);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.profile.identity.preferred_name).toBeUndefined();
  });

  it('still rejects blank required keys', () => {
    const data = example();
    data.identity.first_name = null;
    const result = parseProfile(data);
    expect(result.ok ? [] : result.issues.map((i) => i.path)).toEqual(['identity.first_name']);
  });

  it('requires at least one education entry', () => {
    const data = example();
    data.education = [];
    const result = parseProfile(data);
    expect(result.ok).toBe(false);
  });
});
