import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyDomain } from "@/lib/evidence/classify";
import { canonicalizeUrl, domainMatches } from "@/lib/evidence/url";
import { findAdapter } from "@/lib/locator/adapters";
import { getAgentRun, startAgentRun } from "@/lib/tinyfish/agent";
import { tinyfishFetch } from "@/lib/tinyfish/fetch";
import { TinyFishError } from "@/lib/tinyfish/http";
import { tinyfishSearch } from "@/lib/tinyfish/search";
import { RECORDED, recorded } from "./fixtures";

const FAKE_KEY = "test-key-not-real-0000";
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv("TINYFISH_API_KEY", FAKE_KEY);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("TinyFish Search (REST)", () => {
  it("7. parses the recorded Stage 1.5 response and sends the key only as a header", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RECORDED.samsungSearch()));
    const res = await tinyfishSearch({ query: "Samsung AC service", location: "IN", includeDomains: ["samsung.com"] });

    expect(res.results).toHaveLength(10);
    expect(res.results[0]).toMatchObject({ position: 1, site_name: "www.samsung.com", title: "Find a Samsung Service Center" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("https://api.search.tinyfish.ai?query=Samsung+AC+service");
    expect(String(url)).toContain("include_domains=samsung.com");
    expect(String(url)).not.toContain(FAKE_KEY);
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe(FAKE_KEY);
  });

  it("classifies the recorded results conservatively after canonicalisation", () => {
    const samsung = findAdapter("Samsung");
    const types = (RECORDED.samsungSearch() as { results: { url: string }[] }).results.map((r) => {
      const c = canonicalizeUrl(r.url)!;
      return [c.domain, classifyDomain(c.domain, samsung), c.canonicalUrl] as const;
    });
    expect(types[0]).toEqual(["samsung.com", "official_manufacturer", "https://www.samsung.com/in/support/service-center/"]);
    expect(types.find(([d]) => d === "servicecenter.samsungdigitalservicecenter.com")?.[1]).toBe("manufacturer_linked");
    expect(types.find(([d]) => d === "24x7homeservice.com")?.[1]).toBe("unknown");
    expect(types.find(([d]) => d === "m.indiacustomercare.com")?.[1]).toBe("third_party");
    expect(types.every(([, , url]) => !url.includes("srsltid"))).toBe(true);
    expect(classifyDomain("samsung.com", null)).toBe("unknown"); // unknown brand: nothing is "official"
  });

  it("rejects malformed search responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ unexpected: true }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
    fetchMock.mockResolvedValueOnce(new Response("<html>oops</html>", { status: 200 }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});

describe("TinyFish Fetch (REST)", () => {
  it("8. parses the recorded Stage 1.5 fetch of Samsung's service-centre page", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(RECORDED.samsungFetch()));
    const res = await tinyfishFetch(["https://www.samsung.com/in/support/service-center/"]);
    const page = res.results[0]!;
    expect(page.title).toBe("Find a Samsung Service Center | Samsung Support India");
    expect(page.published_date).toBe("2026-08-13");
    expect(page.etag).toMatch(/^W\//);
    expect(page.text).toContain("Air Conditioner");
    expect(res.errors).toEqual([]);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body).toMatchObject({ format: "markdown", urls: ["https://www.samsung.com/in/support/service-center/"] });
  });

  it("keeps per-URL failures separate from successes", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [], errors: [{ url: "https://www.samsung.com/x", error: "bot_blocked" }] }));
    const res = await tinyfishFetch(["https://www.samsung.com/x"]);
    expect(res.errors).toEqual([{ url: "https://www.samsung.com/x", error: "bot_blocked", status: null }]);
  });

  it("refuses more than 10 URLs without calling the API", async () => {
    await expect(tinyfishFetch(Array(11).fill("https://a.com"))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TinyFish HTTP errors", () => {
  it("9. 429 becomes a retryable RATE_LIMITED error with retry-after", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: "RATE_LIMIT_EXCEEDED" } }, { status: 429, headers: { "retry-after": "17" } }));
    const err = await tinyfishSearch({ query: "x" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TinyFishError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", status: 429, retryAfterSec: 17, retryable: true });
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
  });

  it("maps auth, billing, server and network failures", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 401 }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "AUTH", retryable: false });
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 402 }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "BILLING", retryable: false });
    fetchMock.mockResolvedValueOnce(jsonResponse({}, { status: 503 }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "UPSTREAM", retryable: true });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "NETWORK" });
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("fails with ConfigError before any network call when the key is missing", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    await expect(tinyfishSearch({ query: "x" })).rejects.toMatchObject({ name: "ConfigError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TinyFish Agent (REST)", () => {
  it("starts a run and parses the recorded run record without screenshot URLs", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ run_id: "090e935c-e918-4319-a19a-cc6ab0f1428f", error: null }));
    expect(await startAgentRun({ url: "https://www.samsung.com/in/support/service-center/", goal: "g" })).toEqual({
      runId: "090e935c-e918-4319-a19a-cc6ab0f1428f",
    });
    fetchMock.mockResolvedValueOnce(jsonResponse(recorded("tinyfish-run-samsung-560001-090e935c.json")));
    const run = await getAgentRun("090e935c-e918-4319-a19a-cc6ab0f1428f");
    expect(run).toMatchObject({ status: "COMPLETED", num_of_steps: 31 });
    expect(run.steps).toHaveLength(32);
    expect(JSON.stringify(run.steps)).not.toContain("screenshot");

    fetchMock.mockResolvedValueOnce(jsonResponse({ run_id: "x", status: "SOMETHING_NEW" }));
    await expect(getAgentRun("x")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });

  it("treats a run-creation error body as a failure", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ run_id: null, error: { message: "nope" } }));
    await expect(startAgentRun({ url: "https://a.com", goal: "g" })).rejects.toMatchObject({ code: "UPSTREAM" });
  });

  it("refuses run ids that could alter the request path", async () => {
    await expect(getAgentRun("../automation/run")).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("URL helpers", () => {
  it("domainMatches only accepts exact domains and real subdomains", () => {
    expect(domainMatches("www.samsung.com", ["samsung.com"])).toBe(true);
    expect(domainMatches("samsung.com", ["samsung.com"])).toBe(true);
    expect(domainMatches("evilsamsung.com", ["samsung.com"])).toBe(false);
    expect(domainMatches("samsung.com.evil.io", ["samsung.com"])).toBe(false);
  });
  it("canonicalizeUrl rejects non-http schemes and strips tracking + fragments", () => {
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalizeUrl("not a url")).toBeNull();
    expect(canonicalizeUrl("https://WWW.LG.com/in/?utm_source=x&b=2&a=1#top")?.canonicalUrl).toBe("https://www.lg.com/in/?a=1&b=2");
  });
});
