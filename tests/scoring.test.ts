import { describe, expect, it } from "vitest";
import {
  DIRECTORY_AVAILABILITY_CAP,
  WEIGHTS,
  buildReport,
  categoryKey,
  combine,
  rateAvailability,
  rateInstallation,
  type CentreInput,
  type EvidenceInput,
  type ScoringInput,
} from "@/lib/scoring/engine";

// RECORDED excerpts: lines copied from official pages persisted in investigation 25f330e8 (2026-10-31).
const AC_WARRANTY_PDF: EvidenceInput = {
  id: "e1",
  source_url: "https://images.samsung.com/is/content/samsung/assets/in/tnc/ac_warranty_terms_and_conditions.pdf",
  canonical_url: "https://images.samsung.com/is/content/samsung/assets/in/tnc/ac_warranty_terms_and_conditions.pdf",
  domain: "images.samsung.com",
  source_type: "official_manufacturer",
  retrieval_method: "tinyfish_fetch",
  retrieval_status: "retrieved",
  retrieved_at: "2026-10-31T08:43:35Z",
  title: null,
  content: "an extended warranty of 4 years on Gas Charging (on Condenser & Compressor failure), and PCB\nwarranty completion under the 10 year compressor warranty period.",
  metadata: {},
};
const AC_INSTALL_PAGE: EvidenceInput = {
  ...AC_WARRANTY_PDF,
  id: "e2",
  source_url: "https://www.samsung.com/in/support/home-appliances/ac-installation-and-repair-service-charges/",
  canonical_url: "https://www.samsung.com/in/support/home-appliances/ac-installation-and-repair-service-charges/",
  domain: "samsung.com",
  title: "AC installation & service charges",
  content: "AC installation & service charges. Contact 1800 5 7267864.",
};
const GENERAL_WARRANTY: EvidenceInput = {
  ...AC_WARRANTY_PDF,
  id: "e3",
  source_url: "https://www.samsung.com/in/support/warranty/",
  canonical_url: "https://www.samsung.com/in/support/warranty/",
  domain: "samsung.com",
  title: "Samsung Product Warranty Information | Samsung Support India",
  content:
    "Discover the 3 Year Warranty (1 Year Standard Warranty + 2 Year additional Complete Warranty on selected TV Models) with an\nRefrigerator\nWashing Machine",
};
const community = (i: number, text: string): EvidenceInput => ({
  ...AC_WARRANTY_PDF,
  id: `c${i}`,
  source_url: `https://www.reddit.com/r/test/${i}`,
  canonical_url: `https://www.reddit.com/r/test/${i}`,
  domain: "reddit.com",
  source_type: "community",
  retrieval_method: "tinyfish_search",
  title: `post ${i}`,
  content: text,
});

// RECORDED: product lists as extracted in live directory run ff372b3b (10 detail pages: fridge/washer/TV; 3 without details).
const centre = (i: number, products: string[] | null): CentreInput => ({
  name: `Centre ${i}`,
  address: `Address ${i}, Bengaluru - 5600${40 + i}`,
  pin: `5600${40 + i}`,
  coordinates: i % 2 ? { lat: 12.9, lng: 77.6 } : null,
  products_explicit: products,
  detail_url: products ? `https://servicecenter.samsungdigitalservicecenter.com/ce/c-${i}/Home` : null,
  source_url: "https://servicecenter.samsungdigitalservicecenter.com/ce/location/karnataka/bangalore",
  retrieved_at: "2026-10-31T09:04:40Z",
});
const BENGALURU = [
  ...Array.from({ length: 10 }, (_, i) => centre(i, ["refrigerator", "washing_machine", "television"])),
  ...Array.from({ length: 3 }, (_, i) => centre(10 + i, null)),
];
const DIRECTORY = { strategy: "static_directory" as const, status: "succeeded", verification: "PARTIALLY_VERIFIED" as const, outcome: "CENTERS_FOUND", centres: BENGALURU, city: "Bengaluru" };

const input = (over: Partial<ScoringInput> = {}): ScoringInput => ({
  brand: "Samsung",
  category: "Refrigerator",
  pincode: "560001",
  evidence: [GENERAL_WARRANTY, AC_WARRANTY_PDF, AC_INSTALL_PAGE, community(1, "Samsung AC opinion: good or bad")],
  locator: DIRECTORY,
  ...over,
});
const CLAIMS_ABSENCE = /NO_SERVICE|no service (is )?available|service is not available|not serviceable/i;

