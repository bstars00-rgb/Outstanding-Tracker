// Outstanding Tracker — weekly report → Microsoft Teams via Microsoft Graph (delegated, MSAL token cache).
// Mirrors the CRM project's scripts/post-teams.js: same Azure app, same shared MSAL cache, same safety philosophy.
//
//   node automation/teams-graph/post-weekly.cjs chats                       list my group chats (names only) to pick a target
//   node automation/teams-graph/post-weekly.cjs resolve [--show-ids]        resolve the configured targets (read-only)
//   node automation/teams-graph/post-weekly.cjs post [--target=<name>]      DRY-RUN (default): show target + card JSON
//   node automation/teams-graph/post-weekly.cjs post --send [--target=<name>] [--resend] [--login]
//
// Safety:
//   * dry-run unless --send
//   * one post per report date and target (lock file); --resend (alias --force) only for a corrected re-post
//   * a "prod" target is refused until a "test" target has received a card successfully at least once
//   * --send refuses a report older than MAX_AGE_DAYS (stale content) unless --resend
// Security: clientId / tenantId / token cache / target names live in files only (weekly-post-targets.json is git-ignored).
//   Chat and channel IDs are resolved at run time and are masked in the output unless --show-ids.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
// Paths can be redirected for tests (stub Graph modules, temp state) — never needed in normal operation.
const TARGETS_FILE = process.env.WEEKLY_POST_TARGETS || path.join(__dirname, 'weekly-post-targets.json');
const OUT_DIR = process.env.WEEKLY_POST_OUT_DIR || path.join(ROOT, 'automation', 'out');
const LOCK_DIR = process.env.WEEKLY_POST_STATE_DIR || path.join(ROOT, 'automation', 'state', 'teams-graph');
const MAX_AGE_DAYS = 3;

// Delegated scopes. Group chat: already admin-consented (Chat.ReadWrite) — covers both resolving and posting.
const CHAT_SCOPES = ['Chat.ReadWrite', 'User.Read'];
// Team channel: needs ChannelMessage.Send + Channel.ReadBasic.All (admin consent + one device-code login). Branch only.
const CHANNEL_SCOPES = ['ChannelMessage.Send', 'Channel.ReadBasic.All', 'Team.ReadBasic.All', 'User.Read'];

function loadTargets() {
  if (!fs.existsSync(TARGETS_FILE)) {
    throw new Error(`Missing ${path.relative(ROOT, TARGETS_FILE)} — copy weekly-post-targets.example.json and fill in the chat names.`);
  }
  const cfg = JSON.parse(fs.readFileSync(TARGETS_FILE, 'utf8'));
  for (const k of ['graphConfig', 'msalCache', 'nodeModules']) if (!cfg.auth || !cfg.auth[k]) throw new Error(`weekly-post-targets.json: auth.${k} is required`);
  return cfg;
}

let _graph = null;
function graph(cfg) {
  if (_graph) return _graph;
  const nm = cfg.auth.nodeModules.replace(/[\\/]?$/, '/');
  const { PublicClientApplication, LogLevel } = require(nm + '@azure/msal-node');
  const axios = require(nm + 'axios');
  const app = JSON.parse(fs.readFileSync(cfg.auth.graphConfig, 'utf8'));
  const CACHE = cfg.auth.msalCache;
  const cachePlugin = {
    beforeCacheAccess: async (c) => { if (fs.existsSync(CACHE)) c.tokenCache.deserialize(fs.readFileSync(CACHE, 'utf8')); },
    afterCacheAccess: async (c) => { if (c.cacheHasChanged) fs.writeFileSync(CACHE, c.tokenCache.serialize()); },
  };
  const pca = new PublicClientApplication({
    auth: { clientId: app.clientId, authority: `https://login.microsoftonline.com/${app.tenantId}` },
    cache: { cachePlugin },
    system: { loggerOptions: { piiLoggingEnabled: false, logLevel: LogLevel.Error, loggerCallback: () => {} } },
  });
  _graph = { pca, axios };
  return _graph;
}

