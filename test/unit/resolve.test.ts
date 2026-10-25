import { describe, expect, it, vi } from 'vitest';
import { resolve } from '../../src/jobs/resolve.js';

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

  it('marks wrapper pages as unresolved', async () => {
    const r = await resolve('https://simplify.jobs/p/abc', { fetch: vi.fn(async () => ok()) });
    expect(r).toEqual({ ok: false, url: 'https://simplify.jobs/p/abc', reason: 'wrapper link — resolver lands in Phase 3' });
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
