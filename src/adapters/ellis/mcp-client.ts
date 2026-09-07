import type { McpToolClient } from './types';

/**
 * Minimal MCP client over Streamable HTTP (JSON-RPC 2.0).
 * Only `tools/list` and `tools/call` are implemented; that is all the tracker needs.
 * Auth header value comes from ELLIS_MCP_AUTH and is never logged.
 *
 * NOTE: the transport of the production Ellis MCP is NOT confirmed (the connector observed so far is
 * attached through claude.ai, which hides the endpoint). If the endpoint speaks a different protocol
 * (e.g. SSE or a plain REST facade), implement McpToolClient for it and inject it into the adapter.
 */
export class HttpMcpClient implements McpToolClient {
  private nextId = 1;
  private sessionId: string | null = null;

  constructor(
    private readonly endpoint: string,
    private readonly authHeader: string | null,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 30_000,
  ) {}

  async listTools() {
    const res = await this.rpc<{ tools: { name: string; description?: string; inputSchema?: unknown }[] }>('tools/list', {});
    return res.tools;
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.rpc<{ content?: { type: string; text?: string }[]; structuredContent?: unknown; isError?: boolean }>('tools/call', { name, arguments: args });
    if (res.isError) {
      const msg = res.content?.map((c) => c.text ?? '').join('\n') || 'tool returned isError';
      throw new McpToolError(name, msg);
    }
    if (res.structuredContent !== undefined) return res.structuredContent as T;
    const text = res.content?.find((c) => c.type === 'text')?.text;
    if (text === undefined) return res as unknown as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }

  private async rpc<T>(method: string, params: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
      if (this.authHeader) headers.authorization = this.authHeader;
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const r = await this.fetchImpl(this.endpoint, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }), signal: controller.signal });
      const sid = r.headers.get('mcp-session-id');
      if (sid) this.sessionId = sid;
      if (!r.ok) throw new McpTransportError(`HTTP ${r.status} from MCP endpoint`, r.status);
      const body = (await r.json()) as { result?: T; error?: { code: number; message: string } };
      if (body.error) throw new McpTransportError(`JSON-RPC error ${body.error.code}: ${body.error.message}`, body.error.code);
      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class McpTransportError extends Error {
  constructor(message: string, public readonly code: number) {
    super(message);
    this.name = 'McpTransportError';
  }
  get retryable() {
    return this.code >= 500 || this.code === 429 || this.code === 408;
  }
}

export class McpToolError extends Error {
  constructor(public readonly tool: string, message: string) {
    super(`${tool}: ${message}`);
    this.name = 'McpToolError';
  }
}
