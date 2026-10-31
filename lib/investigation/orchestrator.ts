// Persisted, poll-driven orchestration. Each request does a bounded amount of work and saves state;
// nothing relies on a process staying alive between requests (Vercel-safe). Duplicate work is
// prevented by the unique (investigation_id, operation) constraint plus atomic status claims.

import { classifyDomain } from "@/lib/evidence/classify";
import { canonicalizeUrl } from "@/lib/evidence/url";
import { activeLocator, findAdapter, type ManufacturerAdapter } from "@/lib/locator/adapters";
import { dedupeListings, isDirectoryUrl, parseDetailPage, parseDirectoryPage, type DirectoryDetail, type DirectoryListing } from "@/lib/locator/directory";
import { buildLocatorAgentRequest } from "@/lib/locator/agent-locator";
import { validateLocatorRun, type LocatorValidation } from "@/lib/locator/validate";
import type {
  InvestigationRow,
  InvestigationStatus,
  Json,
  JsonObject,
  NewEvidence,
  NewFinding,
  NewRun,
  RunOperation,
  RunRow,
  RunStatus,
  VerificationStatus,
} from "@/lib/supabase/types";
import type { AgentRequest, AgentRun } from "@/lib/tinyfish/agent";
import type { FetchResponse } from "@/lib/tinyfish/fetch";
import { TinyFishError, type TinyFishErrorCode } from "@/lib/tinyfish/http";
import type { SearchParams, SearchResponse } from "@/lib/tinyfish/search";
import type { InvestigationInput } from "./input";
import type { Store } from "./store";

export interface TinyFishPort {
  search(params: SearchParams): Promise<SearchResponse>;
  fetchPages(urls: string[], options?: { links?: boolean }): Promise<FetchResponse>;
  startRun(request: AgentRequest): Promise<{ runId: string }>;
  getRun(runId: string): Promise<AgentRun>;
  cancelRun(runId: string): Promise<void>;
}

export interface Deps {
  store: Store;
  tinyfish: TinyFishPort;
  now: () => Date;
}

export const LIMITS = {
  maxAttempts: 3,
  duplicateWindowMs: 10 * 60_000,
  staleTaskMs: 3 * 60_000,
  agentDeadlineMs: 10 * 60_000,
  maxPollErrors: 5,
  maxContentChars: 50_000,
  maxFetchUrls: 3,
} as const;

export const OPERATION_LABELS: Record<RunOperation, string> = {
  search_official: "Official policy search",
  search_community: "Customer experience search",
  fetch_official: "Official page retrieval",
  locator_agent: "Service locator investigation",
  locator_directory: "Service centre directory",
};

const LOCATOR_OPS: ReadonlySet<RunOperation> = new Set(["locator_agent", "locator_directory"]);
const NO_RETRY: ReadonlySet<TinyFishErrorCode> = new Set(); // directory fetches are never retried (bounded live budget)

const TERMINAL_RUN: ReadonlySet<RunStatus> = new Set(["succeeded", "failed", "skipped", "timed_out"]);
const TERMINAL_INVESTIGATION: ReadonlySet<InvestigationStatus> = new Set(["completed", "partial", "failed"]);
// Starting an agent run is not idempotent: after a timeout the run may exist, so only a 429 is retried.
const AGENT_START_RETRYABLE: ReadonlySet<TinyFishErrorCode> = new Set(["RATE_LIMITED"]);

const json = (value: unknown) => value as Json;
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const iso = (d: Date) => d.toISOString();

function toIsoOrNull(value: string | null): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------------------------

export async function startInvestigation(
  deps: Deps,
  input: InvestigationInput,
): Promise<{ investigation: InvestigationRow; reused: boolean }> {
  const now = deps.now();
  const duplicate = await deps.store.findActiveDuplicate(input, iso(new Date(now.getTime() - LIMITS.duplicateWindowMs)));
  if (duplicate) return { investigation: duplicate, reused: true };

  const investigation = await deps.store.createInvestigation({ ...input, status: "running" });
  const adapter = findAdapter(input.brand);
  const base = { investigation_id: investigation.id, provider: "tinyfish" as const };
  try {
    await deps.store.createRuns([
      { ...base, operation: "search_official", status: "pending" },
      { ...base, operation: "search_community", status: "pending" },
      { ...base, operation: "fetch_official", status: "pending" },
      locatorRun(base, adapter, input.pincode, now),
    ]);
  } catch (error) {
    // don't leave a "running" investigation with no tasks behind (it would also block resubmission)
    await deps.store
      .updateInvestigation(investigation.id, { status: "failed", completed_at: iso(deps.now()), error_summary: "Investigation tasks could not be created" })
      .catch(() => {});
    throw error;
  }
  // Only start the agent here so the POST returns quickly; searches run on the first poll.
  const advanced = await advanceInvestigation(deps, investigation.id, { only: ["locator_agent"] });
  return { investigation: advanced ?? investigation, reused: false };
}

