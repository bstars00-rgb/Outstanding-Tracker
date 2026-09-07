/** Adaptive Card JSON (schema 1.4/1.5). Kept loosely typed; the builder controls the structure. */
export type AdaptiveCard = { type: 'AdaptiveCard'; version: string; $schema?: string; body: unknown[]; actions?: unknown[]; msteams?: unknown };

export interface TeamsMessage {
  /** Idempotency key: one message per (report date, channel). */
  idempotency_key: string;
  title: string;
  card: AdaptiveCard;
  /** Plain-text/Markdown fallback when the channel does not render Adaptive Cards. */
  markdown: string;
  /** Character length guard (mobile readability). */
  markdown_length: number;
}

export interface SendResult {
  ok: boolean;
  channel: 'test' | 'leaders' | 'admin' | 'dry-run';
  status?: number;
  attempts: number;
  error?: string;
  sent_at: string;
  idempotency_key: string;
}

export interface TeamsSender {
  readonly name: string;
  /** Send to the configured channel. Implementations MUST honour retry policy and never log the webhook URL. */
  send(message: TeamsMessage, channel: 'test' | 'leaders'): Promise<SendResult>;
  /** Operational alert to the admin channel (failure notification). */
  alert(text: string): Promise<SendResult>;
}
