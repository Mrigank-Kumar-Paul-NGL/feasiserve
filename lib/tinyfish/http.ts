import { tinyfishApiKey } from "@/lib/env";

export type TinyFishErrorCode =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK"
  | "UPSTREAM"
  | "AUTH"
  | "BILLING"
  | "BAD_REQUEST"
  | "MALFORMED_RESPONSE";

const RETRYABLE: ReadonlySet<TinyFishErrorCode> = new Set(["RATE_LIMITED", "TIMEOUT", "NETWORK", "UPSTREAM"]);

const PUBLIC_MESSAGES: Record<TinyFishErrorCode, string> = {
  RATE_LIMITED: "TinyFish rate limit reached",
  TIMEOUT: "TinyFish request timed out",
  NETWORK: "Could not reach TinyFish",
  UPSTREAM: "TinyFish service error",
  AUTH: "TinyFish rejected the API key",
  BILLING: "TinyFish account has insufficient credits",
  BAD_REQUEST: "TinyFish rejected the request",
  MALFORMED_RESPONSE: "TinyFish returned an unexpected response",
};

/** Error safe to persist: never contains the API key or raw response bodies. */
export class TinyFishError extends Error {
  override name = "TinyFishError";
  constructor(
    readonly code: TinyFishErrorCode,
    message: string,
    readonly status?: number,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
  get publicMessage(): string {
    return PUBLIC_MESSAGES[this.code];
  }
}

function codeForStatus(status: number): TinyFishErrorCode {
  if (status === 429) return "RATE_LIMITED";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 402) return "BILLING";
  if (status >= 500) return "UPSTREAM";
  return "BAD_REQUEST";
}

function retryAfterSeconds(headers: Headers, nowMs: number): number | undefined {
  const retryAfter = Number(headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter;
  const reset = Number(headers.get("x-ratelimit-reset")); // epoch seconds (seen in Stage 1.5)
  if (Number.isFinite(reset) && reset > 0) return Math.max(1, Math.ceil(reset - nowMs / 1000));
  return undefined;
}

function providerCode(body: unknown): string | undefined {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (err && typeof err === "object" && "code" in err && typeof err.code === "string") return err.code;
  }
  return undefined;
}

export async function tinyfishRequest(
  url: string,
  options: { method: "GET" | "POST"; body?: unknown; timeoutMs: number },
): Promise<unknown> {
  const key = tinyfishApiKey(); // throws ConfigError before any network activity
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method,
      headers: {
        "X-API-Key": key,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(options.timeoutMs),
      cache: "no-store",
    });
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new TinyFishError("TIMEOUT", `TinyFish request timed out after ${options.timeoutMs}ms`);
    }
    throw new TinyFishError("NETWORK", `TinyFish network error: ${e instanceof Error ? e.message : "unknown"}`);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      if (res.ok) throw new TinyFishError("MALFORMED_RESPONSE", "TinyFish returned non-JSON", res.status);
    }
  }
  if (!res.ok) {
    const code = providerCode(body);
    throw new TinyFishError(
      codeForStatus(res.status),
      `TinyFish HTTP ${res.status}${code ? ` (${code})` : ""}`,
      res.status,
      retryAfterSeconds(res.headers, Date.now()),
    );
  }
  return body;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
