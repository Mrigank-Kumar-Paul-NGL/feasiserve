import { TinyFishError, isRecord, str, tinyfishRequest } from "./http";

const AGENT_URL = "https://agent.tinyfish.ai/v1";

export type AgentRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";
const STATUSES: ReadonlySet<string> = new Set(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]);

export interface AgentRequest {
  url: string;
  goal: string;
  browser_profile?: "lite" | "stealth";
  proxy_config?: { enabled: boolean; type?: "tinyfish"; country_code?: string };
  agent_config?: { max_duration_seconds?: number };
  output_schema?: Record<string, unknown>;
}

export interface AgentStep {
  action: string | null;
  status: string | null;
  timestamp: string | null;
}

export interface AgentRun {
  run_id: string;
  status: AgentRunStatus;
  started_at: string | null;
  finished_at: string | null;
  num_of_steps: number | null;
  /** Raw agent output. Untrusted: validate before use. */
  result: unknown;
  error: { code: string | null; message: string | null; category: string | null } | null;
  streaming_url: string | null;
  steps: AgentStep[];
}

export function parseAgentRun(data: unknown): AgentRun {
  if (!isRecord(data) || typeof data.run_id !== "string" || typeof data.status !== "string" || !STATUSES.has(data.status)) {
    throw new TinyFishError("MALFORMED_RESPONSE", "Agent run response missing run_id or valid status");
  }
  const err = isRecord(data.error)
    ? { code: str(data.error.code), message: str(data.error.message), category: str(data.error.category) }
    : null;
  return {
    run_id: data.run_id,
    status: data.status as AgentRunStatus,
    started_at: str(data.started_at),
    finished_at: str(data.finished_at),
    num_of_steps: typeof data.num_of_steps === "number" ? data.num_of_steps : null,
    result: data.result ?? null,
    error: err,
    streaming_url: str(data.streaming_url),
    // screenshot URLs are dropped on purpose: they return 401 (KI-008)
    steps: (Array.isArray(data.steps) ? data.steps : []).filter(isRecord).map((s) => ({
      action: str(s.action),
      status: str(s.status),
      timestamp: str(s.timestamp),
    })),
  };
}

function assertRunId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new TinyFishError("BAD_REQUEST", "Invalid agent run id");
}

export async function startAgentRun(request: AgentRequest): Promise<{ runId: string }> {
  const data = await tinyfishRequest(`${AGENT_URL}/automation/run-async`, { method: "POST", body: request, timeoutMs: 30_000 });
  if (!isRecord(data) || typeof data.run_id !== "string" || data.error) {
    throw new TinyFishError("UPSTREAM", "Agent run was not created");
  }
  assertRunId(data.run_id);
  return { runId: data.run_id };
}

export async function getAgentRun(runId: string): Promise<AgentRun> {
  assertRunId(runId);
  return parseAgentRun(await tinyfishRequest(`${AGENT_URL}/runs/${runId}`, { method: "GET", timeoutMs: 20_000 }));
}

export async function cancelAgentRun(runId: string): Promise<void> {
  assertRunId(runId);
  await tinyfishRequest(`${AGENT_URL}/runs/${runId}/cancel`, { method: "POST", timeoutMs: 15_000 });
}
