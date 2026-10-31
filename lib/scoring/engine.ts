// FeasiServe deterministic scoring. Pure functions: same evidence in, same report out.
// S = 0.20D + 0.15R + 0.35A + 0.30I, renormalised over the ratings that have evidence.
// A rating without enough evidence is N/A (null), never zero.
import type { EvidenceRow, SourceType, VerificationStatus } from "@/lib/supabase/types";

export const WEIGHTS = { distance: 0.2, experience: 0.15, availability: 0.35, installation: 0.3 } as const;
export type RatingKey = keyof typeof WEIGHTS;

/** Overall score is shown only if the scored ratings carry at least this much weight and there are two of them. */
export const MIN_SUPPORTED_WEIGHT = 0.5;
export const MIN_SCORED_RATINGS = 2;
/** Fewer community sources than this is anecdote, not experience. */
export const MIN_COMMUNITY_SOURCES = 5;
/** Directory listings can never score above this: authorisation is self-declared and coverage is city-level. */
export const DIRECTORY_AVAILABILITY_CAP = 70;

export type EvidenceInput = Pick<
  EvidenceRow,
  "id" | "source_url" | "canonical_url" | "domain" | "source_type" | "retrieval_method" | "retrieval_status" | "retrieved_at" | "title" | "content" | "metadata"
>;

export interface CentreInput {
  name: string;
  address: string;
  locality?: string | null;
  pin: string | null;
  coordinates: { lat: number; lng: number } | null;
  /** Products named on the centre's page; null = details not retrieved. */
  products_explicit?: string[] | null;
  source_url?: string;
  detail_url?: string | null;
  retrieved_at?: string;
}

export interface LocatorInput {
  strategy: "static_directory" | "tinyfish_agent";
  status: string;
  verification: VerificationStatus | null;
  outcome: string | null;
  centres: CentreInput[];
  city?: string | null;
}

export interface ScoringInput {
  brand: string;
  category: string;
  pincode: string;
  evidence: EvidenceInput[];
  locator: LocatorInput | null;
}

export interface EvidenceRef {
  url: string;
  title: string | null;
  retrieved_at: string;
  source_type: SourceType;
  verification: VerificationStatus;
  quote?: string;
}

export interface Criterion {
  label: string;
  met: boolean;
  points: number;
}

export interface Rating {
  key: RatingKey;
  label: string;
  weight: number;
  score: number | null;
  verification: VerificationStatus | null;
  summary: string;
  criteria: Criterion[];
  evidence: EvidenceRef[];
  limitations: string[];
}

export type Overall =
  | { state: "scored"; score: number; supportedWeight: number }
  | { state: "insufficient"; reason: string; supportedWeight: number };

export interface Report {
  category: { input: string; key: ProductKey | null; label: string };
  ratings: Record<RatingKey, Rating>;
  overall: Overall;
  coverage: { supportedWeight: number; scoredRatings: number };
  confidence: { level: "High" | "Moderate" | "Low" | "None"; value: number | null; basis: string };
  promiseVsReality: { promises: EvidenceRef[]; reality: string[]; customer: EvidenceRef[]; gaps: string[] };
  community: { sources: EvidenceRef[]; assessment: string };
  recommendations: string[];
  unresolved: string[];
}

// ---------------------------------------------------------------------------------------------

export type ProductKey = "air_conditioner" | "refrigerator" | "washing_machine" | "television" | "microwave";

const CATEGORY_INPUT: Record<ProductKey, RegExp> = {
  air_conditioner: /\b(ac|a\.c\.|air[\s-]?conditioners?|split|window ac|inverter ac)\b/i,
  refrigerator: /\b(refrigerators?|fridge|freezer)\b/i,
  washing_machine: /\b(washing machines?|washer|dryer)\b/i,
  television: /\b(tv|television|led|oled|qled)\b/i,
  microwave: /\bmicrowaves?\b/i,
};
/** Words that mark a page or a line as being about the category (stricter than the input matcher). */
const CATEGORY_TEXT: Record<ProductKey, RegExp> = {
  air_conditioner: /\b(air[\s-]?conditioners?|\bac\b|split ac|window ac)\b|ac[-_ ](warranty|installation)/i,
  refrigerator: /\b(refrigerators?|fridge)\b/i,
  washing_machine: /\b(washing machines?|washer)\b/i,
  television: /\b(tv|television)\b/i,
  microwave: /\bmicrowaves?\b/i,
};
const PRODUCT_LABEL: Record<ProductKey, string> = {
  air_conditioner: "air conditioner",
  refrigerator: "refrigerator",
  washing_machine: "washing machine",
  television: "television",
  microwave: "microwave",
};

