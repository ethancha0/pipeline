import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/jobs/normalize.js';

describe('normalize', () => {
  it('strips tracking params, fragment and trailing slash; lowercases host; forces https', () => {
    expect(
      normalize('http://BOARDS.Greenhouse.io/acme/jobs/123/?utm_source=x&utm_medium=y&gh_src=z&ref=r&src=s&source=t#app')
        .normalizedUrl,
    ).toBe('https://boards.greenhouse.io/acme/jobs/123');
  });

  it('strips lever-source variants', () => {
    expect(normalize('https://jobs.lever.co/a/b?lever-source=Simplify&lever-source%5B%5D=X').normalizedUrl).toBe(
      'https://jobs.lever.co/a/b',
    );
  });

  it('keeps gh_jid and other meaningful params, sorted', () => {
    const n = normalize('https://careers.acme.com/jobs/?utm_campaign=c&team=eng&gh_jid=987');
    expect(n.normalizedUrl).toBe('https://careers.acme.com/jobs?gh_jid=987&team=eng');
    expect(n).toMatchObject({ ats: 'greenhouse', tenant: 'careers.acme.com', reqId: '987' });
  });

  it('keeps Greenhouse embed params', () => {
    expect(normalize('https://boards.greenhouse.io/embed/job_app?token=5&for=acme&utm_source=x').normalizedUrl).toBe(
      'https://boards.greenhouse.io/embed/job_app?for=acme&token=5',
    );
  });

  it('makes two tracking variants of the same job equal (F2)', () => {
    const a = normalize('https://boards.greenhouse.io/acme/jobs/123?utm_source=simplify');
    const b = normalize('https://boards.greenhouse.io/acme/jobs/123?gh_src=abc#top');
    expect(a.normalizedUrl).toBe(b.normalizedUrl);
  });

  it('returns ATS info from the cleaned URL', () => {
    expect(
      normalize('https://initech.wd1.myworkdayjobs.com/en-US/External/job/X/Intern_R-1?source=LinkedIn'),
    ).toEqual({
      normalizedUrl: 'https://initech.wd1.myworkdayjobs.com/en-US/External/job/X/Intern_R-1',
      ats: 'workday',
      tenant: 'initech.wd1.myworkdayjobs.com',
      reqId: 'R-1',
    });
  });

  it('throws on an invalid URL', () => {
    expect(() => normalize('nope')).toThrow();
  });
});
