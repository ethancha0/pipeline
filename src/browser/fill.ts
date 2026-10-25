import { basename } from 'node:path';
import type { Locator } from 'playwright';
import { bestOption, sameValue } from '../util/text.js';
import { safeClick } from './guard.js';

/** Every helper returns whether the value stuck and what the control shows now. */
export interface FillResult {
  ok: boolean;
  actualValue?: string;
}

/**
 * Set a text input/textarea through the native value setter + bubbling input/change
 * events (works with React-controlled inputs), then read it back; if it didn't
 * stick, type it instead.
 */
export async function fillText(locator: Locator, value: string): Promise<FillResult> {
  await locator.scrollIntoViewIfNeeded();
  await locator.focus();
  await locator.evaluate((el, v) => {
    const input = el as HTMLInputElement;
    try {
      input.select();
    } catch {
      // some input types don't support selection
    }
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set?.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
  await locator.blur();
  let actual = await locator.inputValue();
  if (!sameValue(actual, value)) {
    await locator.clear();
    await locator.pressSequentially(value, { delay: 15 });
    await locator.blur();
    actual = await locator.inputValue();
  }
  return { ok: sameValue(actual, value), actualValue: actual };
}

export const fillTextarea = fillText;

/** Choose the `<option>` that best matches `optionText`. */
export async function selectNative(locator: Locator, optionText: string): Promise<FillResult> {
  const options = await locator.evaluate((el) =>
    [...(el as HTMLSelectElement).options].map((o) => o.text.replace(/\s+/g, ' ').trim()),
  );
  const best = bestOption(optionText, options);
  if (!best) return { ok: false };
  await locator.selectOption({ label: best });
  const actual = await locator.evaluate((el) => {
    const s = el as HTMLSelectElement;
    return s.selectedIndex >= 0 ? s.options[s.selectedIndex]!.text.replace(/\s+/g, ' ').trim() : '';
  });
  return { ok: sameValue(actual, best), actualValue: actual };
}

async function readOptions(combo: Locator): Promise<string[]> {
  return combo.evaluate((el) => {
    const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    const listbox = id ? document.getElementById(id) : null;
    const scope = listbox ?? el.closest('[class*="container"], [class*="shell"]') ?? el.parentElement;
    return [...(scope?.querySelectorAll('[role="option"]') ?? [])]
      .filter((o) => o.getClientRects().length > 0)
      .map((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim());
  });
}

/** Poll for options; async searches show "Loading…" first. Returns the last non-empty, stable list. */
async function waitForOptions(combo: Locator, timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let last: string[] = [];
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    const now = await readOptions(combo);
    if (now.length > 0 && now.join('\n') === last.join('\n')) return now;
    last = now;
  }
  return last;
}

async function comboDisplayValue(combo: Locator): Promise<string> {
  return combo.evaluate((el) => {
    const control = el.closest('[class*="control"]') ?? el.parentElement;
    const single = control?.querySelector('[class*="single-value"]');
    return (single?.textContent ?? (el as HTMLInputElement).value ?? '').replace(/\s+/g, ' ').trim();
  });
}

async function clearTyped(combo: Locator): Promise<void> {
  await combo.press('ControlOrMeta+a');
  await combo.press('Backspace');
}

/**
 * Pick from a custom dropdown (react-select style `role=combobox`). Tries the full
 * option list first, then searches with the text before the first comma, then the
 * first 20 characters. `root` is the frame's `body` locator (options may be portaled).
 * Returns ok:false when nothing matches (caller flags the field red).
 */
export async function pickCombobox(combo: Locator, optionText: string, root: Locator): Promise<FillResult> {
  await combo.scrollIntoViewIfNeeded();
  await combo.focus();
  const queries = [...new Set([null, optionText.split(',')[0]!.trim(), optionText.slice(0, 20)])];

  for (const query of queries) {
    if (query === null) {
      await combo.press('ArrowDown');
    } else {
      await clearTyped(combo);
      await combo.pressSequentially(query, { delay: 25 });
    }
    const options = await waitForOptions(combo, query === null ? 1000 : 4000);
    const best = bestOption(optionText, options);
    if (!best) continue;

    const index = options.indexOf(best);
    await combo.evaluate((el, i) => {
      document.querySelectorAll('[data-applypipe-option]').forEach((o) => o.removeAttribute('data-applypipe-option'));
      const id = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
      const listbox = id ? document.getElementById(id) : null;
      const scope = listbox ?? el.closest('[class*="container"], [class*="shell"]') ?? el.parentElement;
      const visible = [...(scope?.querySelectorAll('[role="option"]') ?? [])].filter((o) => o.getClientRects().length > 0);
      visible[i]?.setAttribute('data-applypipe-option', '1');
    }, index);
    await safeClick(root.locator('[data-applypipe-option="1"]'));
    // The control may show a shorter form of the option ("United States" for "United States +1").
    const actual = await comboDisplayValue(combo);
    return { ok: actual !== '' && bestOption(actual, [best]) !== null, actualValue: actual };
  }

  await combo.press('Escape');
  await clearTyped(combo).catch(() => {});
  return { ok: false };
}

/** Check the radio in a group whose label best matches `optionText`. `group` matches all radios of the group. */
export async function setRadio(group: Locator, optionText: string): Promise<FillResult> {
  const labels = await group.evaluateAll((els) =>
    els.map((e) => (window as unknown as { __applypipe: { optionLabel(el: Element): string } }).__applypipe.optionLabel(e)),
  );
  const best = bestOption(optionText, labels);
  if (!best) return { ok: false };
  const radio = group.nth(labels.indexOf(best));
  await radio.scrollIntoViewIfNeeded();
  await radio.check();
  return { ok: await radio.isChecked(), actualValue: best };
}

export async function setCheckbox(box: Locator, checked: boolean): Promise<FillResult> {
  await box.scrollIntoViewIfNeeded();
  await box.setChecked(checked);
  const now = await box.isChecked();
  return { ok: now === checked, actualValue: String(now) };
}

/**
 * Attach a file and wait (≤15 s) for the filename to show up near the input.
 * `container` is a locator for the upload's surrounding group, captured before
 * upload because some ATSs replace the input once a file is attached.
 */
export async function uploadFile(input: Locator, path: string, container: Locator): Promise<FillResult> {
  const name = basename(path);
  await input.setInputFiles(path);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await container.innerText().catch(() => '')).includes(name)) return { ok: true, actualValue: name };
    await new Promise((r) => setTimeout(r, 300));
  }
  // No filename shown: accept it if the input itself still holds the file.
  const files =
    (await input.count()) > 0
      ? await input.evaluate((el) => [...((el as HTMLInputElement).files ?? [])].map((f) => f.name)).catch(() => [])
      : [];
  return files.includes(name) ? { ok: true, actualValue: name } : { ok: false };
}
