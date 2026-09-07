import type { SendResult, TeamsMessage, TeamsSender } from './types';

export interface LiveTeamsConfig {
  /** Teams Workflows ("Post to a channel when a webhook request is received") URL for the LEADERS channel. */
  leadersWebhookUrl: string | null;
  /** Separate webhook for the TEST channel. */
  testWebhookUrl: string | null;
  /** Optional admin/alert webhook (falls back to the test channel). */
  adminWebhookUrl: string | null;
  maxAttempts: number;
  baseDelayMs: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Posts an Adaptive Card through a Microsoft Teams Workflows webhook.
 * Payload shape follows the Workflows "Send each adaptive card" template:
 *   { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: <card> }] }
 * Retries on 429/5xx/network errors with exponential backoff. Webhook URLs are never logged.
 */
export class LiveTeamsSender implements TeamsSender {
  readonly name = 'teams-workflows-webhook';
  constructor(private readonly cfg: LiveTeamsConfig, private readonly log: (line: string) => void = () => {}) {}

  async send(message: TeamsMessage, channel: 'test' | 'leaders'): Promise<SendResult> {
    const url = channel === 'leaders' ? this.cfg.leadersWebhookUrl : this.cfg.testWebhookUrl;
    if (!url) return { ok: false, channel, attempts: 0, error: `No webhook configured for channel "${channel}"`, sent_at: new Date().toISOString(), idempotency_key: message.idempotency_key };
    const payload = { type: 'message', summary: message.title, attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: message.card }] };
    return this.post(url, payload, channel, message.idempotency_key);
  }

  async alert(text: string): Promise<SendResult> {
    const url = this.cfg.adminWebhookUrl ?? this.cfg.testWebhookUrl;
    const key = `alert:${new Date().toISOString()}`;
    if (!url) return { ok: false, channel: 'admin', attempts: 0, error: 'No admin/test webhook configured', sent_at: new Date().toISOString(), idempotency_key: key };
    const card = { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', text: '⚠️ Outstanding Tracker — automation alert', weight: 'Bolder', size: 'Medium' }, { type: 'TextBlock', text, wrap: true }] };
    return this.post(url, { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }] }, 'admin', key);
  }

  private async post(url: string, payload: unknown, channel: SendResult['channel'], key: string): Promise<SendResult> {
    const f = this.cfg.fetchImpl ?? fetch;
    const sleep = this.cfg.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    let lastErr = '';
    let status: number | undefined;
    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        const r = await f(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
        status = r.status;
        if (r.ok) {
          this.log(`[teams] channel=${channel} key=${key} status=${r.status} attempt=${attempt}`);
          return { ok: true, channel, status: r.status, attempts: attempt, sent_at: new Date().toISOString(), idempotency_key: key };
        }
        lastErr = `HTTP ${r.status}`;
        if (r.status < 500 && r.status !== 429 && r.status !== 408) break; // non-retryable
      } catch (e) {
        lastErr = (e as Error).message;
      }
      this.log(`[teams] channel=${channel} key=${key} attempt=${attempt} failed: ${lastErr}`);
      if (attempt < this.cfg.maxAttempts) await sleep(this.cfg.baseDelayMs * 2 ** (attempt - 1));
    }
    return { ok: false, channel, status, attempts: this.cfg.maxAttempts, error: lastErr, sent_at: new Date().toISOString(), idempotency_key: key };
  }
}
