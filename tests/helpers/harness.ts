import { vi } from "vitest";
import type { Deps, TinyFishPort } from "@/lib/investigation/orchestrator";
import type { AgentRun } from "@/lib/tinyfish/agent";
import { parseFetchResponse } from "@/lib/tinyfish/fetch";
import { parseSearchResponse } from "@/lib/tinyfish/search";
import { RECORDED, syntheticAgentRun } from "../fixtures";
import { createMemoryStore } from "./memory-store";

/** Orchestrator test rig: memory store, controllable clock, mocked TinyFish (no network). */
export function createHarness(overrides: Partial<TinyFishPort> & { agentRuns?: AgentRun[] } = {}) {
  let nowMs = Date.parse("2026-10-31T10:00:00Z");
  const now = () => new Date(nowMs);
  const mem = createMemoryStore(now);
  const agentRuns = overrides.agentRuns ?? [syntheticAgentRun()];
  let poll = 0;
  const tinyfish = {
    search: vi.fn(overrides.search ?? (async () => parseSearchResponse(RECORDED.samsungSearch()))),
    fetchPages: vi.fn(overrides.fetchPages ?? (async () => parseFetchResponse(RECORDED.samsungFetch()))),
    startRun: vi.fn(overrides.startRun ?? (async () => ({ runId: "synthetic-run-0001" }))),
    // returns each queued state once, then repeats the last one
    getRun: vi.fn(overrides.getRun ?? (async () => agentRuns[Math.min(poll++, agentRuns.length - 1)]!)),
    cancelRun: vi.fn(overrides.cancelRun ?? (async () => {})),
  };
  const deps: Deps = { store: mem.store, tinyfish, now };
  return { deps, mem, tinyfish, advanceClock: (ms: number) => (nowMs += ms) };
}

export const SAMSUNG_INPUT = { brand: "Samsung", product_category: "Split AC", product_model: null, pincode: "560001" };