function locatorRun(base: Pick<NewRun, "investigation_id" | "provider">, adapter: ManufacturerAdapter | null, pincode: string, now: Date): NewRun {
  const strategy = adapter ? activeLocator(adapter) : null;
  const op = { ...base, operation: strategy?.kind === "static_directory" ? ("locator_directory" as const) : ("locator_agent" as const) };
  if (!adapter || !strategy) {
    return {
      ...op,
      status: "skipped",
      completed_at: iso(now),
      metadata: { locator_outcome: "UNSUPPORTED", reason: "No service locator adapter exists for this manufacturer yet" },
    };
  }
  if (strategy.kind === "unavailable") {
    return {
      ...op,
      status: "skipped",
      completed_at: iso(now),
      metadata: { locator_outcome: "LOCATOR_UNAVAILABLE", reason: strategy.reason, locator_url: strategy.url },
    };
  }
  if (strategy.kind === "static_directory") {
    const city = strategy.cityPages[pincode.slice(0, 3)];
    if (!city) {
      return {
        ...op,
        status: "skipped",
        completed_at: iso(now),
        metadata: { locator_outcome: "UNSUPPORTED", strategy: "static_directory", reason: `The ${adapter.name} directory is only mapped for Bengaluru (PIN 560xxx) so far` },
      };
    }
    return { ...op, status: "pending", metadata: { adapter: adapter.id, strategy: "static_directory", city: city.city, directory_urls: [...city.urls] } };
  }
  return {
    ...op,
    status: "pending",
    metadata: { adapter: adapter.id, strategy: "tinyfish_agent", locator_url: strategy.url, adapter_verified: strategy.verified },
  };
}

/** Moves every unfinished task one step forward. Safe to call repeatedly and concurrently. */
export async function advanceInvestigation(
  deps: Deps,
  id: string,
  opts: { only?: RunOperation[] } = {},
): Promise<InvestigationRow | null> {
  const investigation = await deps.store.getInvestigation(id);
  if (!investigation) return null;
  if (TERMINAL_INVESTIGATION.has(investigation.status)) return investigation;

  const adapter = findAdapter(investigation.brand);
  const wanted = (op: RunOperation) => !opts.only || opts.only.includes(op);

  let runs = await deps.store.listRuns(id);
  await settleAll(
    runs.filter((r) => r.operation !== "fetch_official" && wanted(r.operation)).map((r) => stepRun(deps, investigation, adapter, r, runs)),
  );
  if (wanted("fetch_official")) {
    runs = await deps.store.listRuns(id); // fetch depends on the official search's result
    const fetchRun = runs.find((r) => r.operation === "fetch_official");
    if (fetchRun) await stepRun(deps, investigation, adapter, fetchRun, runs);
  }

  runs = await deps.store.listRuns(id);
  const { status, summary } = deriveStatus(runs);
  if (status === investigation.status && summary === investigation.error_summary) return investigation;
  const completed_at = TERMINAL_INVESTIGATION.has(status) ? iso(deps.now()) : null;
  await deps.store.updateInvestigation(id, { status, error_summary: summary, completed_at });
  return { ...investigation, status, error_summary: summary, completed_at };
}

/** Runs all steps to completion, then rethrows the first failure (e.g. database down). */
async function settleAll(steps: Promise<void>[]): Promise<void> {
  const results = await Promise.allSettled(steps);
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (rejected) throw rejected.reason;
}

export function deriveStatus(runs: RunRow[]): { status: InvestigationStatus; summary: string | null } {
  if (!runs.length) return { status: "failed", summary: "Investigation has no tasks" };
  if (runs.some((r) => !TERMINAL_RUN.has(r.status))) return { status: "running", summary: null };
  const problems: string[] = [];
  for (const r of runs) {
    if (r.status === "failed" || r.status === "timed_out") {
      problems.push(`${OPERATION_LABELS[r.operation]}: ${r.error_message ?? r.status}`);
    }
  }
  const locator = runs.find((r) => LOCATOR_OPS.has(r.operation));
  if (locator?.status === "skipped") {
    problems.push(`${OPERATION_LABELS[locator.operation]}: ${String(locator.metadata.reason ?? "not attempted")}`);
  } else if (locator?.status === "succeeded") {
    const verification = (locator.metadata.validation as { verification?: string } | undefined)?.verification;
    if (verification !== "VERIFIED") problems.push(`${OPERATION_LABELS[locator.operation]}: result ${verification ?? "not validated"}`);
  }
  if (!problems.length) return { status: "completed", summary: null };
  return { status: runs.some((r) => r.status === "succeeded") ? "partial" : "failed", summary: problems.join("; ") };
}

