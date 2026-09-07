/**
 * Logger with secret redaction. Any string registered via `protect()` is replaced by [REDACTED]
 * before reaching stdout. Webhook URLs and API keys are protected by the pipeline at startup.
 */
export class RedactingLogger {
  private protectedValues: string[] = [];
  readonly lines: string[] = [];

  constructor(private readonly sink: (line: string) => void = (l) => console.log(l)) {}

  protect(...values: (string | null | undefined)[]) {
    for (const v of values) if (v && v.length >= 6) this.protectedValues.push(v);
  }

  redact(text: string): string {
    let out = text;
    for (const v of this.protectedValues) out = out.split(v).join('[REDACTED]');
    // Defensive patterns: webhook-looking URLs and bearer tokens
    out = out.replace(/https:\/\/[a-z0-9.-]*(logic\.azure\.com|webhook\.office\.com|powerautomate)[^\s"']*/gi, 'https://[REDACTED-WEBHOOK]');
    out = out.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED-KEY]');
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1[REDACTED]');
    return out;
  }

  log(msg: string) {
    const line = `${new Date().toISOString()} ${this.redact(msg)}`;
    this.lines.push(line);
    this.sink(line);
  }
}
