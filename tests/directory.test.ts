import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceInvestigation, startInvestigation } from "@/lib/investigation/orchestrator";
import { buildInvestigationView } from "@/lib/investigation/view";
import { ADAPTERS, type DirectoryStrategy } from "@/lib/locator/adapters";
import { dedupeListings, isDirectoryUrl, parseDetailPage, parseDirectoryPage } from "@/lib/locator/directory";
import { parseFetchResponse } from "@/lib/tinyfish/fetch";
import { TinyFishError } from "@/lib/tinyfish/http";
import { RECORDED } from "./fixtures";
import {
  BANGALORE_P1_TEXT,
  BANGALORE_P1_URL,
  BANGALORE_P2_TEXT,
  BANGALORE_P2_URL,
  KARNATAKA_LINKS,
  KING_COOL_DETAIL_TEXT,
  KING_COOL_URL,
  SYNTHETIC_AC_DETAIL_TEXT,
  SYNTHETIC_NO_COORDS_DETAIL_TEXT,
  cityPagesResponse,
  detailPagesResponse,
} from "./fixtures/samsung-directory";
import { createHarness, SAMSUNG_INPUT } from "./helpers/harness";

const STRATEGY = ADAPTERS.find((a) => a.id === "samsung")!.locator as DirectoryStrategy;
const FALSE_UNAVAILABILITY = /NO_SERVICE|no service (is )?available|service is not available|not serviceable|no authori[sz]ed service/i;
const p1 = () => parseDirectoryPage({ url: BANGALORE_P1_URL, text: BANGALORE_P1_TEXT, links: KARNATAKA_LINKS }, STRATEGY);
const p2 = () => parseDirectoryPage({ url: BANGALORE_P2_URL, text: BANGALORE_P2_TEXT, links: [] }, STRATEGY);

describe("directory page parsing (recorded Stage 2.6 pages)", () => {
  it("extracts every listing with name, street, locality, city, PIN, phone and detail link", () => {
    const listings = p1();
    expect(listings).toHaveLength(10);
    expect(listings[0]).toEqual({
      name: "R.P.Services",
      street: "No 1347, Flat No 002, GF, Pavan Heights",
      locality: "Marathahalli",
      city: "Bengaluru",
      pin: "560037",
      pinRaw: "560037",
      phone: "180057000000",
      landmark: null,
      detailUrl: `https://servicecenter.samsungdigitalservicecenter.com/ce/authorised-samsung-ce-service-center-r-p-services-repair-service-marathahalli-bengaluru-388422/Home`,
      sourceUrl: BANGALORE_P1_URL,
    });
    expect(listings.find((l) => l.name === "S N Enterprises")).toMatchObject({ landmark: "Near 28th Main Road", phone: "180057000000", pin: "560076" });
    expect(listings.every((l) => l.detailUrl?.endsWith("/Home"))).toBe(true); // all 10 matched, no /Map links
    expect(listings.find((l) => l.name === "King Cool System")?.detailUrl).toBe(KING_COOL_URL);
  });

  it("filter lists on the page (city/locality names) are not parsed as listings", () => {
    expect(p1().map((l) => l.name)).not.toContain("Bengaluru");
  });

  it("combines multiple city pages and de-duplicates repeated centres", () => {
    const all = dedupeListings([...p1(), ...p2(), ...p1()]);
    expect(all).toHaveLength(13);
    expect(all.find((l) => l.name === "Teamg Solutions Pvt Limited")).toMatchObject({ pin: "560100", landmark: "Opposite to Biocon", phone: "+918088660661", detailUrl: null });
    expect(all.some((l) => l.pin === "560001")).toBe(false); // recorded fact: no centre in the customer's PIN
  });

  it("dedupe keeps a detail link found on a later copy", () => {
    const [first] = p2();
    const withLink = { ...first!, detailUrl: "https://servicecenter.samsungdigitalservicecenter.com/ce/x-1/Home" };
    expect(dedupeListings([first!, withLink])[0]!.detailUrl).toBe(withLink.detailUrl);
  });

  it("malformed PIN values are kept raw and never treated as a PIN", () => {
    const text = BANGALORE_P2_TEXT.replace("560092", "56009").replace("560098", "0560098");
    const [a, b] = parseDirectoryPage({ url: BANGALORE_P2_URL, text, links: [] }, STRATEGY);
    expect(a).toMatchObject({ pin: null, pinRaw: "56009" });
    expect(b).toMatchObject({ pin: null, pinRaw: "0560098" });
  });

  it("ignores detail links that are off-directory or ambiguous", () => {
    const links = ["https://evil.example/ce/authorised-samsung-ce-service-center-d-smart-repair-service-ideal-homes-layout-bengaluru-1/Home"];
    expect(parseDirectoryPage({ url: BANGALORE_P2_URL, text: BANGALORE_P2_TEXT, links }, STRATEGY).every((l) => l.detailUrl === null)).toBe(true);
  });
});

