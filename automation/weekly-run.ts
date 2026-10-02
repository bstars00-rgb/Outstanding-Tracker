/**
 * One-command weekly run (manual operation by Global Ops):
 *
 *   npm run weekly -- "<OP workbook.xlsx>" [YYYY-MM-DD] [--push] [--dry-run] [--resend]
 *
 *  1. copy the workbook to automation/input/Outstanding_Report_<date>.xlsx
 *  2. convert it to the tracker dataset (automation/tools/excel_to_dataset.py)
 *  3. run the pipeline: KPIs, SOP, insight, Teams card. The card is POSTED to the Teams channel automatically when
 *     .env has TEAMS_SENDER=live, DRY_RUN=false and the webhook URL for TARGET_CHANNEL; otherwise a preview is written.
 *  4. build the review workbook (automation/out/Outstanding_Review_<date>.xlsx)
 *  5. write the encrypted site bundle when DATA_PUBLISH_PASSWORD is set (public/data/bundle.enc.json)
 *  6. --push: commit + push the bundle so GitHub Pages redeploys
 *
 * Settings come from .env (git-ignored) and the shell environment (the shell wins). Secrets are never printed.
 * A report already posted for the same date/channel is not posted twice; use --resend after a correction.
 */
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  if (existsSync('.env')) process.loadEnvFile('.env');
} catch (e) {
  console.error(`.env could not be loaded: ${(e as Error).message}`);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const workbook = positional[0];
const tz = process.env.REPORT_TIMEZONE ?? 'Asia/Ho_Chi_Minh';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const date = positional[1] ?? today;

if (!workbook || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error('Usage: npm run weekly -- "<OP workbook.xlsx>" [YYYY-MM-DD] [--push] [--dry-run] [--resend]');
  process.exit(2);
}
if (!existsSync(workbook)) {
  console.error(`Workbook not found: ${workbook}`);
  process.exit(2);
}

function run(label: string, cmd: string, cmdArgs: string[], env: NodeJS.ProcessEnv = process.env): string {
  console.log(`\n── ${label}`);
  const r = spawnSync(cmd, cmdArgs, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  process.stdout.write(out);
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${label} failed (exit ${r.status})`);
  return out;
}

const input = `automation/input/Outstanding_Report_${date}.xlsx`;
const dataset = `automation/input/outstanding-${date}.json`;
const review = `automation/out/Outstanding_Review_${date}.xlsx`;
const tsx = resolve('node_modules/tsx/dist/cli.mjs');
const python = process.env.PYTHON ?? 'python';

try {
  await mkdir('automation/input', { recursive: true });
  if (resolve(workbook) !== resolve(input)) await copyFile(workbook, input);

  run('1/5 convert workbook', python, ['automation/tools/excel_to_dataset.py', input, date, dataset], { ...process.env, PYTHONIOENCODING: 'utf-8' });

  const dryRun = flags.has('--dry-run') ? 'true' : (process.env.DRY_RUN ?? 'true');
  const pipelineEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_SOURCE: 'file',
    DATA_FILE: dataset,
    REPORT_DATE: date,
    REPORT_LANGUAGE: process.env.REPORT_LANGUAGE ?? 'ko',
    TRACKER_BASE_URL: process.env.TRACKER_BASE_URL ?? 'https://bstars00-rgb.github.io/Outstanding-Tracker/',
    DRY_RUN: dryRun,
    PUBLISH_DATA: 'true',
    FORCE_RESEND: flags.has('--resend') ? 'true' : (process.env.FORCE_RESEND ?? 'false'),
  };
  const out = run('2/5 pipeline (KPIs, SOP, insight, Teams)', process.execPath, [tsx, 'automation/weekly-report.ts'], pipelineEnv);
  const result = /RESULT (\S+)/.exec(out)?.[1] ?? 'unknown';
  if (result === 'failed') throw new Error('pipeline reported a failure (see log above)');

  if (result !== 'skipped-duplicate') run('3/5 review workbook', python, ['automation/tools/build_review_xlsx.py', 'automation/out', date, review], { ...process.env, PYTHONIOENCODING: 'utf-8' });

  const published = /published public\/data\/bundle\.enc\.json/.test(out);
  if (flags.has('--push')) {
    if (!published) console.log('\n── 4/5 push skipped: no encrypted bundle was written (set DATA_PUBLISH_PASSWORD)');
    else {
      run('4/5 git add', 'git', ['add', 'public/data/bundle.enc.json']);
      const diff = spawnSync('git', ['diff', '--cached', '--quiet']);
      if (diff.status === 0) console.log('bundle unchanged; nothing to commit');
      else {
        run('4/5 git commit', 'git', ['commit', '-q', '-m', `data: publish ${date}`]);
        run('4/5 git push', 'git', ['push', '-q', 'origin', 'HEAD']);
      }
    }
  }

  const teams =
    result === 'sent' ? `posted to the Teams "${pipelineEnv.TARGET_CHANNEL ?? 'test'}" channel` :
    result === 'skipped-duplicate' ? 'already posted for this date (use --resend to post again)' :
    'NOT posted (dry run) — preview in automation/out/teams-message.md';
  console.log(`\n── 5/5 done  report ${date}
  Teams      : ${teams}
  Review     : ${review}
  Message    : automation/out/teams-message.md
  Site bundle: ${published ? 'public/data/bundle.enc.json' + (flags.has('--push') ? ' (pushed)' : ' (commit + push to deploy, or re-run with --push)') : 'not written (DATA_PUBLISH_PASSWORD not set)'}`);
} catch (e) {
  console.error(`\nFAILED: ${(e as Error).message}`);
  process.exit(1);
}