// ---------------------------------------------------------------------------------------------
// Per-task steps
// ---------------------------------------------------------------------------------------------

async function stepRun(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow, runs: RunRow[]): Promise<void> {
  const now = deps.now();
  const ready = typeof run.metadata.not_before !== "string" || Date.parse(run.metadata.not_before) <= now.getTime();
  const stale = run.status === "running" && now.getTime() - Date.parse(run.updated_at) > LIMITS.staleTaskMs;

  if (run.operation === "locator_agent") {
    if (run.status === "pending" && ready) return startLocator(deps, inv, adapter, run);
    if (run.status === "running" && run.external_run_id) return pollLocator(deps, inv, adapter, run);
    if (stale) return markInterrupted(deps, run, "Locator start was interrupted before a run id was saved");
    return;
  }
  if (stale) return markInterrupted(deps, run, "Task was interrupted before completion");
  if (run.status !== "pending" || !ready) return;
  if (run.operation === "locator_directory") return runDirectory(deps, inv, adapter, run);
  if (run.operation === "fetch_official") {
    const search = runs.find((r) => r.operation === "search_official");
    if (search && TERMINAL_RUN.has(search.status)) return runFetch(deps, inv, adapter, run, search);
    return;
  }
  return runSearch(deps, inv, adapter, run);
}

async function markInterrupted(deps: Deps, run: RunRow, message: string): Promise<void> {
  await deps.store.claimRun(run.id, "running", { status: "failed", completed_at: iso(deps.now()), error_message: message });
}

