// Parses Samsung's static service-centre directory (Stage 2.6). Pure functions: no network, no DB.
// Every value is taken verbatim from the page; anything not explicitly present stays null.
import { canonicalizeUrl, domainMatches } from "@/lib/evidence/url";
import type { DirectoryStrategy } from "./adapters";

export interface DirectoryListing {
  name: string;
  street: string | null;
  locality: string | null;
  city: string | null;
  /** null when the page value is not a valid 6-digit Indian PIN (raw value kept in pinRaw) */
  pin: string | null;
  pinRaw: string | null;
  phone: string | null;
  landmark: string | null;
  detailUrl: string | null;
  sourceUrl: string;
}

export interface DirectoryDetail {
  coordinates: { lat: number; lng: number } | null;
  hours: string[];
  categories: string | null;
  tags: string | null;
  /** Product types explicitly named in categories/tags. Absence means "not stated", never "not serviced". */
  productsExplicit: string[];
  acServiceExplicit: boolean;
}

const PIN = /^[1-9][0-9]{5}$/;
const PHONE = /^\+?\d[\d\s-]{6,}$/;
const STOP = new Set(["Call", "Map", "Website", "Directions"]);

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** True if the URL is served from one of the directory's domains. */
export function isDirectoryUrl(url: string, strategy: DirectoryStrategy): boolean {
  const c = canonicalizeUrl(url);
  return Boolean(c && domainMatches(c.domain, strategy.directoryDomains));
}

/**
 * A listing block looks like (Stage 2.6 recording):
 *   Authorised Samsung CE Service Center - <name>
 *   <street lines...>
 *   <locality>
 *   <city>
 *   -
 *   <PIN>
 *   [landmark]
 *   <phone>
 *   Open until 08:00 PM | Closed for the day
 *   Call / Map / Website / Directions
 */
export function parseDirectoryPage(page: { url: string; text: string; links: string[] }, strategy: DirectoryStrategy): DirectoryListing[] {
  const lines = page.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const detailLinks = page.links.filter((l) => strategy.detailLinkPattern.test(l));
  const listings: DirectoryListing[] = [];

  for (let i = 0; i < lines.length; i++) {
    const name = lines[i]!.match(strategy.listingPrefix)?.[1]?.trim();
    if (!name) continue;
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && !strategy.listingPrefix.test(lines[j]!) && lines[j] !== "Directions"; j++) block.push(lines[j]!);

    const dash = block.indexOf("-");
    const before = dash >= 0 ? block.slice(0, dash) : [];
    const after = dash >= 0 ? block.slice(dash + 1).filter((l) => !STOP.has(l) && !/^(Open|Closed)\b/i.test(l)) : [];
    const pinRaw = after[0] ?? null;
    const rest = after.slice(1);
    const phone = rest.find((l) => PHONE.test(l)) ?? null;
    const landmark = rest.find((l) => l !== phone) ?? null;
    const city = before.length >= 1 ? before[before.length - 1]! : null;
    const locality = before.length >= 2 ? before[before.length - 2]! : null;
    const street = before.length >= 3 ? before.slice(0, -2).join(", ") : null;

    listings.push({
      name,
      street,
      locality,
      city,
      pin: pinRaw && PIN.test(pinRaw) ? pinRaw : null,
      pinRaw,
      phone,
      landmark,
      detailUrl: matchDetailLink(detailLinks, name, locality),
      sourceUrl: page.url,
    });
  }
  return listings;
}

/** Detail URLs embed slug(name) and slug(locality), e.g. ...-king-cool-system-repair-service-nayandahalli-bengaluru-472714/Home */
function matchDetailLink(links: string[], name: string, locality: string | null): string | null {
  const n = slug(name);
  if (!n) return null;
  const byName = links.filter((l) => l.includes(`-${n}-`));
  if (locality) {
    const both = byName.filter((l) => l.includes(`-${slug(locality)}-`));
    if (both.length === 1) return both[0]!;
  }
  return byName.length === 1 ? byName[0]! : null; // ambiguous -> no link rather than a wrong one
}

/** Same centre listed twice (e.g. across pages) is kept once. */
export function dedupeListings(listings: DirectoryListing[]): DirectoryListing[] {
  const seen = new Map<string, DirectoryListing>();
  for (const l of listings) {
    const key = `${slug(l.name)}|${l.pin ?? l.pinRaw ?? ""}|${slug(l.locality ?? "")}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, l);
    else if (!prev.detailUrl && l.detailUrl) seen.set(key, { ...prev, detailUrl: l.detailUrl });
  }
  return [...seen.values()];
}

const PRODUCT_WORDS: Record<string, RegExp> = {
  air_conditioner: /\b(air[\s-]?conditioners?|split ac|window ac|ac (repair|service|servicing|installation))\b/i,
  refrigerator: /\b(refrigerators?|fridge)\b/i,
  washing_machine: /\b(washing machines?|washer)\b/i,
  television: /\b(tv|television|led tv)\b/i,
  microwave: /\bmicrowaves?\b/i,
};

function section(lines: string[], heading: string): string[] {
  const start = lines.findIndex((l) => l.replace(/^#+\s*/, "").toLowerCase() === heading.toLowerCase());
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && !lines[i]!.startsWith("#"); i++) out.push(lines[i]!);
  return out;
}

export function parseDetailPage(text: string): DirectoryDetail {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  // first line of the recorded detail page is "<lat> <lng>"; accept only values inside India's bounding box
  const m = lines[0]?.match(/^(-?\d{1,2}\.\d+)\s+(-?\d{1,3}\.\d+)$/);
  const lat = m ? Number(m[1]) : NaN;
  const lng = m ? Number(m[2]) : NaN;
  const coordinates = lat >= 6 && lat <= 37 && lng >= 68 && lng <= 98 ? { lat, lng } : null;
  const hours = section(lines, "Business Hours").filter((l) => l.startsWith("*")).map((l) => l.replace(/^\*\s*/, ""));
  const categories = section(lines, "Categories").join(" ") || null;
  const tags = section(lines, "Tags").join(" ") || null;
  const haystack = `${categories ?? ""} ${tags ?? ""}`;
  const productsExplicit = Object.entries(PRODUCT_WORDS).filter(([, re]) => re.test(haystack)).map(([k]) => k);
  return { coordinates, hours, categories, tags, productsExplicit, acServiceExplicit: productsExplicit.includes("air_conditioner") };
}
