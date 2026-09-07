import type { ISODate, ReceivablesDataset } from '@core/types';

/**
 * Boundary between the tracker and the data source.
 * Implementations: MockReceivablesSource (deterministic mock), EllisMcpReceivablesSource (live MCP).
 * The calculation engine never talks to a source directly; the pipeline / UI asks a source for a
 * ReceivablesDataset for a reference date and hands it to buildTrackerModel().
 */
export interface ReceivablesSource {
  readonly name: string;
  readonly kind: ReceivablesDataset['source'];
  /** Return the raw dataset valid for the given reference date (YYYY-MM-DD). */
  fetchDataset(referenceDate: ISODate): Promise<ReceivablesDataset>;
  /** Lightweight connectivity check; must not throw. */
  healthCheck(): Promise<{ ok: boolean; detail: string }>;
}

/** Thrown when the live adapter is asked for data that no confirmed Ellis MCP tool provides. */
export class ToolNotConfirmedError extends Error {
  constructor(public readonly capability: string, public readonly requiredTool: string) {
    super(`Ellis MCP capability "${capability}" is not confirmed. Required tool: ${requiredTool}. See docs/ELLIS_MCP_MAPPING.md (Required section).`);
    this.name = 'ToolNotConfirmedError';
  }
}

/**
 * Minimal MCP client contract used by the live adapter. Kept transport-agnostic so it can be
 * backed by Streamable HTTP JSON-RPC (default), stdio, or a test double.
 */
export interface McpToolClient {
  listTools(): Promise<{ name: string; description?: string; inputSchema?: unknown }[]>;
  callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T>;
}