async function token(cfg, scopes, allowLogin) {
  const { pca } = graph(cfg);
  const accounts = await pca.getTokenCache().getAllAccounts();
  if (!accounts.length) throw new Error('No account in the MSAL cache (sign in once with the mail/Teams tooling of the REPORT project).');
  try {
    return (await pca.acquireTokenSilent({ account: accounts[0], scopes })).accessToken;
  } catch (e) {
    if (!allowLogin) throw new Error(`Silent token failed for scopes [${scopes.join(', ')}]: ${e.errorCode || e.message}. If consent is in place, re-run with --login for a one-time device-code sign-in.`);
    const r = await pca.acquireTokenByDeviceCode({ scopes, deviceCodeCallback: (i) => console.log('\n=== 권한 동의 / 로그인 필요 ===\n' + i.message + '\n==============================\n') });
    return r.accessToken;
  }
}

const H = (t) => ({ headers: { Authorization: `Bearer ${t}` } });
const inc = (a, b) => String(a || '').toLowerCase().includes(String(b || '').toLowerCase());
const mask = (id) => (id && id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : '****');

async function myChats(cfg, t) {
  const { axios } = graph(cfg);
  let url = 'https://graph.microsoft.com/v1.0/me/chats?$top=50&$expand=members';
  let all = [];
  while (url) {
    const { data } = await axios.get(url, H(t));
    all = all.concat(data.value || []);
    url = data['@odata.nextLink'];
    if (all.length > 300) break;
  }
  return all;
}
async function joinedTeams(cfg, t) { const { data } = await graph(cfg).axios.get('https://graph.microsoft.com/v1.0/me/joinedTeams', H(t)); return data.value || []; }
async function channels(cfg, t, id) { const { data } = await graph(cfg).axios.get(`https://graph.microsoft.com/v1.0/teams/${id}/channels`, H(t)); return data.value || []; }

const scopesFor = (tg) => (tg.type === 'channel' ? CHANNEL_SCOPES : CHAT_SCOPES);

async function resolveTarget(cfg, t, tg) {
  if (tg.type === 'channel') {
    const ts = await joinedTeams(cfg, t);
    const team = ts.find((x) => x.displayName === tg.team) || ts.find((x) => inc(x.displayName, tg.team));
    if (!team) return { ...tg, ok: false, why: `팀 '${tg.team}' 못 찾음` };
    const chs = await channels(cfg, t, team.id);
    const ch = chs.find((c) => c.displayName === tg.channel) || chs.find((c) => inc(c.displayName, tg.channel));
    if (!ch) return { ...tg, ok: false, why: `채널 '${tg.channel}' 못 찾음 (있는 채널: ${chs.map((c) => c.displayName).join(', ')})` };
    return { ...tg, ok: true, id: `${team.id}/${ch.id}`, label: `${team.displayName} › ${ch.displayName}`, url: `https://graph.microsoft.com/v1.0/teams/${team.id}/channels/${ch.id}/messages` };
  }
  if (!tg.topic) return { ...tg, ok: false, why: 'topic(채팅명)이 비어 있음 — weekly-post-targets.json에 입력' };
  const cs = (await myChats(cfg, t)).filter((c) => c.chatType === 'group');
  const exact = cs.filter((x) => x.topic === tg.topic);
  const loose = exact.length ? exact : cs.filter((x) => inc(x.topic, tg.topic));
  if (!loose.length) return { ...tg, ok: false, why: `그룹채팅 '${tg.topic}' 못 찾음` };
  if (loose.length > 1) return { ...tg, ok: false, why: `'${tg.topic}'에 해당하는 채팅이 ${loose.length}개 (${loose.map((c) => c.topic).join(' | ')}) — 정확한 이름으로 지정` };
  const c = loose[0];
  return { ...tg, ok: true, id: c.id, label: `${c.topic} (멤버 ${(c.members || []).length}명)`, url: `https://graph.microsoft.com/v1.0/chats/${c.id}/messages` };
}

