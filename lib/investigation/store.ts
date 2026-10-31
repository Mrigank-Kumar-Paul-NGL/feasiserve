import type {
  EvidenceRow,
  FindingRow,
  InvestigationRow,
  NewEvidence,
  NewFinding,
  NewInvestigation,
  NewRun,
  RunPatch,
  RunRow,
  RunStatus,
} from "@/lib/supabase/types";
import type { InvestigationInput } from "./input";

export class StoreError extends Error {
  override name = "StoreError";
}

/** Persistence boundary. All job state lives here, so no process has to survive between requests. */
export interface Store {
  findActiveDuplicate(input: InvestigationInput, sinceIso: string): Promise<InvestigationRow | null>;
  createInvestigation(row: NewInvestigation): Promise<InvestigationRow>;
  getInvestigation(id: string): Promise<InvestigationRow | null>;
  /** Most recent first; used to list recorded investigations. */
  listRecentInvestigations(limit: number): Promise<InvestigationRow[]>;
  updateInvestigation(id: string, patch: Partial<Pick<InvestigationRow, "status" | "completed_at" | "error_summary">>): Promise<void>;
  createRuns(rows: NewRun[]): Promise<RunRow[]>;
  listRuns(investigationId: string): Promise<RunRow[]>;
  /** Atomic compare-and-set on status. Returns null if another request got there first. */
  claimRun(id: string, fromStatus: RunStatus, patch: RunPatch): Promise<RunRow | null>;
  updateRun(id: string, patch: RunPatch): Promise<void>;
  /** Skips rows that already exist for (investigation, method, canonical_url); returns only new rows. */
  insertEvidence(rows: NewEvidence[]): Promise<EvidenceRow[]>;
  insertFindings(rows: NewFinding[]): Promise<void>;
  listEvidence(investigationId: string): Promise<EvidenceRow[]>;
  listFindings(investigationId: string): Promise<FindingRow[]>;
}
