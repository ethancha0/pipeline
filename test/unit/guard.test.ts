import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Locator } from 'playwright';
import { isSubmitLike, safeClick, SubmitGuardError } from '../../src/browser/guard.js';

describe('isSubmitLike', () => {
  it.each([
    'Submit',
    'Submit application',
    'Send application',
    'Apply now',
    'Finish',
    'Complete application',
    'SUBMIT YOUR APPLICATION',
  ])('blocks "%s"', (name) => {
    expect(isSubmitLike({ name, isSubmitType: false })).toBe(true);
  });

  it('blocks a plain "Apply" only on a submit-type control', () => {
    expect(isSubmitLike({ name: 'Apply', isSubmitType: true })).toBe(true);
    expect(isSubmitLike({ name: 'Apply', isSubmitType: false })).toBe(false);
  });

  // "Resubmitted" has no word boundary before "submit".
  it.each(['Next', 'Save and Continue', 'Attach', 'Yes', 'United States +1', 'Resubmitted'])('allows "%s"', (name) => {
    expect(isSubmitLike({ name, isSubmitType: false })).toBe(false);
  });
});

function fakeLocator(name: string, isSubmitType = false) {
  const click = vi.fn(async () => {});
  const locator = { evaluate: vi.fn(async () => ({ name, isSubmitType })), click } as unknown as Locator;
  return { locator, click };
}

describe('safeClick', () => {
  it('throws on a submit control and never clicks it', async () => {
    const { locator, click } = fakeLocator('Submit application', true);
    await expect(safeClick(locator)).rejects.toBeInstanceOf(SubmitGuardError);
    expect(click).not.toHaveBeenCalled();
  });

  it('clicks ordinary controls', async () => {
    const { locator, click } = fakeLocator('Yes');
    await safeClick(locator);
    expect(click).toHaveBeenCalledOnce();
  });

  it('clicks a submit-looking control only when allowlisted by exact name', async () => {
    const finish = fakeLocator('Finish');
    await safeClick(finish.locator, { allowNav: ['finish'] });
    expect(finish.click).toHaveBeenCalledOnce();

    const submit = fakeLocator('Submit');
    await expect(safeClick(submit.locator, { allowNav: ['Save and Continue'] })).rejects.toBeInstanceOf(SubmitGuardError);
    expect(submit.click).not.toHaveBeenCalled();
  });
});

describe('no direct clicks', () => {
  const src = fileURLToPath(new URL('../../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|js)$/.test(f) ? [p] : [];
    });

  it('only browser/guard.ts calls .click( / .dblclick( / .tap(', () => {
    const offenders = files(src)
      .filter((f) => relative(src, f) !== join('browser', 'guard.ts'))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .map((line, i) => ({ line, at: `${relative(src, f)}:${i + 1}` }))
          .filter(({ line }) => /\.(click|dblclick|tap)\s*\(/.test(line))
          .map(({ at }) => at),
      );
    expect(offenders).toEqual([]);
  });
});
