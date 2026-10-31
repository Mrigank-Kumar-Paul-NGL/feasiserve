// In-memory Store for tests. Mirrors the Postgres guarantees the orchestrator relies on:
// unique (investigation_id, operation), atomic status claims, evidence de-duplication.
import { randomUUID } from "node:crypto";
import type { Store } from "@/lib/investigation/store";
import type { EvidenceRow, FindingRow, InvestigationRow, RunRow } from "@/lib/supabase/types";

const tick = () => new Promise<void>((r) => setTimeout(r, 0)); // forces interleaving like real I/O

export function createMemoryStore(now: () => Date) {
  const investigations: InvestigationRow[] = [];
  const runs: RunRow[] = [];
  const evidence: EvidenceRow[] = [];
  const findings: FindingRow[] = [];
  const ts = () => now().toISOString();

  const store: Store = {
    async findActiveDuplicate(input, sinceIso) {
      await tick();
      return (
        investigations.find(
          (i) =>
            i.brand === input.brand &&
            i.product_category === input.product_category &&
            i.product_model === input.product_model &&
            i.pincode === input.pincode &&
            (i.status === "pending" || i.status === "running") &&
            i.created_at >= sinceIso,
        ) ?? null
      );
    },
    async createInvestigation(row) {
      await tick();
      const inv: InvestigationRow = { ...row, id: randomUUID(), created_at: ts(), updated_at: ts(), completed_at: null, error_summary: null };
      investigations.push(inv);
      return { ...inv };
    },
    async getInvestigation(id) {
      await tick();
      const inv = investigations.find((i) => i.id === id);
      return inv ? { ...inv } : null;
    },
    async listRecentInvestigations(limit) {
      await tick();
      return [...investigations].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    },
    async updateInvestigation(id, patch) {
      await tick();
      const inv = investigations.find((i) => i.id === id)!;
      Object.assign(inv, patch, { updated_at: ts() });
    },
    async createRuns(rows) {
      await tick();
      for (const r of rows) {
        if (runs.some((x) => x.investigation_id === r.investigation_id && x.operation === r.operation)) {
          throw new Error(`duplicate key: ${r.operation}`);
        }
      }
      const created = rows.map<RunRow>((r) => ({
        external_run_id: null,
        started_at: null,
        completed_at: null,
        error_message: null,
        metadata: {},
        ...r,
        id: randomUUID(),
        created_at: ts(),
        updated_at: ts(),
      }));
      runs.push(...created);
      return created.map((r) => ({ ...r }));
    },
    async listRuns(investigationId) {
      await tick();
      return runs.filter((r) => r.investigation_id === investigationId).map((r) => ({ ...r }));
    },
    async claimRun(id, fromStatus, patch) {
      await tick();
      const run = runs.find((r) => r.id === id);
      if (!run || run.status !== fromStatus) return null; // check-and-set happens without awaiting: atomic
      Object.assign(run, patch, { updated_at: ts() });
      return { ...run };
    },
    async updateRun(id, patch) {
      await tick();
      Object.assign(runs.find((r) => r.id === id)!, patch, { updated_at: ts() });
    },
    async insertEvidence(rows) {
      await tick();
      const inserted: EvidenceRow[] = [];
      for (const r of rows) {
        const exists = evidence.some(
          (e) => e.investigation_id === r.investigation_id && e.retrieval_method === r.retrieval_method && e.canonical_url === r.canonical_url,
        );
        if (exists) continue;
        const row = { ...r, id: randomUUID(), created_at: ts() };
        evidence.push(row);
        inserted.push({ ...row });
      }
      return inserted;
    },
    async insertFindings(rows) {
      await tick();
      findings.push(...rows.map((r) => ({ ...r, id: randomUUID(), created_at: ts() })));
    },
    async listEvidence(investigationId) {
      await tick();
      return evidence.filter((e) => e.investigation_id === investigationId);
    },
    async listFindings(investigationId) {
      await tick();
      return findings.filter((f) => f.investigation_id === investigationId);
    },
  };
  return { store, investigations, runs, evidence, findings };
}
