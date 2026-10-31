import { canonicalizeUrl, domainMatches } from "@/lib/evidence/url";
import type { VerificationStatus } from "@/lib/supabase/types";
import type { AgentRun } from "@/lib/tinyfish/agent";
import { isRecord, str } from "@/lib/tinyfish/http";

/**
 * Locator outcomes. There is deliberately no "NO_SERVICE": a locator can at most report that it
 * returned no centres, which never proves service is unavailable.
 */
export type LocatorOutcome =
  | "CENTERS_FOUND"
  | "NO_CENTERS_RETURNED"
  | "NOT_VERIFIED"
  | "EXECUTION_FAILED"
  | "UNSUPPORTED"
  | "LOCATOR_UNAVAILABLE";

export interface ServiceCenter {
  name: string;
  address: string | null;
  phone: string | null;
  distance: string | null;
  hours: string | null;
  products: string | null;
}

export interface LocatorChecks {
  executionStatus: string;
  searchSubmitted: boolean | null;
  expectedPin: string;
  returnedPin: string | null;
  pinMatches: boolean;
  resultUrl: string | null;
  resultDomain: string | null;
  /** null = the agent reported no result URL, so the domain could not be checked */
  domainApproved: boolean | null;
  resultsStructurallyValid: boolean;
}

export interface LocatorValidation {
  verification: VerificationStatus;
  outcome: LocatorOutcome;
  reasons: string[];
  checks: LocatorChecks;
  /** Only populated when the hard checks pass; rejected results are never surfaced as centres. */
  centers: ServiceCenter[];
  discardedCenters: number;
}

function parseCenters(raw: unknown): { centers: ServiceCenter[]; discarded: number; isArray: boolean } {
  if (!Array.isArray(raw)) return { centers: [], discarded: 0, isArray: false };
  const centers: ServiceCenter[] = [];
  let discarded = 0;
  for (const c of raw) {
    const name = isRecord(c) ? str(c.name) : null;
    if (!isRecord(c) || !name) {
      discarded++;
      continue;
    }
    centers.push({ name, address: str(c.address), phone: str(c.phone), distance: str(c.distance), hours: str(c.hours), products: str(c.products) });
  }
  return { centers, discarded, isArray: true };
}

/** Judges an agent run on its own evidence. Never trusts the run's COMPLETED status or its echoed claims. */
export function validateLocatorRun(run: AgentRun, ctx: { expectedPin: string; approvedDomains: readonly string[] }): LocatorValidation {
  const checks: LocatorChecks = {
    executionStatus: run.status,
    searchSubmitted: null,
    expectedPin: ctx.expectedPin,
    returnedPin: null,
    pinMatches: false,
    resultUrl: null,
    resultDomain: null,
    domainApproved: null,
    resultsStructurallyValid: false,
  };
  const failed = (reason: string): LocatorValidation => ({
    verification: "FAILED",
    outcome: "EXECUTION_FAILED",
    reasons: [reason],
    checks,
    centers: [],
    discardedCenters: 0,
  });

  if (run.status !== "COMPLETED") {
    return failed(`Agent run ended with status ${run.status}${run.error?.code ? ` (${run.error.code})` : ""}`);
  }
  const r = run.result;
  if (!isRecord(r)) return failed("Agent returned no structured result");

  checks.searchSubmitted = typeof r.search_submitted === "boolean" ? r.search_submitted : null;
  checks.returnedPin = typeof r.pin_entered === "string" ? r.pin_entered.trim() : null;
  checks.pinMatches = checks.returnedPin === ctx.expectedPin;
  const url = typeof r.results_page_url === "string" ? canonicalizeUrl(r.results_page_url) : null;
  if (url) {
    checks.resultUrl = url.canonicalUrl;
    checks.resultDomain = url.domain;
    checks.domainApproved = domainMatches(url.domain, ctx.approvedDomains);
  }
  const { centers, discarded, isArray } = parseCenters(r.service_centers);
  checks.resultsStructurallyValid = isArray && discarded === 0;

  const navError = [str(r.obstacles), str(r.page_message)].join(" ").match(/\bERR_[A-Z_]+\b/)?.[0];
  if (navError && checks.searchSubmitted !== true) return failed(`Browser navigation error: ${navError}`);

  const reasons: string[] = [];
  if (checks.searchSubmitted !== true) reasons.push("Agent did not confirm the locator search was submitted");
  if (!checks.pinMatches) reasons.push(`Submitted PIN "${checks.returnedPin ?? "none"}" does not match expected "${ctx.expectedPin}"`);
  if (checks.domainApproved === false) reasons.push(`Result page domain ${checks.resultDomain} is not an approved manufacturer domain`);
  if (!isArray) reasons.push("service_centers is missing or malformed");
  if (reasons.length) {
    return { verification: "UNVERIFIED", outcome: "NOT_VERIFIED", reasons, checks, centers: [], discardedCenters: discarded };
  }

  const caveats: string[] = [];
  if (checks.domainApproved === null) caveats.push("Agent did not report the result page URL; domain could not be confirmed");
  if (discarded) caveats.push(`${discarded} malformed service centre entr${discarded === 1 ? "y" : "ies"} discarded`);
  if (navError) caveats.push(`Navigation error reported during run: ${navError}`);
  if (!centers.length) caveats.push("Locator returned no service centres; this does not prove service is unavailable");
  return {
    verification: caveats.length ? "PARTIALLY_VERIFIED" : "VERIFIED",
    outcome: centers.length ? "CENTERS_FOUND" : "NO_CENTERS_RETURNED",
    reasons: caveats,
    checks,
    centers,
    discardedCenters: discarded,
  };
}