// ---------------- card ----------------
function money(n, ccy) {
  const a = Math.abs(n);
  const sym = ccy === 'JPY' ? '¥' : `${ccy} `;
  const body = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 1 : 2)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}K` : `${Math.round(a)}`;
  return `${n < 0 ? '−' : ''}${sym}${body}`;
}
function wow(k, ccy) {
  if (k.change === null || k.change === undefined) return { text: '전주 비교 없음', color: 'Default' };
  if (k.change === 0) return { text: '전주와 동일', color: 'Default' };
  const pct = k.change_pct === null || k.change_pct === undefined ? '' : ` (${k.change > 0 ? '+' : '−'}${Math.abs(k.change_pct * 100).toFixed(1)}%)`;
  return { text: `${k.change > 0 ? '▲' : '▼'} ${money(Math.abs(k.change), ccy)}${pct} WoW`, color: k.change > 0 ? 'Attention' : 'Good' };
}
function tile(label, value, sub, color) {
  return { type: 'Column', width: 'stretch', items: [
    { type: 'TextBlock', text: label, size: 'Small', isSubtle: true, wrap: true },
    { type: 'TextBlock', text: value, size: 'ExtraLarge', weight: 'Bolder', spacing: 'None', wrap: true },
    { type: 'TextBlock', text: sub, size: 'Small', color: color || 'Default', spacing: 'None', wrap: true },
  ] };
}

/** Concise weekly card: key figures + WoW, decisions, actions, and Action.OpenUrl buttons to the published site. */
function buildCard(model, insight, opts) {
  const ccy = model.reporting_currency;
  const kpi = (k) => model.kpis.find((x) => x.key === k);
  const t = model.snapshot.totals;
  const total = kpi('total_outstanding');
  const collected = kpi('collected_this_week');
  const o30 = kpi('overdue_30_plus');
  const l1 = (model.sop_summary || []).find((r) => r.level === 'L1') || { count: 0, amount: 0 };
  const pendingN = t.unrecorded_payment_count || 0;
  const pendingAmt = t.unrecorded_payment_amount || 0;
  const tw = wow(total, ccy);
  const site = String(opts.siteUrl || '').replace(/\/?$/, '/');
  const out = (insight && insight.output) || {};

  const body = [];
  if (opts.test) body.push({ type: 'TextBlock', text: '🧪 [테스트 발송] 자동 게시 기능 확인용', color: 'Accent', weight: 'Bolder', wrap: true });
  body.push({ type: 'TextBlock', text: `📊 주간 미수금 보고 · ${model.reference_date}`, weight: 'Bolder', size: 'Large', wrap: true });
  body.push({ type: 'TextBlock', text: `보고 통화 ${ccy} · 비교 ${model.previous_snapshot_date || '없음(첫 스냅샷)'} · 미결 ${t.invoice_count}건 / ${t.customer_count}개 채널`, isSubtle: true, spacing: 'None', wrap: true });
  body.push({ type: 'ColumnSet', separator: true, spacing: 'Medium', columns: [
    tile('실질 고객 미수', money(total.value, ccy), tw.text, tw.color),
    tile('이번 주 회수', money(collected.value, ccy), `30일+ 연체 ${money(o30.value, ccy)}`, 'Default'),
    tile('입금확인·ELLIS 미반영', pendingN ? money(pendingAmt, ccy) : '0', pendingN ? `${pendingN}건 반영 대기` : '대기 없음', pendingN ? 'Warning' : 'Good'),
  ] });
  const facts = [
    { title: 'SOP L1 (Tier1·¥1M↑)', value: l1.count ? `${l1.count}건 · ${money(l1.amount, ccy)}` : '없음' },
    { title: '법인별 미수', value: (model.aging_by_control_company || []).map((d) => `${d.label.replace('OMH ', '')} ${money(d.total, ccy)}`).join(' · ') || '—' },
  ];
  if (pendingN) facts.push({ title: 'ELLIS 원장 표시', value: `${money(total.value + pendingAmt, ccy)} (실질 + 미반영)` });
  body.push({ type: 'FactSet', spacing: 'Medium', facts });

  const decisions = (out.ceo_decisions || []).slice(0, 2);
  body.push({ type: 'TextBlock', text: '대표님 결정 필요', weight: 'Bolder', separator: true, spacing: 'Medium', wrap: true });
  body.push({ type: 'TextBlock', spacing: 'None', wrap: true, isSubtle: !decisions.length, text: decisions.length ? decisions.map((d) => `• **${d.topic}**${d.customer ? ` — ${d.customer}` : ''}${d.amount !== null && d.amount !== undefined ? ` (${money(d.amount, ccy)})` : ''}`).join('\n\n') : '이번 주 해당 없음' });

  const acts = (out.owner_actions || []).slice(0, 3);
  if (acts.length) {
    body.push({ type: 'TextBlock', text: '이번 주 조치', weight: 'Bolder', spacing: 'Medium', wrap: true });
    body.push({ type: 'TextBlock', spacing: 'None', size: 'Small', wrap: true, text: acts.map((a) => `• **${a.owner}** → ${a.customer} ${money(a.amount, ccy)} · 기한 ${String(a.deadline).slice(0, 10)}`).join('\n\n') });
  }
  body.push({ type: 'TextBlock', text: '상세 수치·인보이스 목록은 트래커에서 확인 (접속 비밀번호 필요)', isSubtle: true, size: 'Small', spacing: 'Medium', wrap: true });

  return {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    type: 'AdaptiveCard',
    version: '1.4',
    msteams: { width: 'Full' },
    body,
    actions: [
      { type: 'Action.OpenUrl', title: '트래커 열기', url: `${site}#/?lang=ko` },
      { type: 'Action.OpenUrl', title: '액션 보드', url: `${site}#/actions?lang=ko` },
      { type: 'Action.OpenUrl', title: '인보이스', url: `${site}#/invoices?lang=ko` },
    ],
  };
}