/** Records the failure; schedules a bounded retry when the error is transient. Never swallows silently. */
async function handleFailure(deps: Deps, run: RunRow, error: unknown, retryable?: ReadonlySet<TinyFishErrorCode>): Promise<void> {
  const attempts = num(run.metadata.attempts) + 1;
  const tf = error instanceof TinyFishError ? error : null;
  const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[investigation ${run.investigation_id}] ${run.operation} attempt ${attempts} failed: ${diagnostic}`);
  const canRetry = tf && (retryable ? retryable.has(tf.code) : tf.retryable) && attempts < LIMITS.maxAttempts;
  const now = deps.now();
  if (canRetry) {
    const delaySec = Math.max(tf.retryAfterSec ?? 0, 5 * attempts);
    await deps.store.updateRun(run.id, {
      status: "pending",
      started_at: null,
      error_message: tf.publicMessage,
      metadata: { ...run.metadata, attempts, last_error: diagnostic, not_before: iso(new Date(now.getTime() + delaySec * 1000)) },
    });
    return;
  }
  await deps.store.updateRun(run.id, {
    status: "failed",
    completed_at: iso(now),
    error_message: tf?.publicMessage ?? "Internal error while processing this task",
    metadata: { ...run.metadata, attempts, last_error: diagnostic },
  });
}

async function runSearch(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow): Promise<void> {
  const claimed = await deps.store.claimRun(run.id, "pending", { status: "running", started_at: iso(deps.now()) });
  if (!claimed) return;
  const official = run.operation === "search_official";
  const product = [inv.brand, inv.product_category, inv.product_model].filter(Boolean).join(" ");
  const query = official ? `${product} warranty installation policy India` : `${product} service experience complaints India`;
  try {
    const res = await deps.tinyfish.search({
      query,
      location: "IN",
      language: "en",
      includeDomains: official && adapter ? [...adapter.officialDomains] : undefined,
    });
    const retrievedAt = iso(deps.now());
    const rows = new Map<string, NewEvidence>();
    for (const r of res.results) {
      const url = canonicalizeUrl(r.url);
      if (!url || rows.has(url.canonicalUrl)) continue;
      rows.set(url.canonicalUrl, {
        investigation_id: inv.id,
        source_url: r.url,
        canonical_url: url.canonicalUrl,
        domain: url.domain,
        source_type: classifyDomain(url.domain, adapter, url.canonicalUrl),
        retrieval_method: "tinyfish_search",
        retrieved_at: retrievedAt,
        published_at: toIsoOrNull(r.date),
        retrieval_status: "retrieved",
        title: r.title,
        content: r.snippet,
        metadata: { query, position: r.position, site_name: r.site_name, search_role: official ? "official" : "community" },
      });
    }
    const saved = await deps.store.insertEvidence([...rows.values()]);
    // Only manufacturer-owned or manufacturer-linked pages are fetched as "official promise" material.
    const fetchUrls = [...rows.values()]
      .filter((e) => e.source_type === "official_manufacturer" || e.source_type === "manufacturer_linked")
      .slice(0, LIMITS.maxFetchUrls)
      .map((e) => e.canonical_url);
    await deps.store.updateRun(run.id, {
      status: "succeeded",
      completed_at: iso(deps.now()),
      error_message: null,
      metadata: { ...claimed.metadata, query, result_count: res.results.length, stored: saved.length, ...(official ? { fetch_urls: fetchUrls } : {}) },
    });
  } catch (error) {
    await handleFailure(deps, claimed, error);
  }
}

async function runFetch(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow, search: RunRow): Promise<void> {
  const fromSearch =
    search.status === "succeeded" && Array.isArray(search.metadata.fetch_urls)
      ? search.metadata.fetch_urls.filter((u): u is string => typeof u === "string")
      : [];
  // adapter's own official pages first (fetched fresh each time), then search results; one Fetch request holds 10
  const urls = [...new Set([...(adapter?.officialPages ?? []), ...fromSearch])].slice(0, 10);
  if (!urls.length) {
    await deps.store.claimRun(run.id, "pending", {
      status: "skipped",
      completed_at: iso(deps.now()),
      metadata: { ...run.metadata, reason: search.status === "succeeded" ? "No official manufacturer pages found to fetch" : "Official search did not succeed" },
    });
    return;
  }
  const claimed = await deps.store.claimRun(run.id, "pending", { status: "running", started_at: iso(deps.now()) });
  if (!claimed) return;
  try {
    const res = await deps.tinyfish.fetchPages(urls);
    const retrievedAt = iso(deps.now());
    const rows: NewEvidence[] = [];
    for (const page of res.results) {
      const url = canonicalizeUrl(page.final_url) ?? canonicalizeUrl(page.url);
      if (!url) continue;
      const text = page.text ?? "";
      rows.push({
        investigation_id: inv.id,
        source_url: page.url,
        canonical_url: url.canonicalUrl,
        domain: url.domain,
        source_type: classifyDomain(url.domain, adapter, url.canonicalUrl),
        retrieval_method: "tinyfish_fetch",
        retrieved_at: retrievedAt,
        published_at: toIsoOrNull(page.published_date),
        retrieval_status: "retrieved",
        title: page.title,
        content: text.slice(0, LIMITS.maxContentChars),
        metadata: {
          final_url: page.final_url,
          description: page.description,
          language: page.language,
          etag: page.etag,
          last_modified: page.last_modified,
          latency_ms: page.latency_ms,
          content_length: text.length,
          truncated: text.length > LIMITS.maxContentChars,
        },
      });
    }
    for (const failure of res.errors) {
      const url = canonicalizeUrl(failure.url);
      if (!url) continue;
      rows.push({
        investigation_id: inv.id,
        source_url: failure.url,
        canonical_url: url.canonicalUrl,
        domain: url.domain,
        source_type: classifyDomain(url.domain, adapter, url.canonicalUrl),
        retrieval_method: "tinyfish_fetch",
        retrieved_at: retrievedAt,
        published_at: null,
        retrieval_status: "failed",
        title: null,
        content: null,
        metadata: { error: failure.error, status: failure.status },
      });
    }
    await deps.store.insertEvidence(rows);
    const ok = res.results.length > 0;
    await deps.store.updateRun(run.id, {
      status: ok ? "succeeded" : "failed",
      completed_at: iso(deps.now()),
      error_message: ok ? null : "None of the official pages could be retrieved",
      metadata: { ...claimed.metadata, requested: urls.length, retrieved: res.results.length, failed: res.errors.length },
    });
  } catch (error) {
    await handleFailure(deps, claimed, error);
  }
}

async function startLocator(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow): Promise<void> {
  const strategy = adapter ? activeLocator(adapter) : null;
  if (!adapter || strategy?.kind !== "tinyfish_agent") {
    await deps.store.claimRun(run.id, "pending", { status: "skipped", completed_at: iso(deps.now()), metadata: { ...run.metadata, locator_outcome: "UNSUPPORTED" } });
    return;
  }
  const claimed = await deps.store.claimRun(run.id, "pending", { status: "running", started_at: iso(deps.now()) });
  if (!claimed) return;
  try {
    const request = buildLocatorAgentRequest(adapter, strategy, inv);
    const { runId } = await deps.tinyfish.startRun(request);
    // shortcut: if this write fails the TinyFish run is orphaned (row goes stale -> failed); acceptable at hackathon scale
    await deps.store.updateRun(run.id, {
      external_run_id: runId,
      metadata: {
        ...claimed.metadata,
        agent_request: {
          url: request.url,
          browser_profile: request.browser_profile ?? null,
          proxy_country: request.proxy_config?.country_code ?? null,
          max_duration_seconds: request.agent_config?.max_duration_seconds ?? null,
        },
      },
    });
  } catch (error) {
    await handleFailure(deps, claimed, error, AGENT_START_RETRYABLE);
  }
}

async function pollLocator(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow): Promise<void> {
  const externalId = run.external_run_id!;
  const now = deps.now();
  let agentRun: AgentRun;
  try {
    agentRun = await deps.tinyfish.getRun(externalId);
  } catch (error) {
    const pollErrors = num(run.metadata.poll_errors) + 1;
    const diagnostic = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[investigation ${inv.id}] poll ${pollErrors} of run ${externalId} failed: ${diagnostic}`);
    if (pollErrors >= LIMITS.maxPollErrors) {
      await deps.store.claimRun(run.id, "running", {
        status: "failed",
        completed_at: iso(now),
        error_message: "Lost contact with the locator run",
        metadata: { ...run.metadata, poll_errors: pollErrors, last_error: diagnostic },
      });
    } else {
      await deps.store.updateRun(run.id, { metadata: { ...run.metadata, poll_errors: pollErrors, last_error: diagnostic } });
    }
    return;
  }

  const progress: JsonObject = {
    provider_status: agentRun.status,
    streaming_url: agentRun.streaming_url,
    num_of_steps: agentRun.num_of_steps,
    recent_steps: agentRun.steps.slice(-8).map((s) => s.action),
    last_polled_at: iso(now),
  };

  if (agentRun.status === "PENDING" || agentRun.status === "RUNNING") {
    const startedMs = Date.parse(run.started_at ?? run.created_at);
    if (now.getTime() - startedMs > LIMITS.agentDeadlineMs) {
      const claimed = await deps.store.claimRun(run.id, "running", {
        status: "timed_out",
        completed_at: iso(now),
        error_message: "Locator investigation exceeded the time limit",
        metadata: { ...run.metadata, ...progress },
      });
      if (claimed) {
        await deps.tinyfish.cancelRun(externalId).catch((e: unknown) => {
          console.error(`[investigation ${inv.id}] cancel of ${externalId} failed: ${e instanceof Error ? e.message : String(e)}`);
        });
      }
      return;
    }
    await deps.store.updateRun(run.id, { metadata: { ...run.metadata, ...progress } });
    return;
  }

  if (!adapter) {
    await deps.store.claimRun(run.id, "running", { status: "failed", completed_at: iso(now), error_message: "Manufacturer adapter no longer exists" });
    return;
  }
  const validation = validateLocatorRun(agentRun, { expectedPin: inv.pincode, approvedDomains: adapter.officialDomains });
  const executed = agentRun.status === "COMPLETED";
  const claimed = await deps.store.claimRun(run.id, "running", {
    status: executed ? "succeeded" : "failed",
    completed_at: iso(now),
    error_message: executed ? null : "Locator agent run did not complete",
    metadata: {
      ...run.metadata,
      ...progress,
      provider_error: json(agentRun.error),
      started_at_provider: agentRun.started_at,
      finished_at_provider: agentRun.finished_at,
      validation: json(validation),
    },
  });
  if (!claimed) return; // another request already finalised this run
  await persistLocatorEvidence(deps, inv, adapter, agentRun, validation);
}

