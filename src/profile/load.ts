import { existsSync, openSync, readFileSync, readSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml, YAMLParseError } from 'yaml';
import type { z } from 'zod';
import { expandHome, type Paths } from '../config.js';
import { profileSchema, PROFILE_SECTIONS, type LockedAnswers, type Profile } from './schema.js';

export interface ProfileIssue {
  /** Dotted key path, e.g. `work_auth` or `education.0.end` */
  path: string;
  message: string;
}

export type ProfileResult =
  | { ok: true; profile: Profile; locked: LockedAnswers }
  | { ok: false; issues: ProfileIssue[] };

export function formatPath(path: readonly PropertyKey[]): string {
  return path.map(String).join('.') || '(root)';
}

function toIssues(error: z.ZodError): ProfileIssue[] {
  return error.issues.map((i) => ({ path: formatPath(i.path), message: i.message }));
}

/** Validate already-parsed YAML data. Pure: no file access. */
export function parseProfile(data: unknown): ProfileResult {
  const result = profileSchema.safeParse(data ?? {}, {
    error: (iss) => (iss.input === undefined ? 'missing' : undefined),
  });
  if (!result.success) return { ok: false, issues: toIssues(result.error) };
  return { ok: true, profile: result.data, locked: deriveLocked(result.data) };
}

export function deriveLocked(profile: Profile): LockedAnswers {
  // Schema guarantees at least one education entry.
  const current = profile.education[0]!;
  return {
    work_auth: profile.work_auth,
    graduation: current.end,
    location: profile.identity.location,
    eeo: profile.eeo,
    standard: profile.standard_answers
      .filter((a) => a.locked)
      .map(({ question, answer }) => ({ question, answer })),
  };
}

/** Absolute resume path: profile value (with ~ expanded) or `<home>/resume.pdf`. */
export function resumePath(resume: Profile['resume'], paths: Paths): string {
  return resume.path ? resolve(paths.home, expandHome(resume.path)) : paths.defaultResume;
}

/** Returns null if the file exists and starts with the PDF magic bytes, else a problem. */
export function checkResume(path: string): string | null {
  if (!existsSync(path)) return `file not found: ${path}`;
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(5);
    readSync(fd, head, 0, 5, 0);
    return head.toString('latin1') === '%PDF-' ? null : `not a PDF: ${path}`;
  } finally {
    closeSync(fd);
  }
}

/** Read and YAML-parse `<home>/profile.yaml` without validating it. */
export function readProfileYaml(paths: Paths): { ok: true; data: unknown } | { ok: false; issues: ProfileIssue[] } {
  if (!existsSync(paths.profileFile)) {
    return {
      ok: false,
      issues: [{ path: '(file)', message: `${paths.profileFile} not found; copy profile.example.yaml there` }],
    };
  }
  try {
    return { ok: true, data: parseYaml(readFileSync(paths.profileFile, 'utf8')) };
  } catch (err) {
    const message = err instanceof YAMLParseError ? err.message : String(err);
    return { ok: false, issues: [{ path: '(yaml)', message }] };
  }
}

/** Read and validate `<home>/profile.yaml`. YAML syntax errors come back as issues too. */
export function loadProfile(paths: Paths): ProfileResult {
  const raw = readProfileYaml(paths);
  return raw.ok ? parseProfile(raw.data) : raw;
}

/** Group issues by top-level section so callers can print ✅/❌ per section. */
export function issuesBySection(issues: ProfileIssue[]): Map<string, ProfileIssue[]> {
  const map = new Map<string, ProfileIssue[]>(PROFILE_SECTIONS.map((s) => [s, []]));
  for (const issue of issues) {
    const section = issue.path.split('.')[0]!;
    if (!map.has(section)) map.set(section, []);
    map.get(section)!.push(issue);
  }
  return map;
}
