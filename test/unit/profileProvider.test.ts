import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { FormField } from '../../src/adapters/types.js';
import { createProfileProvider, formatPhone, tokenOverlap } from '../../src/answers/profileProvider.js';
import type { Job } from '../../src/db/jobs.js';
import { parseProfile } from '../../src/profile/load.js';

const data = parse(readFileSync(new URL('../../profile.example.yaml', import.meta.url), 'utf8'));
const loaded = parseProfile(data);
if (!loaded.ok) throw new Error('example profile should be valid');
const provider = createProfileProvider(loaded.profile, loaded.locked, '/home/x/Alex_resume.pdf');

const field = (label: string, type: FormField['type'] = 'text', required = true): FormField =>
  ({ fieldKey: label, label, type, required, locator: null as never, pageIndex: 0 }) as FormField;
const ask = (label: string, type?: FormField['type']) => provider.resolve(field(label, type), {} as Job);

describe('profile provider', () => {
  it.each([
    ['First Name*', 'Alex'],
    ['Last Name', 'Example'],
    ['Preferred First Name', 'Al'],
    ['Chosen Name', 'Al'],
    ['Email', 'alex@example.com'],
    ['Phone', '555-555-0100'],
    ['LinkedIn Profile', 'https://www.linkedin.com/in/your-handle'],
    ['Github', 'https://github.com/your-handle'],
    ['Website / Portfolio', 'https://example.com'],
    ['What college/university do you attend?', 'Example University'],
    ['Degree', 'Bachelor of Science'],
    ['Discipline', 'Computer Science'],
    ['Start date year', '2023'],
    ['Current Job Title', 'Software Engineering Intern'],
    ['Current Employer', 'Example Corp'],
    ['Are you willing to relocate?', 'Yes'],
  ])('%s → %s', async (label, value) => {
    expect((await ask(label)).value).toBe(value);
  });

  it('fills locked answers from the profile and flags them green', async () => {
    expect(await ask('End date month', 'combobox')).toMatchObject({ value: 'June', source: 'locked', flag: 'green', category: 'graduation' });
    expect(await ask('End date year')).toMatchObject({ value: '2027', flag: 'green' });
    expect(await ask('What is your expected graduation date?', 'combobox')).toMatchObject({ value: 'June 2027' });
    expect(await ask('Do you have legal authorization to work in the region?', 'combobox')).toMatchObject({ value: 'Yes', category: 'work_auth' });
    expect(await ask('Gender Identity', 'combobox')).toMatchObject({ value: 'decline', category: 'eeo', flag: 'green' });
    expect(await ask('Are you Hispanic/Latino?', 'combobox')).toMatchObject({ value: 'decline' });
    expect(await ask('Location (City)', 'combobox')).toMatchObject({ value: 'Springfield, California, United States', category: 'location' });
    expect(await ask('City')).toMatchObject({ value: 'Springfield, CA' });
    expect(await ask('Country', 'combobox')).toMatchObject({ value: 'United States' });
  });

  it('answers sponsorship by tense, never guessing', async () => {
    const yes = createProfileProvider(
      { ...loaded.profile, work_auth: { authorized_us: true, needs_sponsorship_now: false, needs_sponsorship_future: true } },
      { ...loaded.locked, work_auth: { authorized_us: true, needs_sponsorship_now: false, needs_sponsorship_future: true } },
      '',
    );
    const q = (label: string) => yes.resolve(field(label, 'combobox'), {} as Job);
    expect((await q('Do you currently require visa sponsorship?')).value).toBe('No');
    expect((await q('Will you in the future require sponsorship?')).value).toBe('Yes');
    expect((await q('Do you now, or will you in the future, require sponsorship for employment authorization?')).value).toBe('Yes');
  });

  it('leaves a locked question the profile has no answer for blank and red', async () => {
    expect(await ask('Transgender Status', 'combobox')).toEqual({ value: null, source: 'none', flag: 'red', category: 'eeo' });
  });

  it('never answers attestations, consents, or conditional follow-ups', async () => {
    for (const label of [
      'I acknowledge that I have read and understand the Candidate Privacy Notice.',
      'I confirm all answers provided by me within this application are true and correct.',
      'By checking this box, I consent to Epic Games collecting, storing, and processing my responses',
      'If you answered "Other" above, please note your graduation date.',
    ]) {
      expect((await ask(label)).value, label).toBeNull();
    }
  });

  it('returns the resume for resume uploads only', async () => {
    expect((await ask('Resume/CV', 'file')).value).toBe('/home/x/Alex_resume.pdf');
    expect((await ask('Cover Letter', 'file')).value).toBeNull();
  });

  it('uses standard answers by token overlap; locked ones are green', async () => {
    expect(await ask('How did you hear about this job posting?')).toMatchObject({ value: 'Online job board', source: 'profile' });
    expect(await ask('Are you at least 18 years of age?')).toMatchObject({ value: 'Yes', source: 'locked', flag: 'green' });
    expect(await ask('Have you previously worked for Epic Games?')).toMatchObject({ value: null, source: 'none' });
  });
});

describe('helpers', () => {
  it('formats US phone numbers', () => {
    expect(formatPhone('+17147470796')).toBe('714-747-0796');
    expect(formatPhone('7147470796')).toBe('714-747-0796');
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
  });
  it('measures overlap against the stored question', () => {
    expect(tokenOverlap('How did you hear about us?', 'How did you hear about this job posting?')).toBe(1);
    expect(tokenOverlap('How did you hear about us?', 'How did you learn about this job?')).toBeLessThan(0.8);
  });
});
