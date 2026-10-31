import { TinyFishError, isRecord, str, tinyfishRequest } from "./http";

const SEARCH_URL = "https://api.search.tinyfish.ai";

export interface SearchResult {
  position: number;
  site_name: string | null;
  title: string | null;
  snippet: string | null;
  url: string;
  date: string | null;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  total_results: number;
  page: number;
}

export interface SearchParams {
  query: string;
  location?: string;
  language?: string;
  includeDomains?: string[];
}

/** Validates the shape verified in Stage 1.5. Results without a string URL are dropped, not guessed. */
export function parseSearchResponse(data: unknown): SearchResponse {
  if (!isRecord(data) || !Array.isArray(data.results)) {
    throw new TinyFishError("MALFORMED_RESPONSE", "Search response missing results array");
  }
  const results: SearchResult[] = [];
  data.results.forEach((r, i) => {
    if (!isRecord(r) || typeof r.url !== "string") return;
    results.push({
      position: typeof r.position === "number" ? r.position : i + 1,
      site_name: str(r.site_name),
      title: str(r.title),
      snippet: str(r.snippet),
      url: r.url,
      date: str(r.date),
    });
  });
  return {
    query: typeof data.query === "string" ? data.query : "",
    results,
    total_results: typeof data.total_results === "number" ? data.total_results : results.length,
    page: typeof data.page === "number" ? data.page : 0,
  };
}

export async function tinyfishSearch(params: SearchParams): Promise<SearchResponse> {
  const qs = new URLSearchParams({ query: params.query });
  if (params.location) qs.set("location", params.location);
  if (params.language) qs.set("language", params.language);
  if (params.includeDomains?.length) qs.set("include_domains", params.includeDomains.join(","));
  const data = await tinyfishRequest(`${SEARCH_URL}?${qs}`, { method: "GET", timeoutMs: 20_000 });
  return parseSearchResponse(data);
}