function locatorClaim(adapter: ManufacturerAdapter, pin: string, v: LocatorValidation): string {
  switch (v.outcome) {
    case "CENTERS_FOUND":
      return `${adapter.name}'s official locator returned ${v.centers.length} service centre(s) for PIN ${pin}.`;
    case "NO_CENTERS_RETURNED":
      return `${adapter.name}'s official locator search for PIN ${pin} returned no service centres. This does not establish that service is unavailable.`;
    case "NOT_VERIFIED":
      return `${adapter.name} locator result for PIN ${pin} could not be verified; service availability is unknown.`;
    default:
      return `${adapter.name} locator investigation did not complete; service availability for PIN ${pin} is unknown.`;
  }
}

async function persistLocatorEvidence(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter, agentRun: AgentRun, v: LocatorValidation): Promise<void> {
  const strategy = activeLocator(adapter);
  if (strategy.kind !== "tinyfish_agent") return;
  const url = canonicalizeUrl(v.checks.resultUrl ?? strategy.url);
  if (!url) return;
  const [evidence] = await deps.store.insertEvidence([
    {
      investigation_id: inv.id,
      source_url: v.checks.resultUrl ?? strategy.url,
      canonical_url: url.canonicalUrl,
      domain: url.domain,
      source_type: classifyDomain(url.domain, adapter),
      retrieval_method: "tinyfish_agent",
      retrieved_at: iso(deps.now()),
      published_at: null,
      retrieval_status: agentRun.status === "COMPLETED" ? "retrieved" : "failed",
      title: `${adapter.name} official service centre locator`,
      content: JSON.stringify(agentRun.result ?? null).slice(0, LIMITS.maxContentChars),
      metadata: {
        agent_run_id: agentRun.run_id,
        provider_status: agentRun.status,
        provider_error: json(agentRun.error),
        num_of_steps: agentRun.num_of_steps,
        started_at: agentRun.started_at,
        finished_at: agentRun.finished_at,
        streaming_url: agentRun.streaming_url,
        steps: agentRun.steps.map((s) => s.action),
        locator_url: strategy.url,
        expected_pin: v.checks.expectedPin,
        returned_pin: v.checks.returnedPin,
        search_submitted: v.checks.searchSubmitted,
        domain_approved: v.checks.domainApproved,
        result_domain: v.checks.resultDomain,
        results_structurally_valid: v.checks.resultsStructurallyValid,
        verification: v.verification,
        outcome: v.outcome,
        reasons: v.reasons,
      },
    },
  ]);
  if (!evidence) return; // already persisted by an earlier request

  const findings: NewFinding[] = [
    {
      investigation_id: inv.id,
      evidence_source_id: evidence.id,
      finding_type: "locator_result",
      claim: locatorClaim(adapter, inv.pincode, v),
      extracted_value: { outcome: v.outcome, centers: v.centers.length, discarded: v.discardedCenters },
      verification_status: v.verification,
      confidence: null, // assigned by the scoring stage
      metadata: { reasons: v.reasons },
    },
    ...v.centers.map((c) => ({
      investigation_id: inv.id,
      evidence_source_id: evidence.id,
      finding_type: "service_center" as const,
      claim: `Service centre listed by ${adapter.name}'s official locator: ${c.name}`,
      extracted_value: { ...c },
      verification_status: v.verification,
      confidence: null,
      metadata: {},
    })),
  ];
  await deps.store.insertFindings(findings);
}