function loadReport() {
  const mp = path.join(OUT_DIR, 'tracker-model.json');
  const ip = path.join(OUT_DIR, 'insight.json');
  if (!fs.existsSync(mp)) throw new Error('automation/out/tracker-model.json 없음 — 먼저 주간 파이프라인(npm run weekly)을 실행');
  return { model: JSON.parse(fs.readFileSync(mp, 'utf8')), insight: fs.existsSync(ip) ? JSON.parse(fs.readFileSync(ip, 'utf8')) : null };
}

const slug = (s) => String(s).replace(/[^A-Za-z0-9가-힣_-]+/g, '_').slice(0, 40);
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const opt = (name) => (args.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
  const send = has('--send');
  const resend = has('--resend') || has('--force');
  const login = has('--login');
  const showIds = has('--show-ids');
  const cfg = loadTargets();
  const targets = cfg.targets || [];

  if (cmd === 'chats') {
    const t = await token(cfg, CHAT_SCOPES, login);
    const cs = (await myChats(cfg, t)).filter((c) => c.chatType === 'group' && c.topic);
    console.log(`그룹채팅 ${cs.length}개 (이름만 표시; weekly-post-targets.json의 topic에 그대로 입력):`);
    cs.sort((a, b) => String(a.topic).localeCompare(String(b.topic))).forEach((c) => console.log(`  • ${c.topic}  (멤버 ${(c.members || []).length}명)`));
    return;
  }

  if (cmd === 'resolve') {
    for (const tg of targets) {
      let r;
      try { r = await resolveTarget(cfg, await token(cfg, scopesFor(tg), login), tg); } catch (e) { r = { ok: false, why: e.message }; }
      console.log(`• ${tg.name} [${tg.role || 'prod'} · ${tg.type}] → ${r.ok ? `OK  ${r.label}  id=${showIds ? r.id : mask(r.id)}` : '✗ ' + r.why}`);
    }
    return;
  }

  if (cmd === 'post') {
    const { model, insight } = loadReport();
    const date = model.reference_date;
    const wanted = opt('target') || cfg.defaultTarget || (targets.find((x) => (x.role || 'prod') === 'test') || {}).name;
    const tg = targets.find((x) => x.name === wanted) || targets.find((x) => inc(x.name, wanted));
    if (!tg) { console.log(`✗ 타깃 '${wanted || ''}' 없음. 설정된 타깃: ${targets.map((x) => x.name).join(', ') || '(없음)'}`); process.exitCode = 2; return; }
    const role = tg.role || 'prod';
    const card = buildCard(model, insight, { siteUrl: cfg.siteUrl, test: role === 'test' });
    const cid = crypto.randomUUID();
    const payload = { body: { contentType: 'html', content: `<attachment id="${cid}"></attachment>` }, attachments: [{ id: cid, contentType: 'application/vnd.microsoft.card.adaptive', content: JSON.stringify(card) }] };
    console.log(`보고 ${date} → 타깃 '${tg.name}' [${role} · ${tg.type}] · 카드 ${JSON.stringify(card).length} bytes`);

    if (!send) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'teams-graph-card.json'), JSON.stringify(card, null, 2));
      if (has('--print')) console.log(JSON.stringify(card, null, 2));
      let r = { ok: false, why: 'resolve 생략' };
      try { r = await resolveTarget(cfg, await token(cfg, scopesFor(tg), false), tg); } catch (e) { r = { ok: false, why: e.message }; }
      console.log(`[DRY-RUN] ${r.ok ? `게시 예정 → ${r.label}` : `타깃 미해결: ${r.why}`}\n카드 미리보기: automation/out/teams-graph-card.json  (--send 로 실제 게시)`);
      return;
    }

    // ---- safety gates ----
    fs.mkdirSync(LOCK_DIR, { recursive: true });
    const age = daysBetween(date, todayISO());
    if (age > MAX_AGE_DAYS && !resend) { console.log(`✗ 발송 중단: 보고일 ${date}이 ${age}일 전(묵은 내용). 최신 보고 생성 후 재시도하거나 --resend.`); process.exitCode = 3; return; }
    const lock = path.join(LOCK_DIR, `posted_${date}_${slug(tg.name)}.lock`);
    if (fs.existsSync(lock) && !resend) { console.log(`✗ ${date} 보고는 '${tg.name}'에 이미 게시됨. 정정 재게시는 --resend.`); process.exitCode = 3; return; }
    const testOk = path.join(LOCK_DIR, 'test_ok.lock');
    if (role !== 'test' && !fs.existsSync(testOk)) { console.log(`✗ 운영 타깃 게시 전, 테스트 타깃으로 먼저 1회 게시해 카드 모양을 확인해야 함 (post --send --target=<test 타깃>).`); process.exitCode = 3; return; }

    const t = await token(cfg, scopesFor(tg), login);
    const r = await resolveTarget(cfg, t, tg);
    if (!r.ok) { console.log(`✗ ${tg.name}: ${r.why}`); process.exitCode = 2; return; }
    try {
      await graph(cfg).axios.post(r.url, payload, H(t));
      fs.writeFileSync(lock, new Date().toISOString());
      if (role === 'test') fs.writeFileSync(testOk, new Date().toISOString());
      console.log(`✓ 게시 완료 → ${r.label}  (중복방지 잠금 기록)`);
    } catch (e) {
      console.log(`✗ 게시 실패 → ${tg.name}: ${e.response && e.response.status} ${(e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message}`);
      process.exitCode = 1;
    }
    return;
  }

  console.log('명령: chats | resolve [--show-ids] | post [--target=<name>] [--print] [--send] [--resend] [--login]');
}

module.exports = { buildCard, money };
if (require.main === module) {
  main().catch((e) => { console.error('ERR:', (e.response && e.response.status) || '', (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message); process.exit(1); });
}