describe("weights and combination", () => {
  it("weights are the agreed 20/15/35/30 and sum to 1", () => {
    expect(WEIGHTS).toEqual({ distance: 0.2, experience: 0.15, availability: 0.35, installation: 0.3 });
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("renormalises over supported ratings only: (0.35*70 + 0.30*100) / 0.65 = 84", () => {
    const r = buildReport(input({ category: "Refrigerator", evidence: [GENERAL_WARRANTY, AC_INSTALL_PAGE] }));
    // fridge: warranty page covers it (40) but no fridge duration line and no fridge install page -> 40
    expect(r.ratings.installation.score).toBe(40);
    expect(r.ratings.availability.score).toBe(70);
    expect(r.overall).toEqual({ state: "scored", score: Math.round((0.35 * 70 + 0.3 * 40) / 0.65), supportedWeight: 0.65 });
    const all = combine({ ...r.ratings, installation: { ...r.ratings.installation, score: 100 } });
    expect(all.overall).toMatchObject({ state: "scored", score: 84 });
  });

  it("confidence is separate from the score: PARTIALLY (0.5) + VERIFIED (1) weighted -> Moderate", () => {
    const r = buildReport(input({ evidence: [GENERAL_WARRANTY] }));
    expect(r.confidence.level).toBe("Moderate");
    expect(r.confidence.value).toBeCloseTo((0.35 * 0.5 + 0.3 * 1) / 0.65, 2);
    expect(r.coverage).toEqual({ supportedWeight: 0.65, scoredRatings: 2 });
  });

  it("missing evidence is N/A, never zero, and gives 'insufficient' with no confidence", () => {
    const r = buildReport(input({ evidence: [], locator: null }));
    for (const rating of Object.values(r.ratings)) expect(rating.score).toBeNull();
    expect(r.overall).toMatchObject({ state: "insufficient", supportedWeight: 0 });
    expect(r.confidence.level).toBe("None");
  });

  it("one rating alone (30% weight) is insufficient for an overall score", () => {
    const r = buildReport(input({ category: "Split Air Conditioner" }));
    expect(r.ratings.installation.score).toBe(100);
    expect(r.ratings.availability.score).toBeNull();
    expect(r.overall.state).toBe("insufficient");
    if (r.overall.state === "insufficient") expect(r.overall.reason).toMatch(/Only installation & warranty could be rated \(30% of the weight\)/);
  });

  it("is deterministic", () => {
    expect(buildReport(input())).toEqual(buildReport(input()));
  });
});

describe("service availability rules", () => {
  it("never infers AC servicing from other product categories", () => {
    const r = rateAvailability(input({ category: "Split AC" }), categoryKey("Split AC"));
    expect(r.score).toBeNull();
    expect(r.summary).toBe("Not rated: 13 centre(s) are listed in Bengaluru, but none explicitly lists air conditioner service.");
    expect(r.limitations.join()).toMatch(/Not stated is not the same as not offered/);
  });

  it("explicit refrigerator listings score, capped because the directory is city-level and self-declared", () => {
    const r = rateAvailability(input(), "refrigerator");
    expect(r).toMatchObject({ score: DIRECTORY_AVAILABILITY_CAP, verification: "PARTIALLY_VERIFIED" });
    expect(r.evidence).toHaveLength(10);
    expect(r.evidence.every((e) => e.verification === "PARTIALLY_VERIFIED" && e.source_type === "manufacturer_linked")).toBe(true);
    const many = rateAvailability(input({ locator: { ...DIRECTORY, centres: Array.from({ length: 30 }, (_, i) => centre(i, ["refrigerator"])) } }), "refrigerator");
    expect(many.score).toBe(DIRECTORY_AVAILABILITY_CAP);
    const one = rateAvailability(input({ locator: { ...DIRECTORY, centres: [centre(1, ["refrigerator"])] } }), "refrigerator");
    expect(one.score).toBe(50);
  });

  it("a city listing is never PIN-level coverage, and a missing PIN is never 'no service'", () => {
    const r = buildReport(input());
    expect(r.ratings.availability.limitations).toContain("A Bengaluru listing does not establish service coverage for PIN 560001.");
    expect(r.ratings.availability.limitations).toContain("No listed centre is in PIN 560001; that does not mean the PIN is unserved.");
    expect(r.promiseVsReality.gaps.join()).toMatch(/coverage of PIN 560001 is not confirmed/);
    expect(JSON.stringify(r)).not.toMatch(CLAIMS_ABSENCE);
  });

  it("directory authorisation is never VERIFIED", () => {
    expect(rateAvailability(input({ locator: { ...DIRECTORY, verification: "VERIFIED" } }), "refrigerator").verification).toBe("PARTIALLY_VERIFIED");
  });

  it("official locator: VERIFIED centres score; anything else is N/A", () => {
    const agent = { strategy: "tinyfish_agent" as const, status: "succeeded", outcome: "CENTERS_FOUND", centres: [centre(1, null)] };
    expect(rateAvailability(input({ locator: { ...agent, verification: "VERIFIED" } }), "refrigerator")).toMatchObject({ score: 90, verification: "VERIFIED" });
    expect(rateAvailability(input({ locator: { ...agent, verification: "UNVERIFIED", outcome: "NOT_VERIFIED" } }), "refrigerator").score).toBeNull();
    expect(rateAvailability(input({ locator: { ...DIRECTORY, status: "failed" } }), "refrigerator").score).toBeNull();
  });

  it("unrecognised category is N/A", () => {
    expect(rateAvailability(input({ category: "Garden hose" }), categoryKey("Garden hose")).score).toBeNull();
  });
});

describe("installation & warranty rules", () => {
  it("AC: warranty terms + explicit duration + installation page = 100, with quotes from official text", () => {
    const r = rateInstallation(input({ category: "Split AC" }), "air_conditioner");
    expect(r.score).toBe(100);
    expect(r.verification).toBe("VERIFIED");
    expect(r.evidence.map((e) => e.quote).filter(Boolean).join(" ")).toMatch(/10 year compressor warranty/);
  });

  it("a duration on a TV line does not count for refrigerators", () => {
    const r = rateInstallation(input({ evidence: [GENERAL_WARRANTY] }), "refrigerator");
    expect(r.criteria.map((c) => c.met)).toEqual([true, false, false]);
    expect(r.score).toBe(40);
  });

  it("is separate from availability: rated even when no centre is known, and never claims address eligibility", () => {
    const r = buildReport(input({ category: "Split AC", locator: null }));
    expect(r.ratings.installation.score).toBe(100);
    expect(r.ratings.availability.score).toBeNull();
    expect(r.ratings.installation.limitations).toContain("Installation eligibility for an address in PIN 560001 is not established.");
  });

  it("no official pages -> N/A", () => {
    expect(rateInstallation(input({ evidence: [community(1, "x")] }), "refrigerator").score).toBeNull();
  });
});

describe("distance and customer experience", () => {
  it("distance is N/A without customer coordinates, even when centres have them", () => {
    const r = buildReport(input());
    expect(r.ratings.distance.score).toBeNull();
    expect(r.ratings.distance.limitations.join()).toMatch(/6 listed centre\(s\) have coordinates/);
  });

  it("fewer than 5 community sources: no consensus claimed", () => {
    const r = buildReport(input());
    expect(r.ratings.experience.score).toBeNull();
    expect(r.community.assessment).toMatch(/1 public post\(s\) found. That is not enough/);
  });

  it("5+ sources with clear tone: deterministic tally", () => {
    const ev = [
      community(1, "quick and resolved"),
      community(2, "technician was helpful and on time"),
      community(3, "worst service, waiting two weeks"),
      community(4, "excellent, fixed same day"),
      community(5, "satisfied with repair"),
      community(6, "no clear tone here"),
    ];
    const r = buildReport(input({ evidence: ev }));
    expect(r.ratings.experience).toMatchObject({ score: 80, verification: "UNVERIFIED" });
  });

  it("5+ sources without clear tone: N/A, and the reason says so (not 'too few posts')", () => {
    const ev = [1, 2, 3, 4, 5].map((i) => community(i, i === 1 ? "repeated delays, unresolved" : "neutral text"));
    const r = buildReport(input({ evidence: [GENERAL_WARRANTY, ...ev] })); // an official promise exists to compare against
    expect(r.ratings.experience.score).toBeNull();
    expect(r.community.assessment).toBe("Not rated: too few sources state a clear experience either way.");
    expect(r.ratings.experience.limitations).toContain("1 of 5 sources express a clear tone.");
    // the promise-vs-reality gap must also say why customers could not be compared
    expect(r.promiseVsReality.gaps).toContain("Customer reports retrieved do not state a clear enough experience to test the official promise.");
  });
});

// Stage 3 audit regressions. Each case uses 5 distinct sources so the threshold is met and only tone decides.
describe("customer experience tone (audit regressions)", () => {
  const five = (text: string) => [1, 2, 3, 4, 5].map((i) => community(i, text));
  const experience = (ev: EvidenceInput[]) => buildReport(input({ evidence: ev })).ratings.experience;

  it("'not resolved' is negative, not cancelled out by the word 'resolved'", () => {
    expect(experience(five("issue not resolved after three visits"))).toMatchObject({ score: 0 });
  });

  it("negated positives count as negative", () => {
    expect(experience(five("the technician was not helpful"))).toMatchObject({ score: 0 });
    expect(experience(five("it never got fixed"))).toMatchObject({ score: 0 });
    expect(experience(five("service was not very satisfactory"))).toMatchObject({ score: 0 });
  });

  it("negated negatives are not counted as complaints", () => {
    expect(experience(five("no complaints, excellent service"))).toMatchObject({ score: 100 });
  });

  it("ambiguous words are neutral: 'quick question', 'fixed price', 'no waiting'", () => {
    const r = experience(five("quick question: is the fixed price installation worth it? no waiting at the store"));
    expect(r.score).toBeNull();
    expect(r.limitations).toContain("0 of 5 sources express a clear tone.");
  });

  it("plural and -ing forms are recognised", () => {
    expect(experience(five("so many complaints about this centre"))).toMatchObject({ score: 0 });
    expect(experience(five("they keep delaying the visit"))).toMatchObject({ score: 0 });
  });

  it("a source with equal positive and negative signals is neutral", () => {
    expect(experience(five("helpful staff but a rude manager")).score).toBeNull(); // 1 positive, 1 negative
    expect(experience(five("helpful staff but the worst delays")).score).toBe(0); // 1 positive, 2 negative -> negative
  });

  it("neutral sources neither raise nor lower the score", () => {
    const positives = five("excellent service");
    const withNeutral = [...positives, ...[6, 7, 8, 9].map((i) => community(i, "posted a photo of my new fridge"))];
    const a = experience(positives);
    const b = experience(withNeutral);
    expect(b.score).toBe(a.score);
    expect(b.summary).toBe("5 source(s) describe service positively and 0 negatively (keyword tally of public posts).");
  });

  it("the same source repeated is counted once", () => {
    const dup = [1, 2, 3, 4, 5].map((n) => ({ ...community(1, "excellent service"), id: `dup${n}` }));
    const r = buildReport(input({ evidence: dup }));
    expect(r.ratings.experience.score).toBeNull();
    expect(r.ratings.experience.evidence).toHaveLength(1);
    expect(r.community.assessment).toMatch(/^1 public post\(s\) found/);
  });

  it("a count of sources alone never becomes a score", () => {
    const r = experience([1, 2, 3, 4, 5, 6, 7].map((i) => community(i, "Samsung refrigerator thread")));
    expect(r.score).toBeNull();
  });
});

describe("report sections", () => {
  it("Split AC: promise vs reality names the gap, recommendations and unresolved questions are concrete", () => {
    const r = buildReport(input({ category: "Split AC" }));
    expect(r.promiseVsReality.gaps).toContain("Samsung publishes air conditioner installation terms, but no listed centre explicitly names air conditioner service.");
    expect(r.promiseVsReality.reality).toContain("0 of them explicitly name air conditioner service.");
    expect(r.recommendations[0]).toBe("Before buying, ask Samsung which authorised centre services air conditioners for PIN 560001.");
    expect(r.recommendations.join()).toMatch(/helpline 1800 5 7267864 appears on samsung\.com/);
    expect(r.unresolved).toContain("Which listed centres handle air conditioners at all?");
  });

  it("helpline is only quoted from an official source", () => {
    const r = buildReport(input({ evidence: [community(1, "call 1800 5 7267864")] }));
    expect(r.recommendations.join()).not.toMatch(/helpline/);
  });
});
