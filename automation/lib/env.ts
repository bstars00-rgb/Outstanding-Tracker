/**
 * Environment / secret access for the automation pipeline.
 * - Reads once, validates, and returns a typed config.
 * - Secret VALUES are never returned to logs; use `describe()` for a redacted summary.
 */
export interface PipelineEnv {
  DATA_SOURCE: 'mock' | 'ellis';
  AI_PROVIDER: 'mock' | 'claude';
  TEAMS_SENDER: 'mock' | 'live';
  DRY_RUN: boolean;
  TARGET_CHANNEL: 'test' | 'leaders';
  REPORT_DATE: string | null; // override reference date (YYYY-MM-DD)
  REPORTING_CURRENCY: string;
  REPORT_TIMEZONE: string;
  TRACKER_BASE_URL: string;
  DATA_STORAGE_CONFIG: { dir: string };
  RECIPIENT_CONFIG: { leaders_channel: string; test_channel: string; admin_channel: string | null; roles: string[] };
  secrets: {
    ELLIS_MCP_ENDPOINT: string | null;
    ELLIS_MCP_AUTH: string | null;
    TEAMS_WEBHOOK_URL: string | null;
    TEAMS_TEST_WEBHOOK_URL: string | null;
    TEAMS_ADMIN_WEBHOOK_URL: string | null;
    AI_API_KEY: string | null;
  };
}

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : !/^(false|0|no|off)$/i.test(v));
const opt = (v: string | undefined) => (v && v.trim() !== '' ? v.trim() : null);