describe("detail page parsing", () => {
  it("recorded King Cool page: coordinates, hours, categories; AC NOT stated", () => {
    const d = parseDetailPage(KING_COOL_DETAIL_TEXT);
    expect(d.coordinates).toEqual({ lat: 12.952704, lng: 77.526093 });
    expect(d.hours).toHaveLength(7);
    expect(d.hours[6]).toBe("Sun Closed");
    expect(d.categories).toMatch(/^Repair Service Appliance Repair Service/);
    expect(d.productsExplicit.sort()).toEqual(["refrigerator", "television", "washing_machine"]);
    expect(d.acServiceExplicit).toBe(false); // the name "King Cool" is not evidence of AC service
  });

  it("detects AC service only when explicitly listed", () => {
    expect(parseDetailPage(SYNTHETIC_AC_DETAIL_TEXT)).toMatchObject({ acServiceExplicit: true, coordinates: { lat: 12.9716, lng: 77.5946 } });
  });

  it("missing coordinates and categories stay null/empty", () => {
    expect(parseDetailPage(SYNTHETIC_NO_COORDS_DETAIL_TEXT)).toEqual({
      coordinates: null,
      hours: ["Mon 10:00 AM - 06:00 PM"],
      categories: null,
      tags: null,
      productsExplicit: [],
      acServiceExplicit: false,
    });
    expect(parseDetailPage("200.1 500.2\n# out of range").coordinates).toBeNull();
  });
});

describe("source-domain validation", () => {
  it("accepts only the directory host, rejecting look-alikes and other Samsung hosts", () => {
    expect(isDirectoryUrl(KING_COOL_URL, STRATEGY)).toBe(true);
    expect(isDirectoryUrl("https://servicecenter.samsungdigitalservicecenter.com.evil.io/ce/x", STRATEGY)).toBe(false);
    expect(isDirectoryUrl("https://samsungdigitalservicecenter.com/", STRATEGY)).toBe(false);
    expect(isDirectoryUrl("not a url", STRATEGY)).toBe(false);
  });
});

