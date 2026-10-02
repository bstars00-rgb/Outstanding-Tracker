import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFixtureModel } from '../fixtures/fixture-model';

/**
 * Safety gates of automation/teams-graph/post-weekly.cjs, exercised end to end against STUB Graph modules
 * (no network, no real token): dry-run by default, test target before prod, one post per report date and
 * target, --resend to re-post, stale reports refused.
 */
const SCRIPT = resolve('automation/teams-graph/post-weekly.cjs');
let dir: string;
let posts: string;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function run(...args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WEEKLY_POST_TARGETS: join(dir, 'targets.json'), WEEKLY_POST_OUT_DIR: join(dir, 'out'), WEEKLY_POST_STATE_DIR: join(dir, 'state'), STUB_POSTS: posts },
  });
  return { out: `${r.stdout}${r.stderr}`, code: r.status };
}
async function sent(): Promise<{ url: string; payload: any }[]> {
  if (!existsSync(posts)) return [];
  return (await readFile(posts, 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

async function writeReport(date: string) {
  const { model, insight } = await buildFixtureModel('2026-09-05', { lang: 'ko' });
  await mkdir(join(dir, 'out'), { recursive: true });
  await writeFile(join(dir, 'out', 'tracker-model.json'), JSON.stringify({ ...model, reference_date: date }));
  await writeFile(join(dir, 'out', 'insight.json'), JSON.stringify(insight));
}

const MSAL_STUB = `exports.LogLevel = { Error: 0 };
exports.PublicClientApplication = class {
  getTokenCache() { return { getAllAccounts: async () => [{ username: 'stub' }] }; }
  async acquireTokenSilent() { return { accessToken: 'stub-token' }; }
  async acquireTokenByDeviceCode() { throw new Error('device code must not be used in tests'); }
};`;

const AXIOS_STUB = `const fs = require('fs');
exports.get = async () => ({ data: { value: [
  { id: '19:test-chat@thread.v2', chatType: 'group', topic: 'Tracker Test', members: [{}, {}] },
  { id: '19:prod-chat@thread.v2', chatType: 'group', topic: 'Outstanding', members: [{}, {}, {}] },
  { id: '19:other@thread.v2', chatType: 'group', topic: 'Outstanding archive', members: [{}] },
  { id: '19:one@unq.gbl.spaces', chatType: 'oneOnOne', topic: null, members: [{}, {}] },
] } });
exports.post = async (url, payload, cfg) => {
  fs.appendFileSync(process.env.STUB_POSTS, JSON.stringify({ url, payload, auth: cfg.headers.Authorization }) + '\\n');
  return { status: 201, data: {} };
};`;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ot-graph-'));
  posts = join(dir, 'posts.jsonl');
  const nm = join(dir, 'node_modules');
  await mkdir(join(nm, '@azure', 'msal-node'), { recursive: true });
  await mkdir(join(nm, 'axios'), { recursive: true });
  await writeFile(join(nm, '@azure', 'msal-node', 'index.js'), MSAL_STUB);
  await writeFile(join(nm, 'axios', 'index.js'), AXIOS_STUB);
  await writeFile(join(dir, 'graph-config.json'), JSON.stringify({ clientId: 'stub-client', tenantId: 'stub-tenant' }));
  await writeFile(
    join(dir, 'targets.json'),
    JSON.stringify({
      auth: { graphConfig: join(dir, 'graph-config.json'), msalCache: join(dir, 'msal-cache.json'), nodeModules: nm },
      siteUrl: 'https://example.github.io/tracker/',
      defaultTarget: 'test',
      targets: [
        { name: 'test', role: 'test', type: 'chat', topic: 'Tracker Test' },
        { name: 'leaders', role: 'prod', type: 'chat', topic: 'Outstanding' },
      ],
    }),
  );
  await writeReport(today);
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Teams Graph posting: safety gates (stubbed Graph)', () => {
  it('resolves targets by exact chat name and masks the ids', () => {
    const r = run('resolve');
    expect(r.out).toContain('test [test · chat] → OK  Tracker Test');
    expect(r.out).toContain('leaders [prod · chat] → OK  Outstanding (멤버 3명)'); // exact name wins over "Outstanding archive"
    expect(r.out).not.toContain('prod-chat@thread.v2');
  });

  it('is a dry run by default: writes the card preview and posts nothing', async () => {
    const r = run('post');
    expect(r.out).toContain('[DRY-RUN]');
    expect(existsSync(join(dir, 'out', 'teams-graph-card.json'))).toBe(true);
    expect(await sent()).toHaveLength(0);
  });

  it('refuses the prod target until a test post has succeeded', async () => {
    const r = run('post', '--send', '--target=leaders');
    expect(r.out).toContain('테스트 타깃으로 먼저');
    expect(r.code).toBe(3);
    expect(await sent()).toHaveLength(0);
  });

  it('posts one Adaptive Card to the test chat, then blocks a duplicate unless --resend', async () => {
    expect(run('post', '--send').out).toContain('✓ 게시 완료 → Tracker Test');
    let s = await sent();
    expect(s).toHaveLength(1);
    expect(s[0].url).toBe('https://graph.microsoft.com/v1.0/chats/19:test-chat@thread.v2/messages');
    const att = s[0].payload.attachments[0];
    expect(att.contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(s[0].payload.body).toEqual({ contentType: 'html', content: `<attachment id="${att.id}"></attachment>` });
    const card = JSON.parse(att.content);
    expect(card.type).toBe('AdaptiveCard');
    expect(card.body[0].text).toContain('[테스트 발송]');
    expect(card.actions[0]).toMatchObject({ type: 'Action.OpenUrl', url: 'https://example.github.io/tracker/#/?lang=ko' });

    const dup = run('post', '--send');
    expect(dup.out).toContain('이미 게시됨');
    expect(await sent()).toHaveLength(1);
    expect(run('post', '--send', '--resend').out).toContain('✓ 게시 완료');
    s = await sent();
    expect(s).toHaveLength(2);
  });

  it('allows the prod target after the test post, once per report date, without the test banner', async () => {
    expect(run('post', '--send', '--target=leaders').out).toContain('✓ 게시 완료 → Outstanding');
    const s = await sent();
    expect(s).toHaveLength(3);
    expect(s[2].url).toContain('19:prod-chat@thread.v2');
    expect(s[2].payload.attachments[0].content).not.toContain('테스트 발송');
    expect(run('post', '--send', '--target=leaders').code).toBe(3);
    expect(await sent()).toHaveLength(3);
  });

  it('waives the test-first gate only when the targets file says requireTestFirst: false', async () => {
    const cfgPath = join(dir, 'targets.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    await rm(join(dir, 'state'), { recursive: true, force: true }); // forget the earlier test post and locks
    expect(run('post', '--send', '--target=leaders').code).toBe(3);
    await writeFile(cfgPath, JSON.stringify({ ...cfg, requireTestFirst: false }));
    expect(run('post', '--send', '--target=leaders').out).toContain('✓ 게시 완료 → Outstanding');
    expect(await sent()).toHaveLength(4);
    await writeFile(cfgPath, JSON.stringify(cfg));
  });

  it('sharePassword: the posted card carries the password from the environment, the preview file never does', async () => {
    const cfgPath = join(dir, 'targets.json');
    const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
    await writeFile(cfgPath, JSON.stringify({ ...cfg, sharePassword: true }));
    const env = { ...process.env, WEEKLY_POST_TARGETS: cfgPath, WEEKLY_POST_OUT_DIR: join(dir, 'out'), WEEKLY_POST_STATE_DIR: join(dir, 'state'), STUB_POSTS: posts, DATA_PUBLISH_PASSWORD: 'Stub-Secret-77' };
    const dry = spawnSync(process.execPath, [SCRIPT, 'post', '--print'], { encoding: 'utf8', env });
    expect(`${dry.stdout}${dry.stderr}`).not.toContain('Stub-Secret-77');
    expect(await readFile(join(dir, 'out', 'teams-graph-card.json'), 'utf8')).not.toContain('Stub-Secret-77');
    const before = (await sent()).length;
    const live = spawnSync(process.execPath, [SCRIPT, 'post', '--send', '--resend'], { encoding: 'utf8', env });
    expect(`${live.stdout}${live.stderr}`).toContain('접속 비밀번호 포함');
    expect(`${live.stdout}${live.stderr}`).not.toContain('Stub-Secret-77');
    const s = await sent();
    expect(s).toHaveLength(before + 1);
    expect(s[s.length - 1].payload.attachments[0].content).toContain('트래커 접속 비밀번호: Stub-Secret-77');
    // opted in but no password available => refuse instead of posting a card without it
    const none = spawnSync(process.execPath, [SCRIPT, 'post', '--send', '--resend'], { encoding: 'utf8', env: { ...env, DATA_PUBLISH_PASSWORD: '' } });
    expect(`${none.stdout}${none.stderr}`).toContain('DATA_PUBLISH_PASSWORD');
    expect(await sent()).toHaveLength(before + 1);
    await writeFile(cfgPath, JSON.stringify(cfg));
  });

  it('refuses to send a stale report', async () => {
    await writeReport('2026-01-05');
    const r = run('post', '--send');
    expect(r.out).toContain('묵은 내용');
    expect(await sent()).toHaveLength(5);
    await writeReport(today);
  });
});
