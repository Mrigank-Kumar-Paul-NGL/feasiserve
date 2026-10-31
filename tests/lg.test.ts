import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { advanceInvestigation, startInvestigation } from "@/lib/investigation/orchestrator";
import { buildInvestigationView } from "@/lib/investigation/view";
import { classifyDomain } from "@/lib/evidence/classify";
import { activeLocator, findAdapter } from "@/lib/locator/adapters";
import { buildReport, rateInstallation, type EvidenceInput } from "@/lib/scoring/engine";
import { TinyFishError } from "@/lib/tinyfish/http";
import { createHarness, SAMSUNG_INPUT } from "./helpers/harness";

// RECORDED: verbatim excerpt of https://www.lg.com/in/support/warranty-terms/ (TinyFish Fetch, 2026-10-31).
const LG_EXCERPT = readFileSync(fileURLToPath(new URL("./fixtures/lg-warranty-terms.excerpt.md", import.meta.url)), "utf8");
const LG_INPUT = { brand: "LG", product_category: "Refrigerator", product_model: null, pincode: "560001" };
const CLAIMS_ABSENCE = /NO_SERVICE|no service (is )?available|service is not available|not serviceable/i;

const lgPage = (content: string): EvidenceInput => ({
  id: "lg1",
  source_url: "https://www.lg.com/in/support/warranty-terms/",
  canonical_url: "https://www.lg.com/in/support/warranty-terms/",
  domain: "lg.com",
  source_type: "official_manufacturer",
  retrieval_method: "tinyfish_fetch",
  retrieval_status: "retrieved",
  retrieved_at: "2026-10-31T10:00:00Z",
  title: "LG Electronics: Consumer Electronics and Appliances from LG - Support & Help | LG India",
  content,
  metadata: {},
});

describe("LG adapter", () => {
  it("is supported, official domain lg.com, India support pages only, and never uses the broken map locator", () => {
    const lg = findAdapter("LG")!;
    expect(findAdapter("lg electronics")?.id).toBe("lg");
    expect(lg.officialDomains).toEqual(["lg.com"]);
    expect(lg.officialPages).toHaveLength(6);
    expect(lg.officialPages!.every((u) => u.startsWith("https://www.lg.com/in/support/"))).toBe(true);
    expect(activeLocator(lg).kind).toBe("unavailable");
  });

  it("Samsung has no fixed official pages", () => {
    expect(findAdapter("Samsung")!.officialPages).toBeUndefined();
  });

  it("only LG India pages count as official; other LG country sites are 'unknown' (live run 8e7280b7 found lg.com/ca_en/)", () => {
    const lg = findAdapter("LG");
    expect(classifyDomain("lg.com", lg, "https://www.lg.com/in/support/warranty-terms/")).toBe("official_manufacturer");
    expect(classifyDomain("lg.com", lg, "https://www.lg.com/ca_en/support/warranty-terms/")).toBe("unknown");
    expect(classifyDomain("lg.com", lg, "https://www.lg.com/us/support/")).toBe("unknown");
  });

  it("Samsung: only India pages are official; US/UK/CA pages are 'unknown'; the linked directory is unaffected (KI-037)", () => {
    const s = findAdapter("Samsung");
    for (const url of [
      "https://www.samsung.com/in/support/warranty/",
      "https://www.samsung.com/in",
      "https://www.samsung.com/in/support/home-appliances/ac-installation-and-repair-service-charges/",
      "https://images.samsung.com/is/content/samsung/assets/in/tnc/ac_warranty_terms_and_conditions.pdf",
    ]) {
      expect(classifyDomain(new URL(url).hostname.replace(/^www\./, ""), s, url), url).toBe("official_manufacturer");
    }
    for (const url of [
      "https://www.samsung.com/us/home-appliances/warranty/refrigerators/",
      "https://www.samsung.com/uk/support/warranty/",
      "https://www.samsung.com/ca/support/warranty/",
      "https://www.samsung.com/india-fake/",
      "https://images.samsung.com/is/content/samsung/assets/us/tnc/x.pdf",
    ]) {
      expect(classifyDomain(new URL(url).hostname.replace(/^www\./, ""), s, url), url).toBe("unknown");
    }
    expect(classifyDomain("servicecenter.samsungdigitalservicecenter.com", s, "https://servicecenter.samsungdigitalservicecenter.com/ce/location/karnataka/bangalore")).toBe(
      "manufacturer_linked",
    );
  });

  it("report re-checks stored 'official' rows: a stored US page no longer earns official warranty credit", () => {
    const us = {
      id: "u1",
      investigation_id: "i",
      source_url: "https://www.samsung.com/us/home-appliances/warranty/refrigerators/",
      canonical_url: "https://www.samsung.com/us/home-appliances/warranty/refrigerators/",
      domain: "samsung.com",
      source_type: "official_manufacturer" as const,
      retrieval_method: "tinyfish_fetch" as const,
      retrieval_status: "retrieved" as const,
      retrieved_at: "2026-10-31T09:45:00Z",
      published_at: null,
      title: "Refrigerator warranty",
      content: "Most Samsung refrigerators include a standard 1-year manufacturer's warranty",
      metadata: {},
      created_at: "2026-10-31T09:45:00Z",
    };
    const inv = { id: "i", brand: "Samsung", product_category: "Refrigerator", product_model: null, pincode: "560001", status: "partial" as const, created_at: "", updated_at: "", completed_at: null, error_summary: null };
    const v = buildInvestigationView(inv, [], [us], []);
    expect(v.report.ratings.installation.score).toBeNull();
    expect(v.evidence[0]!.source_type).toBe("unknown");
  });
});

