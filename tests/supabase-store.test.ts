import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { deriveStatus, startInvestigation } from "@/lib/investigation/orchestrator";
import { StoreError } from "@/lib/investigation/store";
import { createSupabaseStore } from "@/lib/supabase/store";
import { createHarness, SAMSUNG_INPUT } from "./helpers/harness";

// Regression for the Stage 2.5 live failure: PostgREST sends null for keys missing from some rows of a
// bulk insert, which violated investigation_runs.metadata NOT NULL.
describe("Supabase store payloads", () => {
  it("createRuns sends an explicit metadata object on every row", async () => {
    let sent: Record<string, unknown>[] = [];
    const fakeDb = {
      from: () => ({
        insert: (rows: Record<string, unknown>[]) => {
          sent = rows;
          return { select: async () => ({ data: rows, error: null }) };
        },
      }),
    } as unknown as SupabaseClient;
    await createSupabaseStore(fakeDb).createRuns([
      { investigation_id: "i", provider: "tinyfish", operation: "search_official", status: "pending" },
      { investigation_id: "i", provider: "tinyfish", operation: "locator_agent", status: "pending", metadata: { adapter: "samsung" } },
    ]);
    expect(sent.map((r) => r.metadata)).toEqual([{}, { adapter: "samsung" }]);
    expect(new Set(sent.map((r) => Object.keys(r).sort().join()))).toHaveProperty("size", 1); // uniform columns
  });
});

describe("investigation initialisation failures", () => {
  it("marks the investigation failed (not left running) when task creation fails", async () => {
    const h = createHarness();
    h.deps.store.createRuns = async () => {
      throw new StoreError('create runs: null value in column "metadata"');
    };
    await expect(startInvestigation(h.deps, SAMSUNG_INPUT)).rejects.toBeInstanceOf(StoreError);
    expect(h.mem.investigations[0]).toMatchObject({ status: "failed", error_summary: "Investigation tasks could not be created" });
    expect(h.tinyfish.startRun).not.toHaveBeenCalled();
  });

  it("an investigation with no tasks is failed, never completed", () => {
    expect(deriveStatus([])).toEqual({ status: "failed", summary: "Investigation has no tasks" });
  });
});
