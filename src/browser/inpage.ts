import { readFileSync } from 'node:fs';
import type { Frame, Locator } from 'playwright';

/** Source of page-script.js, injected as text so no bundler touches it. */
export const PAGE_SCRIPT = readFileSync(new URL('./page-script.js', import.meta.url), 'utf8');

export interface DiscoveredControl {
  fieldKey: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date';
  required: boolean;
  options?: string[];
  maxLength?: number;
}

/** Make sure the helpers exist in this frame (init scripts cover real tabs; tests use setContent). */
export async function ensurePageScript(frame: Frame): Promise<void> {
  if (!(await frame.evaluate('!!window.__applypipe'))) await frame.evaluate(PAGE_SCRIPT);
}

/** Discover form controls under `root` (selector), skipping `exclude` matches. */
export async function discoverControls(frame: Frame, root: string | null, exclude: string | null): Promise<DiscoveredControl[]> {
  await ensurePageScript(frame);
  return frame.evaluate(`window.__applypipe.controls(${JSON.stringify(root)}, ${JSON.stringify(exclude)})`);
}

/** Locator for a discovered control (all radios of a group share the key). */
export function controlLocator(frame: Frame, fieldKey: string): Locator {
  return frame.locator(`[data-applypipe-key="${fieldKey.replace(/["\\]/g, '\\$&')}"]`);
}
