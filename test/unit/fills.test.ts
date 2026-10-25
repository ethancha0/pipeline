import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../../src/db/db.js';
import { captureFinalValues, listFills, recordFill } from '../../src/db/fills.js';
import { insertJob } from '../../src/db/jobs.js';

let db: Db;
let jobId: string;

beforeEach(() => {
  db = openDb(':memory:').db;
  jobId = insertJob(db, { sourceUrl: 'https://boards.greenhouse.io/a/jobs/1' }).id;
  const base = { jobId, pageIndex: 0, required: true, source: 'profile' as const };
  recordFill(db, { ...base, fieldKey: 'first_name', questionText: 'First Name', fieldType: 'text', filledValue: 'Alex' });
  recordFill(db, { ...base, fieldKey: 'phone', questionText: 'Phone', fieldType: 'text', filledValue: '714-747-0796' });
  recordFill(db, { ...base, fieldKey: 'q1', questionText: 'How did you hear about us?', fieldType: 'combobox', filledValue: null, source: 'none', flag: 'red' });
});

describe('field_fills', () => {
  it('upserts by (job, page, field)', () => {
    recordFill(db, { jobId, pageIndex: 0, fieldKey: 'first_name', questionText: 'First Name', fieldType: 'text', required: true, filledValue: 'Al', source: 'profile' });
    expect(listFills(db, jobId).find((f) => f.fieldKey === 'first_name')?.filledValue).toBe('Al');
    expect(listFills(db, jobId)).toHaveLength(3);
  });

  it('captures final values and marks only real edits', () => {
    const edited = captureFinalValues(db, jobId, 0, [
      { fieldKey: 'first_name', label: 'First Name', type: 'text', value: 'Alexander' },
      { fieldKey: 'phone', label: 'Phone', type: 'text', value: '(714) 747-0796' }, // reformatted, not edited
      { fieldKey: 'react-select-x', label: 'How did you hear about us?', type: 'combobox', value: 'LinkedIn' }, // matched by label
      { fieldKey: 'new_q', label: 'Pronouns', type: 'text', value: 'he/him' }, // never seen → inserted
      { fieldKey: 'empty_q', label: 'Middle name', type: 'text', value: '' }, // blank and unseen → ignored
    ]);
    expect(edited).toBe(3);
    const byKey = Object.fromEntries(listFills(db, jobId).map((f) => [f.fieldKey, f]));
    expect(byKey.first_name).toMatchObject({ finalValue: 'Alexander', edited: true });
    expect(byKey.phone).toMatchObject({ finalValue: '(714) 747-0796', edited: false });
    expect(byKey.q1).toMatchObject({ finalValue: 'LinkedIn', edited: true });
    expect(byKey.new_q).toMatchObject({ finalValue: 'he/him', edited: true, source: 'none', filledValue: null });
    expect(byKey.empty_q).toBeUndefined();
    expect(byKey.first_name!.capturedAt).not.toBeNull();
  });
});
