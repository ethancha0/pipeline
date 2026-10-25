import { chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { registerSecret } from './log.js';

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface Paths {
  home: string;
  envFile: string;
  profileFile: string;
  defaultResume: string;
  dbFile: string;
  answerBankFile: string;
  chromeProfile: string;
  artifacts: string;
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p;
}

export function resolvePaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const home = resolve(expandHome(env.APPLYPIPE_HOME?.trim() || '~/.applypipe'));
  return {
    home,
    envFile: join(home, '.env'),
    profileFile: join(home, 'profile.yaml'),
    defaultResume: join(home, 'resume.pdf'),
    dbFile: join(home, 'applypipe.db'),
    answerBankFile: join(home, 'answer-bank.json'),
    chromeProfile: join(home, 'chrome-profile'),
    artifacts: join(home, 'artifacts'),
  };
}

/** Resolve APPLYPIPE_HOME and create it plus artifacts/ and chrome-profile/ (mode 700). */
export function ensureHome(env: NodeJS.ProcessEnv = process.env): Paths {
  const paths = resolvePaths(env);
  for (const dir of [paths.home, paths.artifacts, paths.chromeProfile]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
  }
  return paths;
}

// Blank values in .env (`KEY=`) count as unset.
const blankToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord ID (17–20 digits)');

export const envSchema = z.object({
  DISCORD_TOKEN: z.preprocess(blankToUndef, z.string()),
  DISCORD_CHANNEL_ID: z.preprocess(blankToUndef, snowflake),
  DISCORD_OWNER_ID: z.preprocess(blankToUndef, snowflake),
  // V2 (Phase 7+): optional until the answer brain lands.
  ANTHROPIC_API_KEY: z.preprocess(blankToUndef, z.string().optional()),
  ANTHROPIC_MODEL: z.preprocess(blankToUndef, z.string().optional()),
  MAX_PARALLEL: z.preprocess(blankToUndef, z.coerce.number().int().min(1).max(10).default(3)),
  CATCHUP_DAYS: z.preprocess(blankToUndef, z.coerce.number().int().min(1).default(14)),
  LLM_CONFIDENCE_FLAG: z.preprocess(blankToUndef, z.coerce.number().min(0).max(1).default(0.7)),
});

export type Env = z.infer<typeof envSchema>;

export interface Config {
  paths: Paths;
  env: Env;
}

/**
 * Load `<home>/.env` and validate it. Values already set in the process
 * environment win over the file. Secrets are registered with the log masker.
 */
export function loadConfig(processEnv: NodeJS.ProcessEnv = process.env): Config {
  const paths = ensureHome(processEnv);
  const fileVars = existsSync(paths.envFile) ? parseDotenv(readFileSync(paths.envFile)) : {};
  const merged = { ...fileVars, ...processEnv };

  const result = envSchema.safeParse(merged, {
    error: (iss) => (iss.input === undefined ? 'missing' : undefined),
  });
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')} — ${i.message}`);
    const where = existsSync(paths.envFile) ? paths.envFile : `${paths.envFile} (file not found; copy env.example)`;
    throw new ConfigError(`Invalid settings in ${where}`, problems);
  }

  registerSecret(result.data.DISCORD_TOKEN);
  registerSecret(result.data.ANTHROPIC_API_KEY);
  return { paths, env: result.data };
}