describe("LG investigation pipeline", () => {
  it("fetches LG's official pages fresh, skips the locator, and spends no Agent run", async () => {
    const h = createHarness();
    const { investigation } = await startInvestigation(h.deps, LG_INPUT);
    for (let i = 0; i < 4; i++) {
      await advanceInvestigation(h.deps, investigation.id);
      h.advanceClock(10_000);
    }
    expect(h.tinyfish.startRun).not.toHaveBeenCalled();
    const [urls] = h.tinyfish.fetchPages.mock.calls[0]!;
    expect(urls.slice(0, 6)).toEqual(findAdapter("LG")!.officialPages);
    expect(urls.length).toBeLessThanOrEqual(10);
    expect(h.mem.runs.find((r) => r.operation === "locator_agent")).toMatchObject({ status: "skipped", metadata: { locator_outcome: "LOCATOR_UNAVAILABLE" } });
    // every stored fetch row keeps provenance
    const fetched = h.mem.evidence.filter((e) => e.retrieval_method === "tinyfish_fetch");
    expect(fetched.every((e) => e.source_url && e.canonical_url && e.retrieved_at)).toBe(true);
  });

  it("still fetches LG's official pages when the official search fails", async () => {
    const h = createHarness({
      search: async () => {
        throw new TinyFishError("MALFORMED_RESPONSE", "bad");
      },
    });
    const { investigation } = await startInvestigation(h.deps, LG_INPUT);
    await advanceInvestigation(h.deps, investigation.id);
    expect(h.tinyfish.fetchPages).toHaveBeenCalledTimes(1);
    expect(h.tinyfish.fetchPages.mock.calls[0]![0]).toEqual(findAdapter("LG")!.officialPages);
  });

  it("Samsung's official fetch still uses only the top 3 search results", async () => {
    const h = createHarness();
    const { investigation } = await startInvestigation(h.deps, { ...SAMSUNG_INPUT, product_category: "Refrigerator" });
    for (let i = 0; i < 4; i++) await advanceInvestigation(h.deps, investigation.id);
    // directory calls are the links:true city fetch and the /ce/ detail fetch; the remaining call is the official fetch
    const officialCall = h.tinyfish.fetchPages.mock.calls.find(([u, o]) => !o?.links && !u[0]!.includes("/ce/"));
    expect(officialCall).toBeDefined();
    expect(officialCall![0]).toHaveLength(3);
    // unchanged rule: top 3 official-or-linked search results; no LG pages leak in
    expect(officialCall![0].every((u) => /samsung\.com|samsungdigitalservicecenter\.com/.test(u))).toBe(true);
    expect(officialCall![0].some((u) => u.includes("lg.com"))).toBe(false);
  });
});

