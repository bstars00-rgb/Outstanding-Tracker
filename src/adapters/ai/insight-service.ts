import type { TrackerModel } from '@core/types';
import { buildInsightInput } from './insight-input';
import { generateRuleBasedInsight, RuleBasedInsightProvider } from './mock-provider';
import type { InsightProvider, InsightResult } from './types';
import { sanitizeInsight, verifyInsight } from './verify';

export interface InsightServiceOptions {
  provider: InsightProvider;
  /** When the primary provider fails, the rule-based provider produces the insight. Default true. */
  fallbackToRules?: boolean;
  log?: (line: string) => void;
}

/**
 * Orchestrates: build structured input -> provider -> verify numbers/names -> sanitize -> fallback.
 * Guarantees an InsightResult is always returned (the weekly report never depends on the model being up).
 */
export async function generateInsight(model: TrackerModel, opts: InsightServiceOptions): Promise<InsightResult> {
  const input = buildInsightInput(model);
  const log = opts.log ?? (() => {});
  const fallback = opts.fallbackToRules ?? true;
  try {
    const { output, model: usedModel } = await opts.provider.generate(input);
    const verification = verifyInsight(input, output);
    if (verification.ok) {
      return { output, provider: opts.provider.name, model: usedModel, generated_at: new Date().toISOString(), verification, fallback_used: false };
    }
    log(`[insight] verification failed: ${verification.unverified_numbers.length} numbers, ${verification.unknown_customers.length} customers, ${verification.unknown_owners.length} owners unverifiable -> sanitizing`);
    const { output: cleaned, removed } = sanitizeInsight(input, output);
    const re = verifyInsight(input, cleaned);
    re.notes.push(`Removed unverifiable items: ${removed.join(', ') || 'none'}`);
    if (cleaned.executive_summary.length === 0 && fallback) {
      log('[insight] executive summary emptied by sanitization -> rule-based fallback');
      const rb = generateRuleBasedInsight(input);
      const v = verifyInsight(input, rb);
      v.notes.push('Fallback: rule-based insight used because model output failed verification');
      return { output: rb, provider: new RuleBasedInsightProvider().name, model: null, generated_at: new Date().toISOString(), verification: v, fallback_used: true, error: 'model output failed verification' };
    }
    return { output: cleaned, provider: opts.provider.name, model: usedModel, generated_at: new Date().toISOString(), verification: re, fallback_used: false };
  } catch (e) {
    const err = (e as Error).message;
    log(`[insight] provider ${opts.provider.name} failed: ${err}`);
    if (!fallback) throw e;
    const rb = generateRuleBasedInsight(input);
    const v = verifyInsight(input, rb);
    v.notes.push(`Fallback: rule-based insight used because provider failed (${err})`);
    return { output: rb, provider: 'rule-based', model: null, generated_at: new Date().toISOString(), verification: v, fallback_used: true, error: err };
  }
}

export { buildInsightInput };
