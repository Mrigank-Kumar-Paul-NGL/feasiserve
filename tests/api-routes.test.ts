import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInvestigationInput } from "@/lib/investigation/input";

const SECRET = "service-role-secret-not-real";
const post = (body: unknown) =>
  new Request("http://localhost/api/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const VALID = { brand: "Samsung", product_category: "Split AC", pincode: "560001" };

beforeEach(() => vi.resetModules()); // fresh Supabase client per test
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/investigate", () => {
  it("10. Supabase unreachable -> 503 with a generic message, no secrets, no TinyFish call", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key-not-real");
    vi.stubEnv("SUPABASE_URL", "https://unreachable.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", SECRET);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("@/app/api/investigate/route");
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Database unavailable, please retry" });
    expect(text).not.toContain(SECRET);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("tinyfish"))).toBe(true);
  }, 20_000); // supabase-js retries idempotent reads with 1s/2s/4s back-off before giving up

  it("10b. Supabase not configured -> 503 'not configured'", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "tf-key-not-real");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/investigate/route");
    const res = await POST(post(VALID));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Service is not configured" });
  });

  it("rejects invalid input with field errors before touching any service", async () => {
    const { POST } = await import("@/app/api/investigate/route");
    const res = await POST(post({ brand: "", product_category: "AC", pincode: "056001" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(Object.keys(body.fields).sort()).toEqual(["brand", "pincode"]);
    const bad = await POST(new Request("http://localhost/api/investigate", { method: "POST", body: "{not json" }));
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/investigate/[id]", () => {
  it("rejects non-UUID ids", async () => {
    const { GET } = await import("@/app/api/investigate/[id]/route");
    const res = await GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "1;drop table" }) });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/health", () => {
  it("reports missing configuration without making any calls", async () => {
    vi.stubEnv("TINYFISH_API_KEY", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, tinyfish_key_configured: false, database: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseInvestigationInput", () => {
  it("normalises whitespace and accepts an optional model", () => {
    expect(parseInvestigationInput({ brand: "  Samsung  ", product_category: "Split   AC", product_model: "AR18CY3", pincode: " 560001 " })).toEqual({
      ok: true,
      value: { brand: "Samsung", product_category: "Split AC", product_model: "AR18CY3", pincode: "560001" },
    });
  });
  it("rejects bad PINs, markup and oversized values", () => {
    for (const pincode of ["56001", "5600011", "056001", "56OO01", 560001]) {
      expect(parseInvestigationInput({ ...VALID, pincode }).ok, String(pincode)).toBe(false);
    }
    expect(parseInvestigationInput({ ...VALID, brand: "<script>" }).ok).toBe(false);
    expect(parseInvestigationInput({ ...VALID, product_category: "x".repeat(61) }).ok).toBe(false);
    expect(parseInvestigationInput([]).ok).toBe(false);
  });
});