// ---------------------------------------------------------------------------------------------
// Static directory locator (Samsung default since Stage 2.7). At most two Fetch requests:
// 1) the city pages (with links), 2) up to maxDetailPages centre detail pages. Never retried.
// ---------------------------------------------------------------------------------------------

type DirectoryCenter = ReturnType<typeof toDirectoryCenter>;

function toDirectoryCenter(l: DirectoryListing, d: { detail: DirectoryDetail; retrievedAt: string } | undefined, cityAt: string, pin: string) {
  return {
    name: l.name,
    address: [l.street, l.locality, l.city].filter(Boolean).join(", ") + (l.pin ? ` - ${l.pin}` : ""),
    street: l.street,
    locality: l.locality,
    city: l.city,
    pin: l.pin,
    pin_raw: l.pin ? null : l.pinRaw,
    phone: l.phone,
    landmark: l.landmark,
    source_url: l.sourceUrl,
    detail_url: l.detailUrl,
    retrieved_at: d?.retrievedAt ?? cityAt,
    coordinates: d?.detail.coordinates ?? null,
    hours: d ? d.detail.hours : null,
    categories: d?.detail.categories ?? null,
    products_explicit: d ? d.detail.productsExplicit : null,
    ac_service: d ? (d.detail.acServiceExplicit ? "explicitly_listed" : "not_stated") : "unknown_no_detail_page",
    in_customer_pin: l.pin === pin,
    authorisation: "listed_as_authorised_on_samsung_linked_directory",
    pin_coverage: "not_established",
  };
}

