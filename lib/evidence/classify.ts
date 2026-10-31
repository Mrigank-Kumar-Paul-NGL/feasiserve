import type { ManufacturerAdapter } from "@/lib/locator/adapters";
import type { SourceType } from "@/lib/supabase/types";
import { domainMatches } from "./url";

// Conservative lists: anything not listed is "unknown", never "official".
const COMMUNITY = ["reddit.com", "quora.com", "mouthshut.com", "consumercomplaints.in", "x.com", "twitter.com", "youtube.com", "facebook.com"];
const THIRD_PARTY = ["amazon.in", "flipkart.com", "croma.com", "reliancedigital.in", "vijaysales.com", "justdial.com", "indiacustomercare.com"];

/** `url` lets an adapter limit "official" to its country section (e.g. lg.com/in/ but not lg.com/ca_en/). */
export function classifyDomain(domain: string, adapter: ManufacturerAdapter | null, url?: string): SourceType {
  if (adapter && domainMatches(domain, adapter.officialDomains)) {
    if (adapter.officialRegionPath && url && !adapter.officialRegionPath.test(new URL(url).pathname)) return "unknown";
    return "official_manufacturer";
  }
  if (adapter && domainMatches(domain, adapter.linkedDomains)) return "manufacturer_linked";
  if (domainMatches(domain, COMMUNITY)) return "community";
  if (domainMatches(domain, THIRD_PARTY)) return "third_party";
  return "unknown";
}
