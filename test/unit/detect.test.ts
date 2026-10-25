import { describe, expect, it } from 'vitest';
import { detectFromUrl, isDiscordHost, isWrapperHost } from '../../src/jobs/detect.js';

describe('detectFromUrl', () => {
  it.each([
    ['https://boards.greenhouse.io/acme/jobs/4012345', { ats: 'greenhouse', tenant: 'acme', reqId: '4012345' }],
    ['https://job-boards.greenhouse.io/Acme/jobs/4012345', { ats: 'greenhouse', tenant: 'acme', reqId: '4012345' }],
    ['https://job-boards.eu.greenhouse.io/acme/jobs/77', { ats: 'greenhouse', tenant: 'acme', reqId: '77' }],
    ['https://boards.greenhouse.io/embed/job_app?for=acme&token=555', { ats: 'greenhouse', tenant: 'acme', reqId: '555' }],
    ['https://careers.acme.com/open-roles?gh_jid=987', { ats: 'greenhouse', tenant: 'careers.acme.com', reqId: '987' }],
    ['https://boards.greenhouse.io/acme', { ats: 'greenhouse', tenant: 'acme', reqId: null }],
    [
      'https://jobs.lever.co/globex/0F6A2B7C-1D2E-4F3A-9B8C-7D6E5F4A3B2C/apply',
      { ats: 'lever', tenant: 'globex', reqId: '0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c' },
    ],
    [
      'https://jobs.eu.lever.co/globex/0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c',
      { ats: 'lever', tenant: 'globex', reqId: '0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c' },
    ],
    [
      'https://jobs.ashbyhq.com/Vandelay/5b1c3d2e-8f9a-4b6c-a7d8-e9f0a1b2c3d4/application',
      { ats: 'ashby', tenant: 'vandelay', reqId: '5b1c3d2e-8f9a-4b6c-a7d8-e9f0a1b2c3d4' },
    ],
    [
      'https://initech.wd1.myworkdayjobs.com/en-US/External/job/Austin-TX/Software-Engineering-Intern_R-10234',
      { ats: 'workday', tenant: 'initech.wd1.myworkdayjobs.com', reqId: 'R-10234' },
    ],
    [
      'https://initech.wd1.myworkdayjobs.com/External/job/Remote/SWE-Intern_JR123456/apply/applyManually',
      { ats: 'workday', tenant: 'initech.wd1.myworkdayjobs.com', reqId: 'JR123456' },
    ],
    [
      'https://wd5.myworkdaysite.com/recruiting/umbrella/External/job/Raccoon-City/Intern_R999',
      { ats: 'workday', tenant: 'wd5.myworkdaysite.com/umbrella', reqId: 'R999' },
    ],
    ['https://careers.example.com/jobs/42', { ats: 'unknown', tenant: null, reqId: null }],
    ['not a url', { ats: 'unknown', tenant: null, reqId: null }],
  ])('%s', (url, expected) => {
    expect(detectFromUrl(url)).toEqual(expected);
  });
});

describe('host classes', () => {
  it('wrappers', () => {
    expect(isWrapperHost('simplify.jobs')).toBe(true);
    expect(isWrapperHost('www.github.com')).toBe(true);
    expect(isWrapperHost('notgithub.com')).toBe(false);
  });
  it('discord', () => {
    expect(isDiscordHost('cdn.discordapp.com')).toBe(true);
    expect(isDiscordHost('discord.gg')).toBe(true);
    expect(isDiscordHost('example.com')).toBe(false);
  });
});