function directoryReasons(centers: DirectoryCenter[], directoryDomains: readonly string[], city: string, pin: string): string[] {
  if (!centers.length) return [];
  const ac = centers.filter((c) => c.ac_service === "explicitly_listed").length;
  const noDetail = centers.filter((c) => c.ac_service === "unknown_no_detail_page").length;
  const badPins = centers.filter((c) => !c.pin).length;
  return [
    `Listings come from a Samsung-linked directory (${directoryDomains.join(", ")}); "authorised" is the directory's own label and is not confirmed on samsung.com`,
    `A ${city} city listing does not establish service coverage for PIN ${pin}`,
    ...(centers.some((c) => c.in_customer_pin) ? [] : [`No listed centre is located in PIN ${pin}; this does not mean the PIN is unserved`]),
    `Air-conditioner service is explicitly listed for ${ac} of ${centers.length} centres; for the rest it is not stated, which is not the same as not offered`,
    ...(noDetail ? [`${noDetail} centre(s) have no detail page retrieved, so coordinates and categories are unknown for them`] : []),
    ...(badPins ? [`${badPins} listing(s) had a malformed PIN; kept with pin = null`] : []),
    `Distances are not calculated: no coordinates are available for PIN ${pin}`,
    "Home installation eligibility is not covered by the directory",
  ];
}