export function categoryKey(category: string): ProductKey | null {
  for (const [key, re] of Object.entries(CATEGORY_INPUT) as [ProductKey, RegExp][]) if (re.test(category)) return key;
  return null;
}

const VERIFICATION_VALUE: Record<VerificationStatus, number> = { VERIFIED: 1, PARTIALLY_VERIFIED: 0.5, UNVERIFIED: 0, FAILED: 0 };
const YEARS = /\b(\d{1,2}|one|two|three|four|five|ten)[\s-]*(\+\s*\d+\s*)?years?\b/i;
const HELPLINE = /1800[\s-]*5[\s-]*7267864|1800[\s-]*5726[\s-]*7864/;

function ref(e: EvidenceInput, verification: VerificationStatus, quote?: string): EvidenceRef {
  return { url: e.canonical_url, title: e.title, retrieved_at: e.retrieved_at, source_type: e.source_type, verification, ...(quote ? { quote } : {}) };
}

const officialPages = (ev: EvidenceInput[]) =>
  ev.filter((e) => e.source_type === "official_manufacturer" && e.retrieval_method === "tinyfish_fetch" && e.retrieval_status === "retrieved" && e.content);

const HEADING = /^(#{1,6}\s+.+|\*\*[^*]+\*\*)$/;
const SUBHEADING = /^\*\*\s*purchase\b/i; // e.g. "**Purchase After 1st August 2024**" stays inside its product section

function headingCategory(line: string): ProductKey | null {
  for (const [k, re] of Object.entries(CATEGORY_TEXT) as [ProductKey, RegExp][]) if (re.test(line)) return k;
  return null;
}

/**
 * Lines of official text that state a warranty duration for the category: the line names the category, the page is
 * about the category, or the line sits under a heading for the category (LG's warranty page is organised by product).
 */
function warrantyDurationQuotes(page: EvidenceInput, key: ProductKey): string[] {
  const aboutCategory = CATEGORY_TEXT[key].test(`${page.canonical_url} ${page.title ?? ""}`);
  const quotes: string[] = [];
  let section: ProductKey | null = null;
  for (const raw of (page.content ?? "").split("\n")) {
    const l = raw.trim();
    if (HEADING.test(l)) {
      if (!SUBHEADING.test(l)) section = headingCategory(l); // any other heading ends the section
      continue;
    }
    if (YEARS.test(l) && /warrant/i.test(l) && (aboutCategory || section === key || CATEGORY_TEXT[key].test(l))) {
      quotes.push(l.length > 220 ? `${l.slice(0, 217)}...` : l);
      if (quotes.length === 3) break;
    }
  }
  return quotes;
}

// ---------------------------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------------------------

function na(key: RatingKey, label: string, summary: string, limitations: string[], evidence: EvidenceRef[] = []): Rating {
  return { key, label, weight: WEIGHTS[key], score: null, verification: null, summary, criteria: [], evidence, limitations };
}

export function rateDistance(input: ScoringInput): Rating {
  const withCoords = input.locator?.centres.filter((c) => c.coordinates).length ?? 0;
  // shortcut: no PIN geocoding source exists yet (KI-026), so distance is always N/A
  return na("distance", "Distance", "Not rated: the customer's PIN has no coordinates, so no distance can be measured.", [
    `No coordinates are available for PIN ${input.pincode}.`,
    withCoords ? `${withCoords} listed centre(s) have coordinates, but distance needs both ends.` : "No listed centre has coordinates.",
  ]);
}

// Phrases, not single words, where a word alone is ambiguous ("quick question", "fixed price", "no waiting").
const NEG_TONE =
  /\b(delay(s|ed|ing)?|worst|pathetic|poor|not resolved|unresolved|no response|(still )?waiting (for|since)|complain(t|ts|ed|ing)?|refused|rude|overcharg\w*)\b/gi;
const POS_TONE =
  /\b(quick(ly)? (service|response|repair|fix(ed)?)|prompt (service|response|repair)|resolved|satisf(ied|actory)|excellent|good service|helpful|on time|(got|was|been|were) fixed)\b/gi;
/** A negator in the 1-2 words before a match flips or cancels it ("not helpful", "never got fixed", "no complaints"). */
const NEGATED = /\b(not|never|no|hardly|isn't|wasn't|weren't|didn't|don't|doesn't)\s+(\w+\s+)?$/i;

export type Tone = "positive" | "negative" | "neutral";

/** Dominant tone of one source. Negative phrases are removed before positives are read, so "not resolved" counts once. */
export function toneOf(text: string): Tone {
  let pos = 0;
  let neg = 0;
  for (const m of text.matchAll(NEG_TONE)) {
    if (!NEGATED.test(text.slice(Math.max(0, m.index - 25), m.index))) neg++; // "no complaints" is not a complaint
  }
  const rest = text.replace(NEG_TONE, " ");
  for (const m of rest.matchAll(POS_TONE)) {
    if (NEGATED.test(rest.slice(Math.max(0, m.index - 25), m.index))) neg++;
    else pos++;
  }
  return pos > neg ? "positive" : neg > pos ? "negative" : "neutral";
}

export function rateExperience(input: ScoringInput): Rating {
  // one source per canonical URL, however many times it was retrieved
  const seen = new Set<string>();
  const community = input.evidence.filter(
    (e) => e.source_type === "community" && e.retrieval_status === "retrieved" && !seen.has(e.canonical_url) && seen.add(e.canonical_url),
  );
  const refs = community.map((e) => ref(e, "UNVERIFIED", e.content?.slice(0, 200) ?? undefined));
  if (community.length < MIN_COMMUNITY_SOURCES) {
    return na(
      "experience",
      "Customer experience",
      `Not rated: ${community.length} public customer source(s) found; at least ${MIN_COMMUNITY_SOURCES} are needed before describing a pattern.`,
      ["Customer posts are individual accounts and are not verified.", `Only ${community.length} source(s) retrieved.`],
      refs,
    );
  }
  // Deterministic keyword tally over snippets. Each source counts once, by its dominant tone; neutral sources count for nothing.
  let pos = 0;
  let neg = 0;
  for (const e of community) {
    const tone = toneOf(`${e.title ?? ""} ${e.content ?? ""}`);
    if (tone === "positive") pos++;
    else if (tone === "negative") neg++;
  }
  if (pos + neg < MIN_COMMUNITY_SOURCES) {
    return na("experience", "Customer experience", "Not rated: too few sources state a clear experience either way.", [`${pos + neg} of ${community.length} sources express a clear tone.`], refs);
  }
  return {
    key: "experience",
    label: "Customer experience",
    weight: WEIGHTS.experience,
    score: Math.round((100 * pos) / (pos + neg)),
    verification: "UNVERIFIED",
    summary: `${pos} source(s) describe service positively and ${neg} negatively (keyword tally of public posts).`,
    criteria: [
      { label: "Positive accounts", met: pos > 0, points: pos },
      { label: "Negative accounts", met: neg > 0, points: neg },
    ],
    evidence: refs,
    limitations: ["Keyword tally of public snippets; individual accounts are not verified."],
  };
}

export function rateAvailability(input: ScoringInput, key: ProductKey | null): Rating {
  const loc = input.locator;
  const label = "Service availability";
  if (!loc || loc.status !== "succeeded") {
    return na("availability", label, "Not rated: no service-centre evidence was retrieved.", ["The service-centre lookup did not complete or is not supported for this brand."]);
  }
  if (loc.strategy === "tinyfish_agent") {
    if (loc.verification === "VERIFIED" && loc.outcome === "CENTERS_FOUND") {
      return {
        key: "availability",
        label,
        weight: WEIGHTS.availability,
        score: 90,
        verification: "VERIFIED",
        summary: `${input.brand}'s official locator returned ${loc.centres.length} centre(s) for PIN ${input.pincode}.`,
        criteria: [{ label: "Official locator result for this PIN, independently validated", met: true, points: 90 }],
        evidence: [],
        limitations: ["Product scope comes from the category chosen on the locator."],
      };
    }
    return na("availability", label, `Not rated: the official locator result was ${loc.verification ?? "not validated"}.`, [
      "An unverified or failed locator run says nothing about coverage either way.",
    ]);
  }

  // Static directory (Samsung-linked). Only explicit product statements count.
  const city = loc.city ?? "the city";
  const listed = loc.centres;
  const withDetails = listed.filter((c) => Array.isArray(c.products_explicit));
  const explicit = key ? withDetails.filter((c) => c.products_explicit!.includes(key)) : [];
  const product = key ? PRODUCT_LABEL[key] : input.category;
  const limitations = [
    "Authorisation is the directory's own label on a Samsung-linked site, not confirmed on samsung.com.",
    `A ${city} listing does not establish service coverage for PIN ${input.pincode}.`,
    ...(listed.some((c) => c.pin === input.pincode) ? [] : [`No listed centre is in PIN ${input.pincode}; that does not mean the PIN is unserved.`]),
    ...(listed.length > withDetails.length ? [`${listed.length - withDetails.length} centre(s) have no detail page, so their products are unknown.`] : []),
  ];
  const evidence = explicit.map((c) => ({
    url: c.detail_url ?? c.source_url ?? "",
    title: c.name,
    retrieved_at: c.retrieved_at ?? "",
    source_type: "manufacturer_linked" as const,
    verification: "PARTIALLY_VERIFIED" as const,
    quote: `Lists ${c.products_explicit!.map((p) => p.replace("_", " ")).join(", ")}`,
  }));
  if (!key) {
    return na("availability", label, `Not rated: "${input.category}" could not be matched to a product type the directory names.`, limitations);
  }
  if (!explicit.length) {
    return na(
      "availability",
      label,
      `Not rated: ${listed.length} centre(s) are listed in ${city}, but none explicitly lists ${product} service.`,
      [`Products are stated for ${withDetails.length} centre(s); ${product} is named for none. Not stated is not the same as not offered.`, ...limitations],
    );
  }
  const score = Math.min(DIRECTORY_AVAILABILITY_CAP, 50 + 5 * (explicit.length - 1));
  return {
    key: "availability",
    label,
    weight: WEIGHTS.availability,
    score,
    verification: "PARTIALLY_VERIFIED",
    summary: `${explicit.length} of ${listed.length} listed ${city} centres explicitly name ${product} service.`,
    criteria: [
      { label: `At least one listed centre names ${product} service`, met: true, points: 50 },
      { label: "Each further centre naming it (+5)", met: explicit.length > 1, points: Math.min(DIRECTORY_AVAILABILITY_CAP, 50 + 5 * (explicit.length - 1)) - 50 },
      { label: `Capped at ${DIRECTORY_AVAILABILITY_CAP}: city-level, self-declared directory`, met: score === DIRECTORY_AVAILABILITY_CAP, points: 0 },
    ],
    evidence,
    limitations,
  };
}

export function rateInstallation(input: ScoringInput, key: ProductKey | null): Rating {
  const label = "Installation & warranty";
  const pages = officialPages(input.evidence);
  if (!key) return na("installation", label, "Not rated: the product category is not recognised.", []);
  if (!pages.length) return na("installation", label, "Not rated: no official manufacturer policy page was retrieved.", ["Official warranty and installation terms are unknown."]);

  const product = PRODUCT_LABEL[key];
  const head = (p: EvidenceInput) => `${p.canonical_url} ${p.title ?? ""}`;
  const relevant = pages.filter((p) => CATEGORY_TEXT[key].test(head(p)) || CATEGORY_TEXT[key].test(p.content ?? ""));
  if (!relevant.length) {
    return na("installation", label, `Not rated: no retrieved official page mentions ${product}s.`, [`${pages.length} official page(s) retrieved, none about ${product}s.`]);
  }
  const warrantyPage = relevant.find((p) => /warrant/i.test(head(p)));
  const quotes = relevant.flatMap((p) => warrantyDurationQuotes(p, key).map((q) => ({ p, q })));
  const installPage = relevant.find((p) => /install/i.test(head(p)) && CATEGORY_TEXT[key].test(head(p)));
  const criteria: Criterion[] = [
    { label: `Official warranty terms cover ${product}s`, met: Boolean(warrantyPage), points: warrantyPage ? 40 : 0 },
    { label: `A warranty duration is stated for ${product}s`, met: quotes.length > 0, points: quotes.length ? 30 : 0 },
    { label: `An official ${product} installation policy or price page exists`, met: Boolean(installPage), points: installPage ? 30 : 0 },
  ];
  const evidence = [
    ...(warrantyPage ? [ref(warrantyPage, "VERIFIED")] : []),
    ...quotes.slice(0, 3).map(({ p, q }) => ref(p, "VERIFIED", q)),
    ...(installPage ? [ref(installPage, "VERIFIED")] : []),
  ];
  return {
    key: "installation",
    label,
    weight: WEIGHTS.installation,
    score: criteria.reduce((s, c) => s + c.points, 0),
    verification: "VERIFIED",
    summary: `${criteria.filter((c) => c.met).length} of 3 official commitments documented for ${product}s on ${input.brand}'s own site.`,
    criteria,
    evidence,
    limitations: [
      "Measures how clearly the manufacturer documents its terms, not how well they are honoured.",
      `Installation eligibility for an address in PIN ${input.pincode} is not established.`,
      ...(installPage ? [] : [`No official ${product} installation page was retrieved.`]),
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

export function combine(ratings: Record<RatingKey, Rating>): { overall: Overall; confidence: Report["confidence"]; coverage: Report["coverage"] } {
  const scored = Object.values(ratings).filter((r) => r.score !== null);
  const supportedWeight = Math.round(scored.reduce((s, r) => s + r.weight, 0) * 100) / 100;
  const coverage = { supportedWeight, scoredRatings: scored.length };
  if (!scored.length) {
    return { overall: { state: "insufficient", reason: "No rating has enough evidence.", supportedWeight }, confidence: { level: "None", value: null, basis: "Nothing was scored." }, coverage };
  }
  const value = Math.round((scored.reduce((s, r) => s + r.weight * VERIFICATION_VALUE[r.verification ?? "UNVERIFIED"], 0) / supportedWeight) * 100) / 100;
  const level = value >= 0.8 ? "High" : value >= 0.5 ? "Moderate" : "Low";
  const confidence = { level, value, basis: scored.map((r) => `${r.label}: ${r.verification}`).join("; ") } as const;
  if (supportedWeight < MIN_SUPPORTED_WEIGHT || scored.length < MIN_SCORED_RATINGS) {
    return {
      overall: {
        state: "insufficient",
        reason: `Only ${scored.map((r) => r.label.toLowerCase()).join(" and ")} could be rated (${Math.round(supportedWeight * 100)}% of the weight). A score needs at least ${MIN_SCORED_RATINGS} ratings and ${MIN_SUPPORTED_WEIGHT * 100}% of the weight.`,
        supportedWeight,
      },
      confidence,
      coverage,
    };
  }
  const score = Math.round(scored.reduce((s, r) => s + r.weight * r.score!, 0) / supportedWeight);
  return { overall: { state: "scored", score, supportedWeight }, confidence, coverage };
}

export function buildReport(input: ScoringInput): Report {
  const key = categoryKey(input.category);
  const product = key ? PRODUCT_LABEL[key] : input.category;
  const ratings = {
    distance: rateDistance(input),
    experience: rateExperience(input),
    availability: rateAvailability(input, key),
    installation: rateInstallation(input, key),
  };
  const { overall, confidence, coverage } = combine(ratings);

  const promises = ratings.installation.evidence;
  const loc = input.locator;
  const explicitCount = key && loc ? loc.centres.filter((c) => c.products_explicit?.includes(key)).length : 0;
  const reality: string[] = [];
  if (!loc) reality.push("No service-centre lookup was available for this brand.");
  else if (loc.status !== "succeeded") reality.push("The service-centre lookup did not complete; coverage is unknown.");
  else if (loc.strategy === "static_directory") {
    reality.push(`${loc.centres.length} centres listed as authorised in ${loc.city ?? "the city"} on a Samsung-linked directory.`);
    reality.push(`${explicitCount} of them explicitly name ${product} service.`);
    reality.push(loc.centres.some((c) => c.pin === input.pincode) ? `At least one listed centre is in PIN ${input.pincode}.` : `None is located in PIN ${input.pincode}.`);
  } else {
    reality.push(`Official locator result: ${loc.verification ?? "not validated"} (${loc.outcome ?? "no outcome"}).`);
  }
  const customer = ratings.experience.evidence;

  const installPromised = ratings.installation.criteria.some((c) => c.label.includes("installation") && c.met);
  const gaps: string[] = [];
  if (installPromised && loc?.strategy === "static_directory" && loc.status === "succeeded" && explicitCount === 0) {
    gaps.push(`${input.brand} publishes ${product} installation terms, but no listed centre explicitly names ${product} service.`);
  }
  if (explicitCount > 0) gaps.push(`${product[0]!.toUpperCase()}${product.slice(1)} centres are listed for the city, but coverage of PIN ${input.pincode} is not confirmed by any source.`);
  if (promises.length && ratings.experience.score === null) {
    gaps.push(
      customer.length < MIN_COMMUNITY_SOURCES
        ? "Too few customer reports to test the official promise against real experiences."
        : "Customer reports retrieved do not state a clear enough experience to test the official promise.",
    );
  }
  if (!promises.length) gaps.push(`No official ${product} commitments were retrieved to compare against.`);

  const helplineSource = input.evidence.find((e) => e.source_type === "official_manufacturer" && HELPLINE.test(e.content ?? ""));
  const recommendations = [
    ...(ratings.availability.score === null
      ? [`Before buying, ask ${input.brand} which authorised centre services ${product}s for PIN ${input.pincode}.`]
      : [`Ask ${input.brand} to confirm that one of the listed ${product} centres covers PIN ${input.pincode}.`]),
    `Confirm installation eligibility and any charges for your address before purchase.`,
    ...(ratings.installation.criteria.some((c) => c.label.includes("duration") && c.met) ? ["Keep the invoice and register the product: the quoted warranty terms are the manufacturer's written commitment."] : []),
    ...(helplineSource ? [`${input.brand}'s official helpline 1800 5 7267864 appears on ${helplineSource.domain}.`] : []),
  ];
  const unresolved = [
    `Does any authorised centre cover PIN ${input.pincode} for ${product}s?`,
    ...(key && explicitCount === 0 && loc?.strategy === "static_directory" ? [`Which listed centres handle ${product}s at all?`] : []),
    "How far is the nearest suitable centre? (needs coordinates for the PIN)",
    `Is home installation available at the customer's address?`,
    ...(ratings.experience.score === null ? ["What do customers in this area report about repairs and delays?"] : []),
  ];

  return {
    category: { input: input.category, key, label: product },
    ratings,
    overall,
    coverage,
    confidence,
    promiseVsReality: { promises, reality, customer, gaps },
    community: {
      sources: customer,
      assessment:
        ratings.experience.score === null && customer.length < MIN_COMMUNITY_SOURCES
          ? `${customer.length} public post(s) found. That is not enough to describe what customers generally experience, so none is claimed.`
          : ratings.experience.summary,
    },
    recommendations,
    unresolved,
  };
}
