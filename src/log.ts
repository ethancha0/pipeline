import { pino } from 'pino';
import pretty from 'pino-pretty';

export const MASK = '••••';

const secrets = new Set<string>();

/** Register a value (token, API key, password) that must never appear in a log line. */
export function registerSecret(value: string | undefined | null): void {
  // Very short values would mask ordinary words; real secrets are long.
  if (value && value.length >= 4) secrets.add(value);
}

/** Replace every registered secret in `text` with ••••. */
export function maskSecrets(text: string): string {
  let out = text;
  // Longest first so a secret that contains another is masked whole.
  for (const s of [...secrets].sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(MASK);
  }
  return out;
}

/** Deep-mask strings inside a log object (objects/arrays are copied, not mutated). */
export function maskDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value === 'string') return maskSecrets(value) as T;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return value;
  seen.add(value);
  if (value instanceof Error) {
    const err = new Error(maskSecrets(value.message));
    err.name = value.name;
    if (value.stack) err.stack = maskSecrets(value.stack);
    return err as T;
  }
  if (Array.isArray(value)) return value.map((v) => maskDeep(v, seen)) as T;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = maskDeep(v, seen);
  return out as T;
}

const level = process.env.LOG_LEVEL ?? 'info';

export const log = pino(
  {
    level,
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((a) => maskDeep(a)) as Parameters<typeof method>);
      },
    },
  },
  // Synchronous pretty stream so lines aren't lost when a short CLI command exits.
  pretty({ colorize: process.stdout.isTTY, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname', sync: true }),
);
