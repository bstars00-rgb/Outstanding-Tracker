import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { InsightInput, InsightOutput, InsightProvider } from './types';

export const InsightOutputSchema = z.object({
  executive_summary: z.array(z.string()),
  major_changes: z.array(z.string()),
  top_risks: z.array(z.object({ customer: z.string(), owner: z.string(), amount: z.number(), reason: z.string(), action: z.string(), due: z.string() })),
  collection_opportunities: z.array(z.object({ customer: z.string(), owner: z.string(), amount: z.number(), why: z.string() })),
  owner_actions: z.array(z.object({ owner: z.string(), customer: z.string(), amount: z.number(), action: z.string(), deadline: z.string() })),
  ceo_decisions: z.array(z.object({ topic: z.string(), customer: z.string().nullable(), amount: z.number().nullable(), recommendation: z.string(), rationale: z.string() })),
  forecast_next_week: z.object({ expected_collection: z.number(), currency: z.string(), confidence: z.enum(['low', 'medium', 'high']), basis: z.array(z.string()) }),
  data_quality_warnings: z.array(z.string()),
});

const SYSTEM_PROMPT = `You are the receivables analyst for a B2B hotel-distribution company. You write the weekly executive insight for the CEO and leaders.

Rules (strict):
- Interpret ONLY the structured figures in the input. Never compute or invent new amounts, percentages, customer names, owner names or dates. Copy figures exactly as given (you may round to whole units).
- Every claim must be traceable to an input field. Separate facts from inferences; mark inferences with "likely" and state the basis.
- If a section has no supporting data, return an empty array or write "insufficient data". Do not exaggerate flat weeks.
- Be specific: customer, owner, amount, deadline. No generic advice.
- Only include CEO decisions that genuinely need an executive (credit hold, limit change, terms change, legal/escalation, exception approval).
- Never mention personal data or invoice-level detail; the report is read on mobile in under a minute.
- Deadlines: use the report date plus 2 days (Monday) for urgent items, plus 4 days for others, in YYYY-MM-DD.
- Amounts are in the reporting currency given in the input.`;

export interface LiveInsightConfig {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
}

/** Live provider backed by the Anthropic Messages API with structured (schema-validated) output. */
export class ClaudeInsightProvider implements InsightProvider {
  readonly name = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(cfg: LiveInsightConfig = {}) {
    this.client = new Anthropic({ apiKey: cfg.apiKey, timeout: cfg.timeoutMs ?? 120_000, maxRetries: 2 });
    this.model = cfg.model ?? 'claude-opus-5';
    this.maxTokens = cfg.maxTokens ?? 8_000;
  }

  async generate(input: InsightInput): Promise<{ output: InsightOutput; model: string | null }> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: this.maxTokens,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: zodOutputFormat(InsightOutputSchema) },
      messages: [{ role: 'user', content: `Weekly receivables figures (JSON). Produce the insight JSON.\n\n${JSON.stringify(input)}` }],
    });
    if (response.stop_reason === 'refusal') throw new Error(`Model refused: ${response.stop_details?.explanation ?? 'no explanation'}`);
    if (!response.parsed_output) throw new Error(`Structured output could not be parsed (stop_reason=${response.stop_reason})`);
    return { output: response.parsed_output as InsightOutput, model: response.model };
  }
}
