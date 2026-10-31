import { describe, expect, it } from "vitest";
import { validateLocatorRun, type LocatorValidation } from "@/lib/locator/validate";
import { RECORDED, syntheticAgentRun } from "./fixtures";

const SAMSUNG = { expectedPin: "560001", approvedDomains: ["samsung.com"] };
const LG = { expectedPin: "560001", approvedDomains: ["lg.com"] };

// Phrases that would assert absence of service. Disclaimers ("does not prove service is unavailable") are fine.
const FALSE_UNAVAILABILITY = /NO_SERVICE|no service (is )?available|service is not available|not serviceable|no authori[sz]ed service/i;

// The core safety property: no failure mode may ever be reported as "no service".
function expectNoFalseUnavailability(v: LocatorValidation) {
  expect(v.outcome).not.toBe("NO_SERVICE");
  expect(JSON.stringify(v)).not.toMatch(FALSE_UNAVAILABILITY);
}

describe("validateLocatorRun", () => {
  it("1. VERIFIED: matching PIN, approved domain, submitted search, valid centres", () => {
    const v = validateLocatorRun(syntheticAgentRun(), SAMSUNG);
    expect(v.verification).toBe("VERIFIED");
    expect(v.outcome).toBe("CENTERS_FOUND");
    expect(v.centers.map((c) => c.name)).toEqual(["SYNTHETIC TEST CENTRE A", "SYNTHETIC TEST CENTRE B"]);
    expect(v.checks).toMatchObject({ pinMatches: true, domainApproved: true, searchSubmitted: true, resultsStructurallyValid: true });
    expect(v.checks.resultUrl).toBe("https://www.samsung.com/in/support/service-center/"); // tracking param stripped
  });

  it("2. UNVERIFIED: returned PIN differs (the real 56001 vs 560001 mistake)", () => {
    const v = validateLocatorRun(syntheticAgentRun({ pin_entered: "56001" }), SAMSUNG);
    expect(v.verification).toBe("UNVERIFIED");
    expect(v.outcome).toBe("NOT_VERIFIED");
    expect(v.centers).toEqual([]); // centres from an unverified search are never surfaced
    expect(v.reasons.join()).toMatch(/56001.*560001/);
    expectNoFalseUnavailability(v);
  });

  it("2b. UNVERIFIED: PIN with extra digits or missing entirely", () => {
    expect(validateLocatorRun(syntheticAgentRun({ pin_entered: "5600010" }), SAMSUNG).verification).toBe("UNVERIFIED");
    expect(validateLocatorRun(syntheticAgentRun({ pin_entered: null }), SAMSUNG).verification).toBe("UNVERIFIED");
  });

  it("3. UNVERIFIED: result page on an unapproved domain (incl. look-alikes and linked sites)", () => {
    for (const url of [
      "https://servicecenter.samsungdigitalservicecenter.com/",
      "https://samsung.com.evil.example/locator",
      "https://example.com/samsung.com",
    ]) {
      const v = validateLocatorRun(syntheticAgentRun({ results_page_url: url }), SAMSUNG);
      expect(v.verification, url).toBe("UNVERIFIED");
      expect(v.checks.domainApproved, url).toBe(false);
      expect(v.centers, url).toEqual([]);
    }
  });

  it("4. UNVERIFIED: agent COMPLETED without submitting the search (recorded LG run b4eefea8)", () => {
    const run = RECORDED.lgNotSubmitted();
    expect(run.status).toBe("COMPLETED"); // execution "succeeded"...
    const v = validateLocatorRun(run, LG);
    expect(v.verification).toBe("UNVERIFIED"); // ...but nothing was verified
    expect(v.checks.searchSubmitted).toBe(false);
    expectNoFalseUnavailability(v);
  });

  it("5. Empty result from a verified search is PARTIALLY_VERIFIED, never 'no service'", () => {
    const v = validateLocatorRun(syntheticAgentRun({ service_centers: [] }), SAMSUNG);
    expect(v.verification).toBe("PARTIALLY_VERIFIED");
    expect(v.outcome).toBe("NO_CENTERS_RETURNED");
    expect(v.reasons.join()).toMatch(/does not prove service is unavailable/);
    expectNoFalseUnavailability(v);
  });

  it("6. FAILED: tunnel/proxy connection failure (recorded Samsung run 090e935c)", () => {
    const run = RECORDED.samsungTunnelFailure();
    expect(run.status).toBe("COMPLETED");
    const v = validateLocatorRun(run, SAMSUNG);
    expect(v.verification).toBe("FAILED");
    expect(v.outcome).toBe("EXECUTION_FAILED");
    expect(v.reasons[0]).toMatch(/ERR_TUNNEL_CONNECTION_FAILED/);
    expect(v.checks.returnedPin).toBe("56001"); // the real wrong PIN is preserved as evidence
    expectNoFalseUnavailability(v);
  });

  it("FAILED: provider status FAILED / CANCELLED keeps the error code", () => {
    const v = validateLocatorRun(
      syntheticAgentRun({}, { status: "FAILED", error: { code: "SITE_BLOCKED", message: "blocked", category: "AGENT_FAILURE" } }),
      SAMSUNG,
    );
    expect(v.verification).toBe("FAILED");
    expect(v.reasons[0]).toMatch(/FAILED \(SITE_BLOCKED\)/);
    expect(validateLocatorRun(syntheticAgentRun({}, { status: "CANCELLED" }), SAMSUNG).verification).toBe("FAILED");
  });

  it("FAILED: malformed / missing result object", () => {
    expect(validateLocatorRun(syntheticAgentRun({}, { result: null }), SAMSUNG).verification).toBe("FAILED");
    expect(validateLocatorRun(syntheticAgentRun({}, { result: "a string" }), SAMSUNG).verification).toBe("FAILED");
  });

  it("UNVERIFIED: service_centers not an array", () => {
    const v = validateLocatorRun(syntheticAgentRun({ service_centers: "two centres" }), SAMSUNG);
    expect(v.verification).toBe("UNVERIFIED");
    expect(v.checks.resultsStructurallyValid).toBe(false);
  });

  it("PARTIALLY_VERIFIED: malformed entries are discarded, valid ones kept", () => {
    const v = validateLocatorRun(
      syntheticAgentRun({ service_centers: [{ name: "SYNTHETIC TEST CENTRE A" }, { name: "" }, { address: "no name" }, 42] }),
      SAMSUNG,
    );
    expect(v.verification).toBe("PARTIALLY_VERIFIED");
    expect(v.centers).toHaveLength(1);
    expect(v.discardedCenters).toBe(3);
  });

  it("PARTIALLY_VERIFIED: no result URL reported, so domain is unconfirmed", () => {
    const v = validateLocatorRun(syntheticAgentRun({ results_page_url: null }), SAMSUNG);
    expect(v.verification).toBe("PARTIALLY_VERIFIED");
    expect(v.checks.domainApproved).toBeNull();
  });
});
