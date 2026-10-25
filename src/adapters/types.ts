import type { Locator, Page } from 'playwright';
import type { AnswerProvider } from '../answers/provider.js';
import type { FillRow } from '../db/fills.js';
import type { AtsId, Job } from '../db/jobs.js';
import type { Profile } from '../profile/schema.js';

export type { AtsId };

export interface FormField {
  /** Stable within this form (id / name / automation-id / label hash). */
  fieldKey: string;
  /** Visible question text. */
  label: string;
  type: 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date';
  options?: string[];
  required: boolean;
  maxLength?: number;
  /** Playwright locator for the control (all radios of a group). */
  locator: Locator;
  pageIndex: number;
}

/** Writes `field_fills` rows for the current job. */
export interface FillRecorder {
  record(row: Omit<FillRow, 'jobId'>): void;
}

export interface FillContext {
  page: Page;
  job: Job;
  profile: Profile;
  resumePath: string;
  answers: AnswerProvider;
  fills: FillRecorder;
  credentials: { workdayEmail: string; getWorkdayPassword(): Promise<string> };
  screenshot(name: string): Promise<string>;
}

export type FillOutcome =
  | { status: 'ready'; note?: string }
  | { status: 'needs_you'; reason: string }
  | { status: 'skipped'; reason: string };

export interface AtsAdapter {
  id: AtsId;
  run(ctx: FillContext): Promise<FillOutcome>;
}
