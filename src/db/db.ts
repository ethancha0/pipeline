import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * Ordered migrations; index + 1 is the schema version they bring the DB to.
 * Append new entries — never edit or reorder applied ones.
 */
export const MIGRATIONS: readonly string[] = [readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')];

export const SCHEMA_VERSION = MIGRATIONS.length;

export interface MigrationResult {
  from: number;
  to: number;
}

export function migrate(db: Db): MigrationResult {
  const from = db.pragma('user_version', { simple: true }) as number;
  if (from > SCHEMA_VERSION) {
    throw new Error(`database is at schema v${from}, newer than this build (v${SCHEMA_VERSION})`);
  }
  for (let v = from; v < SCHEMA_VERSION; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return { from, to: SCHEMA_VERSION };
}

/** Open (creating if needed) the SQLite file with WAL and foreign keys, then migrate. */
export function openDb(file: string): { db: Db; migration: MigrationResult } {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return { db, migration: migrate(db) };
}

export const nowIso = (): string => new Date().toISOString();
