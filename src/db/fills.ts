import { sameValue } from '../util/text.js';
import { nowIso, type Db } from './db.js';

export type FieldType = 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date';
export type AnswerSource = 'profile' | 'locked' | 'bank' | 'llm' | 'draft' | 'generic' | 'none';
export type Flag = 'yellow' | 'red' | 'green';

export interface FillRow {
  jobId: string;
  pageIndex: number;
  fieldKey: string;
  questionText: string;
  questionKey?: string | null;
  category?: string | null;
  fieldType: FieldType;
  options?: string[] | null;
  required: boolean;
  maxLength?: number | null;
  /** What applypipe put in the field (masked if secret); null when left blank. */
  filledValue: string | null;
  source: AnswerSource;
  confidence?: number | null;
  flag?: Flag | null;
}

export interface StoredFill extends FillRow {
  finalValue: string | null;
  edited: boolean | null;
  capturedAt: string | null;
}

/** Insert or replace the row for (job, page, field). */
export function recordFill(db: Db, row: FillRow): void {
  db.prepare(
    `INSERT INTO field_fills (job_id, page_index, field_key, question_text, question_key, category, field_type,
       options_json, required, max_length, filled_value, source, confidence, flag)
     VALUES (@job_id, @page_index, @field_key, @question_text, @question_key, @category, @field_type,
       @options_json, @required, @max_length, @filled_value, @source, @confidence, @flag)
     ON CONFLICT(job_id, page_index, field_key) DO UPDATE SET
       question_text = excluded.question_text, question_key = excluded.question_key, category = excluded.category,
       field_type = excluded.field_type, options_json = excluded.options_json, required = excluded.required,
       max_length = excluded.max_length, filled_value = excluded.filled_value, source = excluded.source,
       confidence = excluded.confidence, flag = excluded.flag`,
  ).run({
    job_id: row.jobId,
    page_index: row.pageIndex,
    field_key: row.fieldKey,
    question_text: row.questionText,
    question_key: row.questionKey ?? null,
    category: row.category ?? null,
    field_type: row.fieldType,
    options_json: row.options?.length ? JSON.stringify(row.options) : null,
    required: row.required ? 1 : 0,
    max_length: row.maxLength ?? null,
    filled_value: row.filledValue,
    source: row.source,
    confidence: row.confidence ?? null,
    flag: row.flag ?? null,
  });
}

interface FillDbRow {
  job_id: string;
  page_index: number;
  field_key: string;
  question_text: string;
  question_key: string | null;
  category: string | null;
  field_type: FieldType;
  options_json: string | null;
  required: number;
  max_length: number | null;
  filled_value: string | null;
  source: AnswerSource;
  confidence: number | null;
  flag: Flag | null;
  final_value: string | null;
  edited: number | null;
  captured_at: string | null;
}

export function listFills(db: Db, jobId: string): StoredFill[] {
  const rows = db.prepare('SELECT * FROM field_fills WHERE job_id = ? ORDER BY page_index, id').all(jobId) as FillDbRow[];
  return rows.map((r) => ({
    jobId: r.job_id,
    pageIndex: r.page_index,
    fieldKey: r.field_key,
    questionText: r.question_text,
    questionKey: r.question_key,
    category: r.category,
    fieldType: r.field_type,
    options: r.options_json ? (JSON.parse(r.options_json) as string[]) : null,
    required: r.required === 1,
    maxLength: r.max_length,
    filledValue: r.filled_value,
    source: r.source,
    confidence: r.confidence,
    flag: r.flag,
    finalValue: r.final_value,
    edited: r.edited === null ? null : r.edited === 1,
    capturedAt: r.captured_at,
  }));
}

export interface CapturedField {
  fieldKey: string;
  label: string;
  type: string;
  value: string;
}

const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Store the values the owner submitted. Matches by field key, then by label;
 * fields applypipe never saw are inserted with source 'none' so learning sees them.
 * Returns how many rows changed from what applypipe filled.
 */
export function captureFinalValues(db: Db, jobId: string, pageIndex: number, fields: CapturedField[]): number {
  const existing = listFills(db, jobId).filter((f) => f.pageIndex === pageIndex);
  const byKey = new Map(existing.map((f) => [f.fieldKey, f]));
  const byLabel = new Map(existing.map((f) => [labelKey(f.questionText), f]));
  const now = nowIso();
  const update = db.prepare(
    'UPDATE field_fills SET final_value = ?, edited = ?, captured_at = ? WHERE job_id = ? AND page_index = ? AND field_key = ?',
  );
  let edited = 0;

  db.transaction(() => {
    for (const f of fields) {
      const match = byKey.get(f.fieldKey) ?? byLabel.get(labelKey(f.label));
      if (match) {
        const changed = !sameValue(match.filledValue, f.value);
        if (changed) edited++;
        update.run(f.value, changed ? 1 : 0, now, jobId, pageIndex, match.fieldKey);
      } else if (f.value.trim() && f.value !== 'false') {
        recordFill(db, {
          jobId,
          pageIndex,
          fieldKey: f.fieldKey,
          questionText: f.label,
          fieldType: (['text', 'textarea', 'select', 'combobox', 'radio', 'checkbox', 'file', 'date'].includes(f.type)
            ? f.type
            : 'text') as FieldType,
          required: false,
          filledValue: null,
          source: 'none',
        });
        update.run(f.value, 1, now, jobId, pageIndex, f.fieldKey);
        edited++;
      }
    }
  })();
  return edited;
}