async function runDirectory(deps: Deps, inv: InvestigationRow, adapter: ManufacturerAdapter | null, run: RunRow): Promise<void> {
  const strategy = adapter ? activeLocator(adapter) : null;
  const city = strategy?.kind === "static_directory" ? strategy.cityPages[inv.pincode.slice(0, 3)] : undefined;
  if (!adapter || strategy?.kind !== "static_directory" || !city) {
    await deps.store.claimRun(run.id, "pending", {
      status: "skipped",
      completed_at: iso(deps.now()),
      metadata: { ...run.metadata, locator_outcome: "UNSUPPORTED", reason: "No directory mapping for this manufacturer and PIN" },
    });
    return;
  }
  const claimed = await deps.store.claimRun(run.id, "pending", { status: "running", started_at: iso(deps.now()) });
  if (!claimed) return;

  try {
    const cityRes = await deps.tinyfish.fetchPages([...city.urls], { links: true });
    const cityAt = iso(deps.now());
    const notes: string[] = [];
    const evidence: NewEvidence[] = [];
    const base = { investigation_id: inv.id, retrieval_method: "tinyfish_fetch" as const, published_at: null };
    let listings: DirectoryListing[] = [];

    for (const page of cityRes.results) {
      const url = canonicalizeUrl(page.final_url) ?? canonicalizeUrl(page.url);
      if (!url) continue;
      const allowed = isDirectoryUrl(page.final_url, strategy);
      const parsed = allowed ? parseDirectoryPage({ url: url.canonicalUrl, text: page.text ?? "", links: page.links }, strategy) : [];
      if (!allowed) notes.push(`Ignored a page served from ${url.domain}: not the expected directory domain`);
      listings.push(...parsed);
      evidence.push({
        ...base,
        source_url: page.url,
        canonical_url: url.canonicalUrl,
        domain: url.domain,
        source_type: classifyDomain(url.domain, adapter),
        retrieved_at: cityAt,
        retrieval_status: "retrieved",
        title: page.title,
        content: (page.text ?? "").slice(0, LIMITS.maxContentChars),
        metadata: { role: "directory_city_page", city: city.city, listings_found: parsed.length, domain_allowed: allowed, final_url: page.final_url, etag: page.etag, last_modified: page.last_modified },
      });
    }
    for (const failure of cityRes.errors) {
      notes.push(`Directory page could not be retrieved: ${failure.url} (${failure.error})`);
      const url = canonicalizeUrl(failure.url);
      if (url) {
        evidence.push({
          ...base,
          source_url: failure.url,
          canonical_url: url.canonicalUrl,
          domain: url.domain,
          source_type: classifyDomain(url.domain, adapter),
          retrieved_at: cityAt,
          retrieval_status: "failed",
          title: null,
          content: null,
          metadata: { role: "directory_city_page", error: failure.error, status: failure.status },
        });
      }
    }
    listings = dedupeListings(listings);

    const details = new Map<string, { detail: DirectoryDetail; retrievedAt: string }>();
    const targets = listings.filter((l) => l.detailUrl && isDirectoryUrl(l.detailUrl, strategy)).slice(0, strategy.maxDetailPages);
    if (targets.length) {
      try {
        const detailRes = await deps.tinyfish.fetchPages(targets.map((l) => l.detailUrl!));
        const at = iso(deps.now());
        for (const page of detailRes.results) {
          const url = canonicalizeUrl(page.url);
          if (!url || !isDirectoryUrl(page.final_url, strategy)) continue;
          const detail = parseDetailPage(page.text ?? "");
          details.set(page.url, { detail, retrievedAt: at });
          evidence.push({
            ...base,
            source_url: page.url,
            canonical_url: url.canonicalUrl,
            domain: url.domain,
            source_type: classifyDomain(url.domain, adapter),
            retrieved_at: at,
            retrieval_status: "retrieved",
            title: page.title,
            content: (page.text ?? "").slice(0, LIMITS.maxContentChars),
            metadata: {
              role: "directory_detail_page",
              coordinates: json(detail.coordinates),
              hours: detail.hours,
              categories: detail.categories,
              tags: detail.tags,
              products_explicit: detail.productsExplicit,
              ac_service_explicit: detail.acServiceExplicit,
            },
          });
        }
        for (const failure of detailRes.errors) notes.push(`Detail page could not be retrieved: ${failure.url} (${failure.error})`);
      } catch (error) {
        // listings are kept; details are optional
        console.error(`[investigation ${inv.id}] directory detail fetch failed: ${error instanceof Error ? error.message : String(error)}`);
        notes.push(`Detail pages could not be retrieved (${error instanceof TinyFishError ? error.publicMessage : "internal error"}); listings kept without details`);
      }
    }

    const centers = listings.map((l) => toDirectoryCenter(l, l.detailUrl ? details.get(l.detailUrl) : undefined, cityAt, inv.pincode));
    const retrieved = cityRes.results.length > 0;
    const verification: VerificationStatus = centers.length ? "PARTIALLY_VERIFIED" : retrieved ? "UNVERIFIED" : "FAILED";
    const outcome = centers.length ? "CENTERS_FOUND" : retrieved ? "NOT_VERIFIED" : "EXECUTION_FAILED";
    const reasons = [
      ...directoryReasons(centers, strategy.directoryDomains, city.city, inv.pincode),
      ...notes,
      ...(!centers.length && retrieved ? ["Directory pages were retrieved but no listings could be extracted"] : []),
    ];

    const saved = await deps.store.insertEvidence(evidence);
    const idByUrl = new Map(saved.map((e) => [e.canonical_url, e.id]));
    const cityEvidenceId = saved.find((e) => e.metadata.role === "directory_city_page" && e.retrieval_status === "retrieved")?.id;
    if (cityEvidenceId) {
      await deps.store.insertFindings([
        {
          investigation_id: inv.id,
          evidence_source_id: cityEvidenceId,
          finding_type: "locator_result",
          claim: centers.length
            ? `${centers.length} centres in ${city.city} are listed as authorised on a Samsung-linked directory. Coverage of PIN ${inv.pincode} is not established.`
            : `The ${city.city} directory could not be read; service availability for PIN ${inv.pincode} is unknown.`,
          extracted_value: {
            outcome,
            centers: centers.length,
            ac_explicit: centers.filter((c) => c.ac_service === "explicitly_listed").length,
            with_coordinates: centers.filter((c) => c.coordinates).length,
          },
          verification_status: verification,
          confidence: null,
          metadata: { reasons },
        },
        ...centers.map((c) => ({
          investigation_id: inv.id,
          evidence_source_id: (c.detail_url ? idByUrl.get(canonicalizeUrl(c.detail_url)?.canonicalUrl ?? "") : undefined) ?? idByUrl.get(c.source_url) ?? cityEvidenceId,
          finding_type: "service_center" as const,
          claim: `Listed as authorised on a Samsung-linked directory: ${c.name}, ${c.address}`,
          extracted_value: json(c) as JsonObject,
          verification_status: "PARTIALLY_VERIFIED" as const,
          confidence: null,
          metadata: {
            claims: { existence: "supported_by_listing", authorisation: "self_declared_on_samsung_linked_directory", ac_capability: c.ac_service, pin_coverage: "not_established", installation: "not_addressed" },
          },
        })),
      ]);
    }

    await deps.store.updateRun(run.id, {
      status: retrieved ? "succeeded" : "failed",
      completed_at: iso(deps.now()),
      error_message: retrieved ? null : "Directory pages could not be retrieved",
      metadata: {
        ...claimed.metadata,
        fetch_requests: targets.length ? 2 : 1,
        listings_found: centers.length,
        details_retrieved: details.size,
        validation: json({ verification, outcome, reasons, checks: null, centers }),
      },
    });
  } catch (error) {
    await handleFailure(deps, claimed, error, NO_RETRY);
  }
}
