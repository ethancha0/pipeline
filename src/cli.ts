import { Command } from 'commander';
import { ConfigError, ensureHome, loadConfig, type Paths } from './config.js';
import { openDb } from './db/db.js';
import { DiscordLoginError, startBot, type Bot } from './discord/bot.js';
import { countJobs, JOB_STATUSES, listByStatus, type Job } from './db/jobs.js';
import { log } from './log.js';
import {
  checkResume,
  issuesBySection,
  loadProfile,
  parseProfile,
  readProfileYaml,
  resumePath,
  type ProfileIssue,
} from './profile/load.js';
import { resumeSchema, type LockedAnswers } from './profile/schema.js';

const program = new Command()
  .name('applypipe')
  .description('Discord ✅ → Chrome tab parked on the review page. Never submits.');

// ── run ──────────────────────────────────────────────────────────────────────

program
  .command('run')
  .description('start the Discord bot: catch up on missed ✅, then queue live ones (Ctrl-C to stop)')
  .action(async () => {
    const { paths, env } = loadConfig();
    const profile = parseProfileOrThrow(paths);
    const resumeProblem = checkResume(resumePath(profile.resume, paths));
    if (resumeProblem) throw new ConfigError(`Invalid ${paths.profileFile}`, [`resume.path — ${resumeProblem}`]);

    const { db, migration } = openDb(paths.dbFile);
    if (migration.from === migration.to) log.info(`database ${paths.dbFile} up to date (schema v${migration.to})`);
    else log.info(`database ${paths.dbFile} migrated v${migration.from} → v${migration.to}`);

    // An external failure must never crash the run (CLAUDE.md rule 5).
    process.on('unhandledRejection', (err) => log.error({ err }, 'unhandled rejection'));

    let bot: Bot;
    try {
      bot = await startBot(env, db);
    } catch (err) {
      db.close();
      if (err instanceof DiscordLoginError) throw new ConfigError(err.message);
      throw err;
    }

    await new Promise<void>((done) => {
      let stopping = false;
      const shutdown = () => {
        if (stopping) {
          log.warn('forced exit');
          process.exit(1);
        }
        stopping = true;
        log.info('shutting down… (Ctrl-C again to force)');
        bot
          .stop()
          .catch((err: unknown) => log.error({ err }, 'error while stopping the bot'))
          .finally(() => {
            db.close();
            log.info('stopped');
            done();
          });
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  });

function parseProfileOrThrow(paths: Paths) {
  const result = loadProfile(paths);
  if (!result.ok) {
    throw new ConfigError(
      `Invalid ${paths.profileFile}`,
      result.issues.map((i) => `${i.path} — ${i.message}`),
    );
  }
  return result.profile;
}

// ── status ───────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('jobs grouped by status (last 7 days by default)')
  .option('--all', 'include jobs older than 7 days')
  .option('--json', 'print JSON instead of a table')
  .action((opts: { all?: boolean; json?: boolean }) => {
    const paths = ensureHome();
    const { db } = openDb(paths.dbFile);
    try {
      const since = opts.all ? undefined : new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
      const jobs = listByStatus(db, [], { since });
      if (opts.json) {
        console.log(JSON.stringify(jobs, null, 2));
      } else if (jobs.length > 0) {
        console.log(formatStatusTable(jobs));
      } else if (countJobs(db) === 0) {
        console.log('No jobs yet.');
      } else {
        console.log('No jobs in the last 7 days. Use --all to see older ones.');
      }
    } finally {
      db.close();
    }
  });

function formatStatusTable(jobs: Job[]): string {
  const header = ['ID', 'COMPANY', 'TITLE', 'ATS', 'STATUS', 'REASON', 'UPDATED'];
  const rows: string[][] = [];
  for (const status of JOB_STATUSES) {
    for (const j of jobs.filter((job) => job.status === status)) {
      rows.push([
        j.id.slice(0, 8),
        truncate(j.company ?? '—', 24),
        truncate(j.title ?? '—', 36),
        j.ats,
        j.status,
        truncate(j.needsReason ?? '', 40),
        new Date(j.updatedAt).toLocaleString(),
      ]);
    }
  }
  const widths = header.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c]!.length)));
  const line = (cells: string[]) => cells.map((cell, c) => cell.padEnd(widths[c]!)).join('  ').trimEnd();
  return [line(header), ...rows.map(line)].join('\n');
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── profile check ────────────────────────────────────────────────────────────

program
  .command('profile')
  .description('profile commands')
  .command('check')
  .description('validate profile.yaml and the resume file')
  .action(() => {
    const paths = ensureHome();
    console.log(`Profile: ${paths.profileFile}\n`);

    const raw = readProfileYaml(paths);
    if (!raw.ok) {
      printIssues(raw.issues);
      process.exitCode = 1;
      return;
    }

    const result = parseProfile(raw.data);
    const bySection = issuesBySection(result.ok ? [] : result.issues);

    // The resume file check only needs the resume section, so it runs even if other sections fail.
    const resumeSection = resumeSchema.safeParse((raw.data as { resume?: unknown } | null)?.resume);
    if (resumeSection.success) {
      const problem = checkResume(resumePath(resumeSection.data, paths));
      if (problem) bySection.get('resume')!.push({ path: 'resume.path', message: problem });
    }

    let failed = false;
    for (const [section, issues] of bySection) {
      if (issues.length === 0) {
        console.log(`✅ ${section}`);
      } else {
        failed = true;
        console.log(`❌ ${section}`);
        printIssues(issues, '     ');
      }
    }

    if (result.ok) {
      console.log(`\nResume: ${resumePath(result.profile.resume, paths)}`);
      console.log('\nLocked answers (filled only from this file, never guessed):');
      for (const line of describeLocked(result.locked)) console.log(`  ${line}`);
    }

    process.exitCode = failed ? 1 : 0;
  });

function printIssues(issues: ProfileIssue[], indent = '❌ '): void {
  for (const i of issues) console.log(`${indent}${i.path} — ${i.message}`);
}

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

function describeLocked(l: LockedAnswers): string[] {
  const { city, state, country, zip } = l.location;
  // EEO values are never printed, only whether an answer is set or declined.
  const eeo = Object.entries(l.eeo)
    .map(([k, v]) => `${k} ${v.trim().toLowerCase() === 'decline' ? 'decline' : 'set'}`)
    .join(', ');
  return [
    `work_auth   authorized in US: ${yesNo(l.work_auth.authorized_us)} · sponsorship now: ${yesNo(
      l.work_auth.needs_sponsorship_now,
    )} · sponsorship later: ${yesNo(l.work_auth.needs_sponsorship_future)}`,
    `graduation  ${l.graduation}`,
    `location    ${[city, state, country, zip].filter(Boolean).join(', ')}`,
    `eeo         ${eeo}`,
    ...l.standard.map((a) => `locked      "${a.question}" → ${a.answer}`),
  ];
}

// ── setup password (Phase 5) ─────────────────────────────────────────────────

program
  .command('setup')
  .description('setup commands')
  .command('password')
  .description('store the Workday password in macOS Keychain')
  .action(() => {
    console.error('setup password lands in Phase 5 (secrets/keychain.ts); nothing was stored.');
    process.exitCode = 1;
  });

// ── entry ────────────────────────────────────────────────────────────────────

try {
  await program.parseAsync();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`❌ ${err.message}`);
    for (const p of err.problems) console.error(`   ${p}`);
  } else {
    log.error(err);
  }
  process.exitCode = 1;
}