export function loadEnv(env: NodeJS.ProcessEnv = process.env): PipelineEnv {
  const dataSource = (env.DATA_SOURCE ?? 'mock').toLowerCase();
  const ai = (env.AI_PROVIDER ?? 'mock').toLowerCase();
  const teams = (env.TEAMS_SENDER ?? 'mock').toLowerCase();
  if (!['mock', 'ellis'].includes(dataSource)) throw new Error(`DATA_SOURCE must be mock|ellis (got ${dataSource})`);
  if (!['mock', 'claude'].includes(ai)) throw new Error(`AI_PROVIDER must be mock|claude (got ${ai})`);
  if (!['mock', 'live'].includes(teams)) throw new Error(`TEAMS_SENDER must be mock|live (got ${teams})`);
  const dryRun = bool(env.DRY_RUN, true); // SAFE DEFAULT: dry run unless explicitly disabled
  const target = (env.TARGET_CHANNEL ?? (dryRun ? 'test' : 'test')).toLowerCase();
  if (!['test', 'leaders'].includes(target)) throw new Error('TARGET_CHANNEL must be test|leaders');
  const reportDate = opt(env.REPORT_DATE);
  if (reportDate && !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) throw new Error('REPORT_DATE must be YYYY-MM-DD');
  const currency = (env.REPORTING_CURRENCY ?? 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('REPORTING_CURRENCY must be ISO 4217');

  let recipients: PipelineEnv['RECIPIENT_CONFIG'] = { leaders_channel: 'Leadership - Receivables', test_channel: 'Outstanding Tracker - Test', admin_channel: null, roles: ['CEO', 'Finance Leader', 'GSM Leader', 'Sales Leaders', 'Collection Leader'] };
  if (opt(env.RECIPIENT_CONFIG)) {
    try {
      recipients = { ...recipients, ...(JSON.parse(env.RECIPIENT_CONFIG!) as Partial<PipelineEnv['RECIPIENT_CONFIG']>) };
    } catch {
      throw new Error('RECIPIENT_CONFIG must be valid JSON');
    }
  }
  let storage = { dir: 'automation/state' };
  if (opt(env.DATA_STORAGE_CONFIG)) {
    try {
      storage = { ...storage, ...(JSON.parse(env.DATA_STORAGE_CONFIG!) as Partial<{ dir: string }>) };
    } catch {
      throw new Error('DATA_STORAGE_CONFIG must be valid JSON');
    }
  }

  const cfg: PipelineEnv = {
    DATA_SOURCE: dataSource as PipelineEnv['DATA_SOURCE'],
    AI_PROVIDER: ai as PipelineEnv['AI_PROVIDER'],
    TEAMS_SENDER: teams as PipelineEnv['TEAMS_SENDER'],
    DRY_RUN: dryRun,
    TARGET_CHANNEL: target as PipelineEnv['TARGET_CHANNEL'],
    REPORT_DATE: reportDate,
    REPORTING_CURRENCY: currency,
    REPORT_TIMEZONE: env.REPORT_TIMEZONE ?? 'Asia/Ho_Chi_Minh',
    TRACKER_BASE_URL: (env.TRACKER_BASE_URL ?? 'http://localhost:4173/').replace(/\/?$/, '/'),
    DATA_STORAGE_CONFIG: storage,
    RECIPIENT_CONFIG: recipients,
    secrets: {
      ELLIS_MCP_ENDPOINT: opt(env.ELLIS_MCP_ENDPOINT),
      ELLIS_MCP_AUTH: opt(env.ELLIS_MCP_AUTH),
      TEAMS_WEBHOOK_URL: opt(env.TEAMS_WEBHOOK_URL),
      TEAMS_TEST_WEBHOOK_URL: opt(env.TEAMS_TEST_WEBHOOK_URL),
      TEAMS_ADMIN_WEBHOOK_URL: opt(env.TEAMS_ADMIN_WEBHOOK_URL),
      AI_API_KEY: opt(env.AI_API_KEY) ?? opt(env.ANTHROPIC_API_KEY),
    },
  };
  // Guard rails: live components need their secrets
  if (cfg.DATA_SOURCE === 'ellis' && !cfg.secrets.ELLIS_MCP_ENDPOINT) throw new Error('DATA_SOURCE=ellis requires ELLIS_MCP_ENDPOINT');
  if (cfg.AI_PROVIDER === 'claude' && !cfg.secrets.AI_API_KEY) throw new Error('AI_PROVIDER=claude requires AI_API_KEY');
  if (cfg.TEAMS_SENDER === 'live' && !cfg.DRY_RUN && cfg.TARGET_CHANNEL === 'leaders' && !cfg.secrets.TEAMS_WEBHOOK_URL) throw new Error('Sending to leaders requires TEAMS_WEBHOOK_URL');
  if (cfg.TEAMS_SENDER === 'live' && !cfg.DRY_RUN && cfg.TARGET_CHANNEL === 'test' && !cfg.secrets.TEAMS_TEST_WEBHOOK_URL) throw new Error('Sending to test channel requires TEAMS_TEST_WEBHOOK_URL');
  return cfg;
}

/** Redacted description for logs. */
export function describe(cfg: PipelineEnv): Record<string, unknown> {
  const has = (v: string | null) => (v ? 'set' : 'missing');
  return {
    DATA_SOURCE: cfg.DATA_SOURCE,
    AI_PROVIDER: cfg.AI_PROVIDER,
    TEAMS_SENDER: cfg.TEAMS_SENDER,
    DRY_RUN: cfg.DRY_RUN,
    TARGET_CHANNEL: cfg.TARGET_CHANNEL,
    REPORT_DATE: cfg.REPORT_DATE ?? '(auto: latest Saturday)',
    REPORTING_CURRENCY: cfg.REPORTING_CURRENCY,
    REPORT_TIMEZONE: cfg.REPORT_TIMEZONE,
    TRACKER_BASE_URL: cfg.TRACKER_BASE_URL,
    storage_dir: cfg.DATA_STORAGE_CONFIG.dir,
    recipients: cfg.RECIPIENT_CONFIG,
    secrets: { ELLIS_MCP_ENDPOINT: has(cfg.secrets.ELLIS_MCP_ENDPOINT), ELLIS_MCP_AUTH: has(cfg.secrets.ELLIS_MCP_AUTH), TEAMS_WEBHOOK_URL: has(cfg.secrets.TEAMS_WEBHOOK_URL), TEAMS_TEST_WEBHOOK_URL: has(cfg.secrets.TEAMS_TEST_WEBHOOK_URL), TEAMS_ADMIN_WEBHOOK_URL: has(cfg.secrets.TEAMS_ADMIN_WEBHOOK_URL), AI_API_KEY: has(cfg.secrets.AI_API_KEY) },
  };
}
