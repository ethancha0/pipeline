import type { Locator } from 'playwright';
import { normalizeText } from '../util/text.js';

/**
 * Submit guard (CLAUDE.md rule 1, 02-architecture.md → Submit guard).
 * Every click applypipe makes goes through `safeClick`; nothing else in src/ may call `.click(`.
 */
export const SUBMIT_RE = /\b(submit|send application|apply now|finish|complete application)\b/i;

export class SubmitGuardError extends Error {
  override name = 'SubmitGuardError';
}

export interface ControlInfo {
  /** Accessible name: aria-label, visible text, or value. */
  name: string;
  /** `button[type=submit]` / `input[type=submit]`. */
  isSubmitType: boolean;
}

/** Whether a control with this name would submit the application. Pure, so it's tested directly. */
export function isSubmitLike(info: ControlInfo): boolean {
  const name = info.name.trim();
  return SUBMIT_RE.test(name) || (info.isSubmitType && /^apply$/i.test(name));
}

export interface SafeClickOptions {
  /** Exact accessible names this adapter may click even though they look submit-like (e.g. Workday "Save and Continue"). */
  allowNav?: readonly string[];
}

/** Read a control's accessible name and whether it's a submit-type control. */
export async function describeControl(locator: Locator): Promise<ControlInfo> {
  return locator.evaluate((el) => {
    const input = el as HTMLInputElement;
    const text = (el as HTMLElement).innerText || el.textContent || '';
    const name = (el.getAttribute('aria-label') || text || input.value || el.getAttribute('title') || '')
      .replace(/\s+/g, ' ')
      .trim();
    const type = (el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
    return { name, isSubmitType: (el.tagName === 'BUTTON' || el.tagName === 'INPUT') && type === 'submit' };
  });
}

/**
 * Click a control unless it looks like a submit control that isn't allowlisted.
 * Throws SubmitGuardError instead of clicking.
 */
export async function safeClick(locator: Locator, opts: SafeClickOptions = {}): Promise<void> {
  const info = await describeControl(locator);
  if (isSubmitLike(info)) {
    const allowed = (opts.allowNav ?? []).some((n) => normalizeText(n) === normalizeText(info.name));
    if (!allowed) throw new SubmitGuardError(`refusing to click submit-like control "${info.name}"`);
  }
  await locator.click();
}
