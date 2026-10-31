const TRACKING_PARAM = /^(utm_[a-z_]+|srsltid|gclid|gbraid|wbraid|fbclid|msclkid|mc_cid|mc_eid|igshid|_ga|_gl|ref_src)$/i;

export interface CanonicalUrl {
  sourceUrl: string;
  canonicalUrl: string;
  /** Lower-case hostname without a leading "www." */
  domain: string;
}

/** Returns null for anything that is not a parseable http(s) URL. */
export function canonicalizeUrl(raw: string): CanonicalUrl | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.hash = "";
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  return { sourceUrl: raw, canonicalUrl: url.toString(), domain: url.hostname.toLowerCase().replace(/^www\./, "") };
}

/** Exact domain or a true subdomain. "samsung.com.evil.io" does not match "samsung.com". */
export function domainMatches(domain: string, allowed: readonly string[]): boolean {
  const d = domain.toLowerCase();
  return allowed.some((a) => d === a || d.endsWith(`.${a}`));
}
