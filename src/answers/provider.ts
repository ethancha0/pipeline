import type { FormField } from '../adapters/types.js';
import type { Job } from '../db/jobs.js';
import type { AnswerSource, Flag } from '../db/fills.js';

export type Category =
  | 'identity'
  | 'contact'
  | 'links'
  | 'education'
  | 'work_auth'
  | 'graduation'
  | 'location'
  | 'eeo'
  | 'availability'
  | 'why_company'
  | 'why_role'
  | 'general';

export interface Answer {
  /** Text to fill, the option to choose, "true"/"false" for checkboxes, or a file path. Null = leave blank. */
  value: string | null;
  source: AnswerSource;
  confidence?: number;
  flag?: Flag;
  category: Category;
}

export interface AnswerProvider {
  resolve(field: FormField, job: Job): Promise<Answer>;
}
