import { describe, expect, it, vi } from 'vitest';
import { NO_APPLY_LINK, pickApplyLink, resolve } from '../../src/jobs/resolve.js';

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });
const ok = () => new Response('<html></html>', { status: 200 });

describe('resolve', () => {
  it('returns known ATS URLs without any request', async () => {
    const fetch = vi.fn();
    const r = await resolve('https://jobs.lever.co/a/0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c', { fetch });
    expect(r).toEqual({ ok: true, url: 'https://jobs.lever.co/a/0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows redirects (relative too) until it reaches an ATS', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(redirect('/r2'))
      .mockResolvedValueOnce(redirect('https://boards.greenhouse.io/acme/jobs/1'));
    const r = await resolve('https://short.example/abc', { fetch });
    expect(r).toEqual({ ok: true, url: 'https://boards.greenhouse.io/acme/jobs/1' });
    expect(fetch.mock.calls.map((c) => c[0])).toEqual(['https://short.example/abc', 'https://short.example/r2']);
  });

  it('stops after 5 redirects', async () => {
    let n = 0;
    const fetch = vi.fn(async () => redirect(`https://loop.example/${++n}`));
    const r = await resolve('https://loop.example/0', { fetch });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(r).toEqual({ ok: true, url: 'https://loop.example/5' });
  });

  it('marks wrapper pages unresolved without a browser', async () => {
    const r = await resolve('https://simplify.jobs/p/abc', { fetch: vi.fn(async () => ok()) });
    expect(r).toEqual({ ok: false, url: 'https://simplify.jobs/p/abc', reason: NO_APPLY_LINK });
  });

  it('reads wrapper pages for the ATS link', async () => {
    const readLinks = vi.fn(async () => [
      { href: 'https://simplify.jobs/jobs', text: 'More jobs' },
      { href: 'https://jobs.lever.co/acme/0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c', text: 'Apply' },
    ]);
    const r = await resolve('https://simplify.jobs/p/abc', { fetch: vi.fn(async () => ok()), readLinks });
    expect(r).toEqual({ ok: true, url: 'https://jobs.lever.co/acme/0f6a2b7c-1d2e-4f3a-9b8c-7d6e5f4a3b2c' });
  });

  it('flags a wrapper whose apply link is LinkedIn', async () => {
    const readLinks = async () => [{ href: 'https://www.linkedin.com/jobs/view/1', text: 'Apply' }];
    const r = await resolve('https://simplify.jobs/p/abc', { fetch: vi.fn(async () => ok()), readLinks });
    expect(r).toMatchObject({ ok: false, reason: 'LinkedIn link — apply manually' });
  });

  it.each([
    ['https://www.linkedin.com/jobs/view/4012345678', 'LinkedIn link — apply manually'],
    ['https://www.indeed.com/viewjob?jk=abc123', 'Indeed link — apply manually'],
  ])('never requests %s', async (url, reason) => {
    const fetch = vi.fn();
    expect(await resolve(url, { fetch })).toEqual({ ok: false, url, reason });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops before following a redirect into LinkedIn', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(redirect('https://www.linkedin.com/jobs/view/1'));
    const r = await resolve('https://short.example/x', { fetch });
    expect(r).toEqual({ ok: false, url: 'https://www.linkedin.com/jobs/view/1', reason: 'LinkedIn link — apply manually' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the URL when the request fails', async () => {
    const r = await resolve('https://careers.example.com/42', {
      fetch: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    });
    expect(r).toEqual({ ok: true, url: 'https://careers.example.com/42' });
  });
});

describe('pickApplyLink', () => {
  const gh = 'https://boards.greenhouse.io/acme/jobs/1';

  it('prefers ATS links, then "apply" links that leave the wrapper', () => {
    expect(
      pickApplyLink('https://simplify.jobs/p/x', [
        { href: 'https://acme.com/careers/1', text: 'Apply now' },
        { href: gh, text: 'x' },
      ]),
    ).toBe(gh);
    expect(
      pickApplyLink('https://simplify.jobs/p/x', [
        { href: 'https://simplify.jobs/apply', text: 'Apply' },
        { href: 'https://acme.com/c/1', text: 'Apply' },
      ]),
    ).toBe('https://acme.com/c/1');
  });

  it('only trusts a GitHub README with exactly one ATS link', () => {
    const readme = 'https://github.com/SimplifyJobs/Summer2027-Internships/blob/dev/README.md';
    expect(pickApplyLink(readme, [{ href: gh, text: 'Apply' }])).toBe(gh);
    expect(
      pickApplyLink(readme, [
        { href: gh, text: 'Apply' },
        { href: 'https://jobs.lever.co/b/c', text: 'Apply' },
      ]),
    ).toBeNull();
  });
});
