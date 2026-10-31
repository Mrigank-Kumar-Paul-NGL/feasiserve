import { TinyFishError, isRecord, str, tinyfishRequest } from "./http";

const FETCH_URL = "https://api.fetch.tinyfish.ai";

export interface FetchedPage {
  url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  language: string | null;
  published_date: string | null;
  last_modified: string | null;
  etag: string | null;
  text: string | null;
  latency_ms: number | null;
  /** Only present when requested with links: true. */
  links: string[];
}

export interface FetchFailure {
  url: string;
  error: string;
  status: number | null;
}

export interface FetchResponse {
  results: FetchedPage[];
  errors: FetchFailure[];
}

export function parseFetchResponse(data: unknown): FetchResponse {
  if (!isRecord(data) || !Array.isArray(data.results)) {
    throw new TinyFishError("MALFORMED_RESPONSE", "Fetch response missing results array");
  }
  const results: FetchedPage[] = [];
  for (const r of data.results) {
    if (!isRecord(r) || typeof r.url !== "string") continue;
    results.push({
      url: r.url,
      final_url: typeof r.final_url === "string" ? r.final_url : r.url,
      title: str(r.title),
      description: str(r.description),
      language: str(r.language),
      published_date: str(r.published_date),
      last_modified: str(r.last_modified),
      etag: str(r.etag),
      text: typeof r.text === "string" ? r.text : null,
      latency_ms: typeof r.latency_ms === "number" ? r.latency_ms : null,
      links: Array.isArray(r.links) ? r.links.filter((l): l is string => typeof l === "string") : [],
    });
  }
  const errors: FetchFailure[] = [];
  for (const e of Array.isArray(data.errors) ? data.errors : []) {
    if (!isRecord(e) || typeof e.url !== "string") continue;
    errors.push({ url: e.url, error: str(e.error) ?? "unknown", status: typeof e.status === "number" ? e.status : null });
  }
  return { results, errors };
}

export async function tinyfishFetch(urls: string[], options: { links?: boolean } = {}): Promise<FetchResponse> {
  if (urls.length < 1 || urls.length > 10) throw new TinyFishError("BAD_REQUEST", "Fetch accepts 1-10 URLs");
  const data = await tinyfishRequest(FETCH_URL, {
    method: "POST",
    // 45s per URL keeps the whole call well inside one serverless invocation
    body: { urls, format: "markdown", links: options.links ?? false, image_links: false, include_etag_and_last_modified: true, per_url_timeout_ms: 45_000 },
    timeoutMs: 60_000,
  });
  return parseFetchResponse(data);
}
