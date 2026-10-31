import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { advanceInvestigation, startInvestigation } from "@/lib/investigation/orchestrator";
import { buildInvestigationView } from "@/lib/investigation/view";
import { TinyFishError } from "@/lib/tinyfish/http";
import { RECORDED, syntheticAgentRun } from "./fixtures";
import { createHarness, SAMSUNG_INPUT } from "./helpers/harness";

type Harness = ReturnType<typeof createHarness>;

async function pollUntilDone(h: Harness, id: string, maxPolls = 15) {
  for (let i = 0; i < maxPolls; i++) {
    const inv = await advanceInvestigation(h.deps, id);
    if (inv && ["completed", "partial", "failed"].includes(inv.status)) return inv;
    h.advanceClock(10_000);
  }
  throw new Error("investigation did not finish");
}

async function viewOf(h: Harness, id: string) {
  const s = h.deps.store;
  return buildInvestigationView((await s.getInvestigation(id))!, await s.listRuns(id), await s.listEvidence(id), await s.listFindings(id));
}

const run = (h: Harness, op: string) => h.mem.runs.find((r) => r.operation === op)!;
const NEVER_UNAVAILABLE = /NO_SERVICE|no service (is )?available|service is not available|not serviceable|no authori[sz]ed service/i;

describe("investigation orchestration", () => {
  // These cases exercise the interactive Agent locator, which is now an opt-in fallback for Samsung.
  beforeEach(() => vi.stubEnv("FEASISERVE_LOCATOR_FALLBACK", "agent"));
  afterEach(() => vi.unstubAllEnvs());

  it("completes only when every task succeeds and the locator is VERIFIED", async () => {
    const h = createHarness({ agentRuns: [syntheticAgentRun({}, { status: "RUNNING" }), syntheticAgentRun()] });
    const { investigation, reused } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    expect(reused).toBe(false);
    expect(h.tinyfish.startRun).toHaveBeenCalledTimes(1);
    expect(h.tinyfish.search).not.toHaveBeenCalled(); // POST stays fast

    const done = await pollUntilDone(h, investigation.id);
    expect(done.status).toBe("completed");
    const view = await viewOf(h, investigation.id);
    expect(view.locator).toMatchObject({ verification: "VERIFIED", outcome: "CENTERS_FOUND", agent_run_id: "synthetic-run-0001" });
    expect(view.locator?.service_centers).toHaveLength(2);
    expect(view.findings.map((f) => f.finding_type).sort()).toEqual(["locator_result", "service_center", "service_center"]);
    const agentEvidence = h.mem.evidence.find((e) => e.retrieval_method === "tinyfish_agent")!;
    expect(agentEvidence.metadata).toMatchObject({ expected_pin: "560001", returned_pin: "560001", search_submitted: true, domain_approved: true });
    expect(h.mem.evidence.some((e) => e.retrieval_method === "tinyfish_fetch" && e.source_type === "official_manufacturer")).toBe(true);
  });

  it("9. rate-limited search retries a bounded number of times, then fails visibly", async () => {
    const h = createHarness({
      search: async () => {
        throw new TinyFishError("RATE_LIMITED", "TinyFish HTTP 429", 429, 2);
      },
    });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    await advanceInvestigation(h.deps, investigation.id);
    expect(run(h, "search_official")).toMatchObject({ status: "pending", error_message: "TinyFish rate limit reached" });
    expect(run(h, "search_official").metadata.attempts).toBe(1);

    const calls = h.tinyfish.search.mock.calls.length;
    await advanceInvestigation(h.deps, investigation.id); // still inside the back-off window
    expect(h.tinyfish.search.mock.calls.length).toBe(calls);

    const done = await pollUntilDone(h, investigation.id);
    expect(run(h, "search_official")).toMatchObject({ status: "failed", error_message: "TinyFish rate limit reached" });
    expect(run(h, "search_official").metadata.attempts).toBe(3);
    expect(h.tinyfish.search).toHaveBeenCalledTimes(6); // 3 attempts x 2 searches, never more
    expect(run(h, "fetch_official").status).toBe("skipped");
    expect(done.status).toBe("partial"); // locator still succeeded
    expect(done.error_summary).toMatch(/Official policy search: TinyFish rate limit reached/);
  });

  it("11. partial completion: one task fails, the rest are kept and reported", async () => {
    const h = createHarness({
      search: async (p) => {
        if (p.query.includes("complaints")) throw new TinyFishError("MALFORMED_RESPONSE", "bad shape");
        const { parseSearchResponse } = await import("@/lib/tinyfish/search");
        return parseSearchResponse(RECORDED.samsungSearch());
      },
    });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    const done = await pollUntilDone(h, investigation.id);
    expect(done.status).toBe("partial");
    expect(done.error_summary).toMatch(/Customer experience search/);
    expect(run(h, "search_community").status).toBe("failed");
    expect(run(h, "search_official").status).toBe("succeeded");
    expect(run(h, "locator_agent").status).toBe("succeeded");
    const view = await viewOf(h, investigation.id);
    expect(view.locator?.verification).toBe("VERIFIED");
    expect(view.evidence.length).toBeGreaterThan(0);
  });

  it("12. repeated and concurrent polling never creates duplicate runs, calls or findings", async () => {
    const h = createHarness({ agentRuns: [syntheticAgentRun({}, { status: "RUNNING" }), syntheticAgentRun()] });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    for (let i = 0; i < 4; i++) {
      await Promise.all(Array.from({ length: 5 }, () => advanceInvestigation(h.deps, investigation.id)));
      h.advanceClock(5_000);
    }
    expect(h.mem.runs).toHaveLength(4);
    expect(h.tinyfish.startRun).toHaveBeenCalledTimes(1);
    expect(h.tinyfish.search).toHaveBeenCalledTimes(2);
    expect(h.tinyfish.fetchPages).toHaveBeenCalledTimes(1);
    expect(h.mem.findings.filter((f) => f.finding_type === "locator_result")).toHaveLength(1);
    expect(h.mem.evidence.filter((e) => e.retrieval_method === "tinyfish_agent")).toHaveLength(1);
    expect((await h.deps.store.getInvestigation(investigation.id))!.status).toBe("completed");
  });

  it("repeated POST with the same input reuses the active investigation", async () => {
    const h = createHarness({ agentRuns: [syntheticAgentRun({}, { status: "RUNNING" })] });
    const first = await startInvestigation(h.deps, SAMSUNG_INPUT);
    const second = await startInvestigation(h.deps, SAMSUNG_INPUT);
    expect(second).toMatchObject({ reused: true, investigation: { id: first.investigation.id } });
    expect(h.mem.investigations).toHaveLength(1);
    expect(h.tinyfish.startRun).toHaveBeenCalledTimes(1);
  });

  it("6. recorded tunnel failure: execution finished, evidence kept, verification FAILED, never 'no service'", async () => {
    const h = createHarness({ agentRuns: [RECORDED.samsungTunnelFailure()] });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    const done = await pollUntilDone(h, investigation.id);
    expect(done.status).toBe("partial");
    expect(run(h, "locator_agent").status).toBe("succeeded"); // provider said COMPLETED...
    const view = await viewOf(h, investigation.id);
    expect(view.locator).toMatchObject({ verification: "FAILED", outcome: "EXECUTION_FAILED", service_centers: [] }); // ...but it proves nothing
    const finding = view.findings.find((f) => f.finding_type === "locator_result")!;
    expect(finding.verification_status).toBe("FAILED");
    expect(finding.claim).toMatch(/unknown/);
    expect(JSON.stringify(view)).not.toMatch(NEVER_UNAVAILABLE);
    expect(h.mem.evidence.find((e) => e.retrieval_method === "tinyfish_agent")!.metadata).toMatchObject({
      agent_run_id: "090e935c-e918-4319-a19a-cc6ab0f1428f",
      returned_pin: "56001",
      search_submitted: false,
    });
  });

  it("unsupported manufacturer: locator explicitly UNSUPPORTED, no agent credits spent", async () => {
    const h = createHarness();
    const { investigation } = await startInvestigation(h.deps, { ...SAMSUNG_INPUT, brand: "Voltas" });
    const done = await pollUntilDone(h, investigation.id);
    expect(h.tinyfish.startRun).not.toHaveBeenCalled();
    expect(done.status).toBe("partial");
    const view = await viewOf(h, investigation.id);
    expect(view.locator).toMatchObject({ status: "skipped", outcome: "UNSUPPORTED", verification: null });
    // no adapter -> no domain counts as official, so nothing is fetched as an official promise
    expect(view.evidence.every((e) => e.source_type !== "official_manufacturer")).toBe(true);
    expect(run(h, "fetch_official").status).toBe("skipped");
    expect(JSON.stringify(view)).not.toMatch(NEVER_UNAVAILABLE);
  });

  it("LG: known-unavailable locator is reported as such, not attempted", async () => {
    const h = createHarness();
    const { investigation } = await startInvestigation(h.deps, { ...SAMSUNG_INPUT, brand: "LG" });
    await pollUntilDone(h, investigation.id);
    expect(h.tinyfish.startRun).not.toHaveBeenCalled();
    const view = await viewOf(h, investigation.id);
    expect(view.locator).toMatchObject({ outcome: "LOCATOR_UNAVAILABLE" });
    expect(view.locator?.reasons[0]).toMatch(/did not render a PIN search input/);
  });

  it("agent start: 429 is retried, but an ambiguous timeout is not (avoids duplicate paid runs)", async () => {
    const limited = createHarness({
      startRun: async () => {
        throw new TinyFishError("RATE_LIMITED", "429", 429);
      },
    });
    const a = await startInvestigation(limited.deps, SAMSUNG_INPUT);
    expect(run(limited, "locator_agent").status).toBe("pending");
    await pollUntilDone(limited, a.investigation.id);
    expect(limited.tinyfish.startRun).toHaveBeenCalledTimes(3);

    const timedOut = createHarness({
      startRun: async () => {
        throw new TinyFishError("TIMEOUT", "timed out");
      },
    });
    const b = await startInvestigation(timedOut.deps, SAMSUNG_INPUT);
    expect(run(timedOut, "locator_agent")).toMatchObject({ status: "failed", error_message: "TinyFish request timed out" });
    await pollUntilDone(timedOut, b.investigation.id);
    expect(timedOut.tinyfish.startRun).toHaveBeenCalledTimes(1);
  });

  it("agent past its deadline is marked timed_out and cancelled", async () => {
    const h = createHarness({ agentRuns: [syntheticAgentRun({}, { status: "RUNNING" })] });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    await advanceInvestigation(h.deps, investigation.id);
    h.advanceClock(11 * 60_000);
    const done = await advanceInvestigation(h.deps, investigation.id);
    expect(run(h, "locator_agent")).toMatchObject({ status: "timed_out" });
    expect(h.tinyfish.cancelRun).toHaveBeenCalledWith("synthetic-run-0001");
    expect(done?.status).toBe("partial");
  });

  it("client view never exposes internal diagnostics", async () => {
    const h = createHarness({
      search: async () => {
        throw new Error("secret-internal-detail at /srv/app.js:42");
      },
    });
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    await pollUntilDone(h, investigation.id);
    expect(run(h, "search_official").metadata.last_error).toMatch(/secret-internal-detail/); // kept server-side
    const json = JSON.stringify(await viewOf(h, investigation.id));
    expect(json).not.toContain("secret-internal-detail");
    expect(json).toContain("Internal error while processing this task");
  });
});
