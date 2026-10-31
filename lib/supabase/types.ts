// Row types matching supabase/migrations/20261031000000_init.sql.
// shortcut: hand-written; regenerate with Supabase type generation once the project exists.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type JsonObject = { [key: string]: Json | undefined };

export type InvestigationStatus = "pending" | "running" | "completed" | "partial" | "failed";
export type RunOperation = "search_official" | "search_community" | "fetch_official" | "locator_agent" | "locator_directory";
export type RunStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "timed_out";
export type SourceType = "official_manufacturer" | "manufacturer_linked" | "community" | "third_party" | "unknown";
export type RetrievalMethod = "tinyfish_search" | "tinyfish_fetch" | "tinyfish_agent";
export type VerificationStatus = "VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "FAILED";

export interface InvestigationRow {
  id: string;
  brand: string;
  product_category: string;
  product_model: string | null;
  pincode: string;
  status: InvestigationStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  error_summary: string | null;
}

export interface RunRow {
  id: string;
  investigation_id: string;
  provider: "tinyfish";
  operation: RunOperation;
  external_run_id: string | null;
  status: RunStatus;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
}

export interface EvidenceRow {
  id: string;
  investigation_id: string;
  source_url: string;
  canonical_url: string;
  domain: string;
  source_type: SourceType;
  retrieval_method: RetrievalMethod;
  retrieved_at: string;
  published_at: string | null;
  retrieval_status: "retrieved" | "failed";
  title: string | null;
  content: string | null;
  metadata: JsonObject;
  created_at: string;
}

export interface FindingRow {
  id: string;
  investigation_id: string;
  evidence_source_id: string;
  finding_type: "locator_result" | "service_center";
  claim: string;
  extracted_value: JsonObject;
  verification_status: VerificationStatus;
  confidence: number | null;
  metadata: JsonObject;
  created_at: string;
}

export type NewInvestigation = Pick<InvestigationRow, "brand" | "product_category" | "product_model" | "pincode" | "status">;
export type NewRun = Pick<RunRow, "investigation_id" | "provider" | "operation" | "status"> &
  Partial<Pick<RunRow, "metadata" | "error_message" | "completed_at">>;
export type RunPatch = Partial<Omit<RunRow, "id" | "investigation_id" | "operation" | "provider" | "created_at" | "updated_at">>;
export type NewEvidence = Omit<EvidenceRow, "id" | "created_at">;
export type NewFinding = Omit<FindingRow, "id" | "created_at">;