describe("directory strategy in the orchestrator", () => {
  afterEach(() => vi.unstubAllEnvs());

  function directoryHarness(over: { city?: () => Promise<ReturnType<typeof cityPagesResponse>>; detail?: (urls: string[]) => Promise<ReturnType<typeof cityPagesResponse>> } = {}) {
    return createHarness({
      fetchPages: async (urls, options) => {
        if (options?.links) return over.city ? over.city() : cityPagesResponse();
        if (urls[0]?.includes("/ce/authorised-")) return over.detail ? over.detail(urls) : detailPagesResponse(urls);
        return parseFetchResponse(RECORDED.samsungFetch()); // fetch_official
      },
    });
  }

  async function runToEnd(h: ReturnType<typeof createHarness>) {
    const { investigation } = await startInvestigation(h.deps, SAMSUNG_INPUT);
    for (let i = 0; i < 6; i++) {
      await advanceInvestigation(h.deps, investigation.id);
      h.advanceClock(10_000);
    }
    const s = h.deps.store;
    const id = investigation.id;
    return buildInvestigationView((await s.getInvestigation(id))!, await s.listRuns(id), await s.listEvidence(id), await s.listFindings(id));
  }

  it("Samsung uses the directory by default: no Agent, at most 2 directory fetches, PARTIALLY_VERIFIED centres", async () => {
    const h = directoryHarness();
    const view = await runToEnd(h);
    expect(h.tinyfish.startRun).not.toHaveBeenCalled();
    const directoryCalls = h.tinyfish.fetchPages.mock.calls.filter(([u, o]) => o?.links || u[0]?.includes("/ce/authorised-"));
    expect(directoryCalls).toHaveLength(2);
    expect(directoryCalls[1]![0]).toHaveLength(10); // detail pages capped at one request

    expect(view.status).toBe("partial"); // directory evidence can never make an investigation "completed"
    expect(view.locator).toMatchObject({ strategy: "static_directory", verification: "PARTIALLY_VERIFIED", outcome: "CENTERS_FOUND" });
    const centers = view.locator!.service_centers as unknown as Record<string, unknown>[];
    expect(centers).toHaveLength(13);
    expect(centers.filter((c) => c.coordinates)).toHaveLength(1); // only the recorded King Cool page has coordinates
    expect(centers.filter((c) => c.ac_service === "explicitly_listed")).toHaveLength(0);
    expect(centers.filter((c) => c.ac_service === "unknown_no_detail_page")).toHaveLength(3);
    expect(centers.every((c) => c.pin_coverage === "not_established" && c.in_customer_pin === false)).toBe(true);
    expect(centers.find((c) => c.name === "King Cool System")).toMatchObject({ coordinates: { lat: 12.952704, lng: 77.526093 }, ac_service: "not_stated" });

    const reasons = view.locator!.reasons.join("\n");
    expect(reasons).toMatch(/not confirmed on samsung\.com/);
    expect(reasons).toMatch(/does not establish service coverage for PIN 560001/);
    expect(reasons).toMatch(/No listed centre is located in PIN 560001; this does not mean the PIN is unserved/);
    expect(reasons).toMatch(/Distances are not calculated/);
    expect(reasons).toMatch(/Home installation eligibility is not covered/);
    expect(JSON.stringify(view)).not.toMatch(FALSE_UNAVAILABILITY);
  });

  it("persists city + detail evidence as manufacturer_linked and links each centre finding to its source", async () => {
    const h = directoryHarness();
    await runToEnd(h);
    const dirEvidence = h.mem.evidence.filter((e) => typeof e.metadata.role === "string" && String(e.metadata.role).startsWith("directory_"));
    expect(dirEvidence.filter((e) => e.metadata.role === "directory_city_page")).toHaveLength(2);
    expect(dirEvidence.filter((e) => e.metadata.role === "directory_detail_page")).toHaveLength(10);
    expect(dirEvidence.every((e) => e.source_type === "manufacturer_linked" && e.retrieval_method === "tinyfish_fetch" && e.retrieved_at)).toBe(true);

    const centreFindings = h.mem.findings.filter((f) => f.finding_type === "service_center");
    expect(centreFindings).toHaveLength(13);
    expect(centreFindings.every((f) => f.verification_status === "PARTIALLY_VERIFIED")).toBe(true);
    expect(centreFindings.every((f) => f.claim.startsWith("Listed as authorised on a Samsung-linked directory:"))).toBe(true);
    const kingCool = centreFindings.find((f) => f.extracted_value.name === "King Cool System")!;
    expect(h.mem.evidence.find((e) => e.id === kingCool.evidence_source_id)?.source_url).toBe(KING_COOL_URL);
    const teamg = centreFindings.find((f) => f.extracted_value.name === "Teamg Solutions Pvt Limited")!;
    expect(h.mem.evidence.find((e) => e.id === teamg.evidence_source_id)?.canonical_url).toBe(BANGALORE_P2_URL);
    expect(h.mem.findings.find((f) => f.finding_type === "locator_result")?.verification_status).toBe("PARTIALLY_VERIFIED");
  });

  it("failed city fetch: run failed, not retried, availability unknown (never 'no service')", async () => {
    const h = directoryHarness({ city: async () => Promise.reject(new TinyFishError("UPSTREAM", "TinyFish HTTP 503", 503)) });
    const view = await runToEnd(h);
    expect(h.tinyfish.fetchPages.mock.calls.filter(([, o]) => o?.links)).toHaveLength(1);
    expect(view.tasks.find((t) => t.operation === "locator_directory")).toMatchObject({ status: "failed", error: "TinyFish service error" });
    expect(h.mem.findings.filter((f) => f.finding_type === "service_center")).toHaveLength(0);
    expect(JSON.stringify(view)).not.toMatch(FALSE_UNAVAILABILITY);
  });

  it("per-URL failure on page 2 keeps page 1 listings and records the failure as evidence", async () => {
    const h = directoryHarness({
      city: async () => ({ results: [cityPagesResponse().results[0]!], errors: [{ url: BANGALORE_P2_URL, error: "timeout", status: null }] }),
    });
    const view = await runToEnd(h);
    expect(view.locator?.service_centers).toHaveLength(10);
    expect(view.locator?.reasons.join()).toMatch(/could not be retrieved: .*page=2 \(timeout\)/);
    expect(h.mem.evidence.some((e) => e.retrieval_status === "failed" && e.canonical_url === BANGALORE_P2_URL)).toBe(true);
  });

  it("failed detail fetch keeps listings, marking categories/coordinates unknown", async () => {
    const h = directoryHarness({ detail: async () => Promise.reject(new TinyFishError("TIMEOUT", "timed out")) });
    const view = await runToEnd(h);
    const centers = view.locator!.service_centers as unknown as Record<string, unknown>[];
    expect(centers).toHaveLength(13);
    expect(centers.every((c) => c.ac_service === "unknown_no_detail_page" && c.coordinates === null)).toBe(true);
    expect(view.locator?.reasons.join()).toMatch(/Detail pages could not be retrieved \(TinyFish request timed out\)/);
  });

  it("PIN outside the mapped city: directory skipped as UNSUPPORTED, no fetch, no claim", async () => {
    const h = directoryHarness();
    const { investigation } = await startInvestigation(h.deps, { ...SAMSUNG_INPUT, pincode: "110001" });
    await advanceInvestigation(h.deps, investigation.id);
    expect(h.tinyfish.fetchPages.mock.calls.filter(([, o]) => o?.links)).toHaveLength(0);
    expect(h.mem.runs.find((r) => r.operation === "locator_directory")).toMatchObject({ status: "skipped", metadata: { locator_outcome: "UNSUPPORTED" } });
  });

  it("Agent fallback is used only when explicitly enabled", async () => {
    vi.stubEnv("FEASISERVE_LOCATOR_FALLBACK", "agent");
    const h = directoryHarness();
    await startInvestigation(h.deps, SAMSUNG_INPUT);
    expect(h.mem.runs.map((r) => r.operation)).toContain("locator_agent");
    expect(h.tinyfish.startRun).toHaveBeenCalledTimes(1);
  });
});
