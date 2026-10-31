import { classifyDomain } from "@/lib/evidence/classify";
import { findAdapter } from "@/lib/locator/adapters";
import type { LocatorValidation } from "@/lib/locator/validate";
import { buildReport, type CentreInput } from "@/lib/scoring/engine";
import type { EvidenceRow, FindingRow, InvestigationRow, RunRow } from "@/lib/supabase/types";
import { OPERATION_LABELS } from "./orchestrator";

/** Client-facing shape. Excludes internal diagnostics (metadata.last_error, provider error bodies). */
export function buildInvestigationView(inv: InvestigationRow, runs: RunRow[], evidence: EvidenceRow[], findings: FindingRow[]) {
  const locatorRun = runs.find((r) => r.operation === "locator_agent" || r.operation === "locator_directory");
  const validation = locatorRun?.metadata.validation as LocatorValidation | undefined;
  const reason = typeof locatorRun?.metadata.reason === "string" ? locatorRun.metadata.reason : null;
  const strategy = locatorRun?.operation === "locator_directory" ? ("static_directory" as const) : ("tinyfish_agent" as const);
  // Re-apply the current region rule to rows stored as official, so older runs that saved another country's page
  // (e.g. samsung.com/us/) are scored as non-official. Stored rows are not modified.
  const adapter = findAdapter(inv.brand);
  const scoredEvidence = evidence.map((e) =>
    e.source_type === "official_manufacturer" ? { ...e, source_type: classifyDomain(e.domain, adapter, e.canonical_url) } : e,
  );
  const report = buildReport({
    brand: inv.brand,
    category: inv.product_category,
    pincode: inv.pincode,
    evidence: scoredEvidence,
    locator: locatorRun
      ? {
          strategy,
          status: locatorRun.status,
          verification: validation?.verification ?? null,
          outcome: validation?.outcome ?? null,
          centres: (validation?.centers ?? []) as unknown as CentreInput[],
          city:
            typeof locatorRun.metadata.city === "string"
              ? locatorRun.metadata.city
              : ((validation?.centers?.[0] as unknown as { city?: string } | undefined)?.city ?? null),
        }
      : null,
  });
  return {
    report,
    id: inv.id,
    status: inv.status,
    input: { brand: inv.brand, product_category: inv.product_category, product_model: inv.product_model, pincode: inv.pincode },
    created_at: inv.created_at,
    updated_at: inv.updated_at,
    completed_at: inv.completed_at,
    error_summary: inv.error_summary,
    tasks: runs.map((r) => ({
      operation: r.operation,
      label: OPERATION_LABELS[r.operation],
      status: r.status,
      started_at: r.started_at,
      completed_at: r.completed_at,
      error: r.error_message,
      attempts: typeof r.metadata.attempts === "number" ? r.metadata.attempts : 0,
      provider_status: r.metadata.provider_status ?? null,
      recent_steps: Array.isArray(r.metadata.recent_steps) ? r.metadata.recent_steps : [],
    })),
    locator: locatorRun
      ? {
          status: locatorRun.status,
          strategy: locatorRun.operation === "locator_directory" ? "static_directory" : "tinyfish_agent",
          agent_run_id: locatorRun.external_run_id,
          live_view_url: locatorRun.status === "running" ? (locatorRun.metadata.streaming_url ?? null) : null,
          outcome: validation?.outcome ?? locatorRun.metadata.locator_outcome ?? null,
          verification: validation?.verification ?? null,
          reasons: validation?.reasons ?? (reason ? [reason] : []),
          checks: validation?.checks ?? null,
          service_centers: validation?.centers ?? [],
        }
      : null,
    evidence: scoredEvidence.map((e) => ({
      id: e.id,
      source_url: e.source_url,
      canonical_url: e.canonical_url,
      domain: e.domain,
      source_type: e.source_type,
      retrieval_method: e.retrieval_method,
      retrieval_status: e.retrieval_status,
      retrieved_at: e.retrieved_at,
      published_at: e.published_at,
      title: e.title,
      excerpt: e.content ? e.content.slice(0, 300) : null,
    })),
    findings: findings.map((f) => ({
      id: f.id,
      evidence_source_id: f.evidence_source_id,
      finding_type: f.finding_type,
      claim: f.claim,
      verification_status: f.verification_status,
      extracted_value: f.extracted_value,
    })),
  };
}

export type InvestigationView = ReturnType<typeof buildInvestigationView>;