describe("warranty durations organised by product section (LG page structure)", () => {
  it("credits durations under the product's own heading in the recorded LG excerpt", () => {
    for (const key of ["refrigerator", "air_conditioner"] as const) {
      const r = rateInstallation(buildReportInput(), key);
      expect(r.criteria.map((c) => c.met), key).toEqual([true, true, false]); // no LG installation page among inputs
      expect(r.score, key).toBe(70);
      expect(r.evidence.some((e) => e.quote && /warranty/i.test(e.quote)), key).toBe(true);
    }
  });

  it("a section ends at the next non-product heading, so durations never leak to another product", () => {
    const content = ["**Television**", "1 year warranty on panel", "**Commercial products**", "3 years warranty on signage displays"].join("\n");
    const r = rateInstallation({ ...buildReportInput(), evidence: [lgPage(content)] }, "television");
    const quotes = r.evidence.map((e) => e.quote).filter(Boolean);
    expect(quotes).toEqual(["1 year warranty on panel"]);
  });

  it("'Purchase After …' sub-headings stay inside the product section", () => {
    const content = ["**Refrigerators**", "**Purchase After 1st August 2024**", "1. 9 year warranty on inverter compressor"].join("\n");
    const r = rateInstallation({ ...buildReportInput(), evidence: [lgPage(content)] }, "refrigerator");
    expect(r.criteria[1]!.met).toBe(true);
  });

  it("a duration under a different product's heading is not credited", () => {
    // the page covers refrigerators (so it is relevant) but the only duration sits under Washing machine
    const content = ["**Refrigerators**", "Type", "Direct cool", "**Washing machine**", "2 years warranty is applicable on all parts"].join("\n");
    expect(rateInstallation({ ...buildReportInput(), evidence: [lgPage(content)] }, "refrigerator").criteria[1]!.met).toBe(false);
  });
});

describe("LG report without service-centre listings", () => {
  it("availability is N/A (not zero), the score is withheld, and no PIN coverage is claimed", () => {
    const r = buildReport(buildReportInput());
    expect(r.ratings.availability.score).toBeNull();
    expect(r.ratings.installation.score).toBe(70);
    expect(r.overall.state).toBe("insufficient");
    expect(r.unresolved).toContain("Does any authorised centre cover PIN 560001 for refrigerators?");
    expect(JSON.stringify(r)).not.toMatch(CLAIMS_ABSENCE);
  });

  it("the investigation view explains the skipped locator", async () => {
    const h = createHarness();
    const { investigation } = await startInvestigation(h.deps, LG_INPUT);
    await advanceInvestigation(h.deps, investigation.id);
    const s = h.deps.store;
    const v = buildInvestigationView((await s.getInvestigation(investigation.id))!, await s.listRuns(investigation.id), [], []);
    expect(v.locator).toMatchObject({ status: "skipped", outcome: "LOCATOR_UNAVAILABLE" });
    expect(v.locator?.reasons[0]).toMatch(/did not render a PIN search input/);
  });
});

function buildReportInput() {
  return {
    brand: "LG",
    category: "Refrigerator",
    pincode: "560001",
    evidence: [lgPage(LG_EXCERPT)],
    locator: { strategy: "tinyfish_agent" as const, status: "skipped", verification: null, outcome: "LOCATOR_UNAVAILABLE", centres: [] },
  };
}
