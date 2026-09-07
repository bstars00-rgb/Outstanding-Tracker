import { describe, expect, it } from 'vitest';
import { latestSaturday, localTimeToUTC, reportWeek, tzOffsetMinutes, formatInTimeZone } from '@core/dates';
import { formatMoney, formatPct, convert } from '@core/money';
import { loadEnv, describe as describeEnv } from '../../automation/lib/env';
import { RedactingLogger } from '../../automation/lib/logger';
import { validateDataset } from '@core/validate';
import { generateMockDataset } from '@adapters/ellis/mock-data';

describe('dates & schedule', () => {
  it('latest Saturday', () => {
    expect(latestSaturday('2026-09-05')).toBe('2026-09-05'); // Saturday
    expect(latestSaturday('2026-09-07')).toBe('2026-09-05'); // Monday
    expect(latestSaturday('2026-09-06')).toBe('2026-09-05'); // Sunday
    expect(latestSaturday('2026-09-11')).toBe('2026-09-05'); // Friday
  });
  it('09:00 Asia/Ho_Chi_Minh is 02:00 UTC (matches cron 0 2 * * 6)', () => {
    expect(localTimeToUTC('2026-09-05', 9, 0, 'Asia/Ho_Chi_Minh')).toBe('2026-09-05T02:00:00.000Z');
    expect(tzOffsetMinutes(new Date('2026-09-05T02:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(420);
    expect(formatInTimeZone('2026-09-05T02:00:00.000Z', 'Asia/Ho_Chi_Minh')).toBe('2026-09-05 09:00 GMT+7');
  });
  it('report week', () => {
    expect(reportWeek('2026-09-05', null)).toEqual({ start: '2026-08-30', end: '2026-09-05' });
    expect(reportWeek('2026-09-05', '2026-08-29')).toEqual({ start: '2026-08-30', end: '2026-09-05' });
  });
});

describe('money formatting', () => {
  it('formats with currency conventions', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('USD 1,234.50');
    expect(formatMoney(1234567, 'JPY')).toBe('JPY 1,234,567');
    expect(formatMoney(-1500, 'USD', { compact: true })).toBe('-USD 1,500.00');
    expect(formatMoney(25000, 'USD', { compact: true, signed: true })).toBe('+USD 25.0K');
    expect(formatMoney(2_500_000, 'USD', { compact: true })).toBe('USD 2.50M');
    expect(formatPct(0.1234, { signed: true })).toBe('+12.3%');
    expect(formatPct(null)).toBe('n/a');
  });
  it('convert returns null without a rate', () => {
    const fx = { reporting_currency: 'USD', as_of: '2026-09-05', rates: [] };
    expect(convert(10, 'USD', fx)?.value).toBe(10);
    expect(convert(10, 'EUR', fx)).toBeNull();
  });
});

describe('env loading', () => {
  it('defaults to safe dry-run mock configuration', () => {
    const cfg = loadEnv({});
    expect(cfg.DRY_RUN).toBe(true);
    expect(cfg.DATA_SOURCE).toBe('mock');
    expect(cfg.TEAMS_SENDER).toBe('mock');
    expect(cfg.TARGET_CHANNEL).toBe('test');
    expect(cfg.REPORTING_CURRENCY).toBe('JPY');
    expect(cfg.REPORT_LANGUAGE).toBe('ko');
    expect(cfg.REPORT_TIMEZONE).toBe('Asia/Ho_Chi_Minh');
  });
  it('refuses live sends without secrets', () => {
    expect(() => loadEnv({ TEAMS_SENDER: 'live', DRY_RUN: 'false', TARGET_CHANNEL: 'leaders' })).toThrow(/TEAMS_WEBHOOK_URL/);
    expect(() => loadEnv({ DATA_SOURCE: 'ellis' })).toThrow(/ELLIS_MCP_ENDPOINT/);
    expect(() => loadEnv({ AI_PROVIDER: 'claude' })).toThrow(/AI_API_KEY/);
    expect(() => loadEnv({ REPORT_DATE: '05/09/2026' })).toThrow(/REPORT_DATE/);
  });
  it('never exposes secret values in describe()', () => {
    const cfg = loadEnv({ TEAMS_WEBHOOK_URL: 'https://prod-01.logic.azure.com/workflows/abc/secret', AI_API_KEY: 'sk-ant-secret-value-123456' });
    const d = JSON.stringify(describeEnv(cfg));
    expect(d).not.toContain('secret-value');
    expect(d).not.toContain('workflows/abc');
    expect(d).toContain('"TEAMS_WEBHOOK_URL":"set"');
  });
});

describe('redacting logger', () => {
  it('redacts protected values and webhook-like URLs', () => {
    const lines: string[] = [];
    const log = new RedactingLogger((l) => lines.push(l));
    log.protect('sk-ant-api03-verysecret', 'https://prod-99.westus.logic.azure.com:443/workflows/xyz');
    log.log('key=sk-ant-api03-verysecret url=https://prod-99.westus.logic.azure.com:443/workflows/xyz other=https://prod-11.logic.azure.com/w/abc bearer Bearer abcdef123456789');
    expect(lines[0]).not.toContain('verysecret');
    expect(lines[0]).not.toContain('workflows/xyz');
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).toContain('[REDACTED-WEBHOOK]');
    expect(lines[0]).not.toContain('abcdef123456789');
  });
});

describe('dataset validation', () => {
  it('rejects schema violations and orphan records', () => {
    const ds = generateMockDataset('2026-09-05');
    const broken = { ...ds, invoices: [...ds.invoices, { ...ds.invoices[0], invoice_id: 'dup-x', customer_id: 'nope' }] };
    const v = validateDataset(broken);
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.code === 'ORPHAN_INVOICE')).toBe(true);
    expect(validateDataset({ foo: 'bar' }).ok).toBe(false);
  });
});
