import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/env";
import { StoreError, type Store } from "@/lib/investigation/store";
import type { EvidenceRow, FindingRow, InvestigationRow, RunRow } from "./types";

// Service-role client: import only from server code (route handlers / lib), never from client components.
let client: SupabaseClient | undefined;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    const { url, serviceRoleKey } = supabaseConfig();
    client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

function unwrap<T>(res: { data: unknown; error: { message: string } | null }, what: string): T {
  if (res.error) throw new StoreError(`${what}: ${res.error.message}`);
  return res.data as T;
}

export function createSupabaseStore(db: SupabaseClient = supabaseAdmin()): Store {
  return {
    async findActiveDuplicate(input, sinceIso) {
      let q = db
        .from("investigations")
        .select("*")
        .eq("brand", input.brand)
        .eq("product_category", input.product_category)
        .eq("pincode", input.pincode)
        .in("status", ["pending", "running"])
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(1);
      q = input.product_model ? q.eq("product_model", input.product_model) : q.is("product_model", null);
      const rows = unwrap<InvestigationRow[]>(await q, "find duplicate");
      return rows[0] ?? null;
    },
    async createInvestigation(row) {
      return unwrap<InvestigationRow>(await db.from("investigations").insert(row).select().single(), "create investigation");
    },
    async getInvestigation(id) {
      return unwrap<InvestigationRow | null>(await db.from("investigations").select("*").eq("id", id).maybeSingle(), "get investigation");
    },
    async listRecentInvestigations(limit) {
      return unwrap<InvestigationRow[]>(
        await db.from("investigations").select("*").order("created_at", { ascending: false }).limit(limit),
        "list investigations",
      );
    },
    async updateInvestigation(id, patch) {
      unwrap(await db.from("investigations").update(patch).eq("id", id), "update investigation");
    },
    async createRuns(rows) {
      // PostgREST bulk inserts send null (not DEFAULT) for keys some rows omit, so every row must carry metadata.
      const full = rows.map((r) => ({ ...r, metadata: r.metadata ?? {} }));
      return unwrap<RunRow[]>(await db.from("investigation_runs").insert(full).select(), "create runs");
    },
    async listRuns(investigationId) {
      return unwrap<RunRow[]>(
        await db.from("investigation_runs").select("*").eq("investigation_id", investigationId).order("created_at"),
        "list runs",
      );
    },
    async claimRun(id, fromStatus, patch) {
      return unwrap<RunRow | null>(
        await db.from("investigation_runs").update(patch).eq("id", id).eq("status", fromStatus).select().maybeSingle(),
        "claim run",
      );
    },
    async updateRun(id, patch) {
      unwrap(await db.from("investigation_runs").update(patch).eq("id", id), "update run");
    },
    async insertEvidence(rows) {
      if (!rows.length) return [];
      return unwrap<EvidenceRow[]>(
        await db
          .from("evidence_sources")
          .upsert(rows, { onConflict: "investigation_id,retrieval_method,canonical_url", ignoreDuplicates: true })
          .select(),
        "insert evidence",
      );
    },
    async insertFindings(rows) {
      if (rows.length) unwrap(await db.from("findings").insert(rows), "insert findings");
    },
    async listEvidence(investigationId) {
      return unwrap<EvidenceRow[]>(
        await db.from("evidence_sources").select("*").eq("investigation_id", investigationId).order("created_at"),
        "list evidence",
      );
    },
    async listFindings(investigationId) {
      return unwrap<FindingRow[]>(
        await db.from("findings").select("*").eq("investigation_id", investigationId).order("created_at"),
        "list findings",
      );
    },
  };
}

/** Cheap connectivity check used by /api/health. */
export async function checkDatabase(): Promise<void> {
  unwrap(await supabaseAdmin().from("investigations").select("id", { head: true, count: "exact" }).limit(1), "health check");
}
