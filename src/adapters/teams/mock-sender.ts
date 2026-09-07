import type { SendResult, TeamsMessage, TeamsSender } from './types';

/** Records messages in memory (tests) and optionally echoes a summary via the provided logger. */
export class MockTeamsSender implements TeamsSender {
  readonly name = 'mock';
  readonly sent: { channel: string; message: TeamsMessage }[] = [];
  readonly alerts: string[] = [];
  /** Set to simulate transient failures: number of failures before success. */
  failuresBeforeSuccess = 0;
  private attemptsSeen = 0;

  constructor(private readonly log: (line: string) => void = () => {}) {}

  async send(message: TeamsMessage, channel: 'test' | 'leaders'): Promise<SendResult> {
    this.attemptsSeen++;
    if (this.attemptsSeen <= this.failuresBeforeSuccess) {
      return { ok: false, channel, status: 503, attempts: this.attemptsSeen, error: 'simulated 503', sent_at: new Date().toISOString(), idempotency_key: message.idempotency_key };
    }
    this.sent.push({ channel, message });
    this.log(`[mock-teams] channel=${channel} key=${message.idempotency_key} title="${message.title}" markdown_chars=${message.markdown_length}`);
    return { ok: true, channel, status: 202, attempts: this.attemptsSeen, sent_at: new Date().toISOString(), idempotency_key: message.idempotency_key };
  }

  async alert(text: string): Promise<SendResult> {
    this.alerts.push(text);
    this.log(`[mock-teams] ADMIN ALERT: ${text}`);
    return { ok: true, channel: 'admin', status: 202, attempts: 1, sent_at: new Date().toISOString(), idempotency_key: `alert:${Date.now()}` };
  }
}
