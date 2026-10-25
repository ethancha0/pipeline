import { basename } from 'node:path';
import type { Frame, Locator } from 'playwright';
import type { Flag } from '../db/fills.js';
import { fillText, pickCombobox, selectNative, setCheckbox, setRadio, uploadFile, type FillResult } from '../browser/fill.js';
import { SubmitGuardError } from '../browser/guard.js';
import { controlLocator, discoverControls } from '../browser/inpage.js';
import { log } from '../log.js';
import type { FillContext, FormField } from './types.js';

/** Discover the form's fields in `frame` under `root`, skipping `exclude` matches. */
export async function discoverFields(frame: Frame, root: string | null, exclude: string | null, pageIndex = 0): Promise<FormField[]> {
  const controls = await discoverControls(frame, root, exclude);
  return controls.map((c) => ({ ...c, locator: controlLocator(frame, c.fieldKey), pageIndex }));
}

export interface FillSummary {
  total: number;
  filled: number;
  red: string[];
  yellow: string[];
}

const truthy = (v: string) => /^(true|yes|y|1|checked)$/i.test(v.trim());

async function fillOne(field: FormField, value: string, root: Locator): Promise<FillResult> {
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'date':
      return fillText(field.locator, field.maxLength ? value.slice(0, field.maxLength) : value);
    case 'select':
      return selectNative(field.locator, value);
    case 'combobox':
      return pickCombobox(field.locator, value, root);
    case 'radio':
      return setRadio(field.locator, value);
    case 'checkbox':
      return setCheckbox(field.locator, truthy(value));
    case 'file': {
      // Tag the upload's group first: some ATSs swap the input out once a file is attached.
      const tag = `upload-${field.fieldKey}`;
      await field.locator.evaluate((el, t) => {
        const group = el.closest('[role="group"], fieldset, .field-wrapper, .field') ?? el.parentElement ?? el;
        group.setAttribute('data-applypipe-upload', t);
      }, tag);
      return uploadFile(field.locator, value, root.locator(`[data-applypipe-upload="${tag}"]`));
    }
  }
}

const isClosedPageError = (err: unknown) => /Target (page|closed)|has been closed|Frame was detached/i.test(String(err));

/**
 * The common loop: for each field ask the answer provider, fill through
 * browser/fill.ts, and record a `field_fills` row. Required fields left blank or
 * not fillable are flagged red; optional unanswered fields are left blank, unflagged.
 */
export async function fillFields(ctx: FillContext, fields: FormField[], root: Locator): Promise<FillSummary> {
  const summary: FillSummary = { total: fields.length, filled: 0, red: [], yellow: [] };

  for (const field of fields) {
    const answer = await ctx.answers.resolve(field, ctx.job);
    let flag: Flag | null = answer.flag ?? null;
    let filledValue: string | null = null;

    if (answer.value === null) {
      if (field.required && !flag) flag = 'red';
    } else {
      try {
        const result = await fillOne(field, answer.value, root);
        if (result.ok) {
          filledValue = field.type === 'file' ? basename(answer.value) : (result.actualValue ?? answer.value);
          summary.filled++;
        } else {
          flag = 'red';
        }
      } catch (err) {
        if (err instanceof SubmitGuardError || isClosedPageError(err)) throw err;
        log.warn({ job: ctx.job.id, field: field.label, err: String(err) }, 'fill failed');
        flag = 'red';
      }
    }

    if (flag === 'red') summary.red.push(field.label);
    if (flag === 'yellow') summary.yellow.push(field.label);
    ctx.fills.record({
      pageIndex: field.pageIndex,
      fieldKey: field.fieldKey,
      questionText: field.label,
      category: answer.category,
      fieldType: field.type,
      options: field.options,
      required: field.required,
      maxLength: field.maxLength,
      filledValue,
      source: filledValue === null ? 'none' : answer.source,
      confidence: answer.confidence,
      flag,
    });
    log.debug({ job: ctx.job.id, field: field.label, type: field.type, value: filledValue, flag }, 'field');
  }
  return summary;
}

/** "3 fields need you" etc. */
export function needsReason(red: string[]): string {
  return `${red.length} field${red.length === 1 ? '' : 's'} need${red.length === 1 ? 's' : ''} you`;
}
