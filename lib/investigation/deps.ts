import { ConfigError, tinyfishApiKey } from "@/lib/env";
import { createSupabaseStore } from "@/lib/supabase/store";
import { cancelAgentRun, getAgentRun, startAgentRun } from "@/lib/tinyfish/agent";
import { tinyfishFetch } from "@/lib/tinyfish/fetch";
import { TinyFishError } from "@/lib/tinyfish/http";
import { tinyfishSearch } from "@/lib/tinyfish/search";
import type { Deps } from "./orchestrator";
import { StoreError } from "./store";

/** Production wiring. Throws ConfigError up front if credentials are missing. */
export function defaultDeps(): Deps {
  tinyfishApiKey();
  return {
    store: createSupabaseStore(),
    tinyfish: { search: tinyfishSearch, fetchPages: tinyfishFetch, startRun: startAgentRun, getRun: getAgentRun, cancelRun: cancelAgentRun },
    now: () => new Date(),
  };
}

/** Maps internal errors to safe client responses; details stay in server logs. */
export function errorResponse(error: unknown, context: string): Response {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[${context}] ${detail}`);
  if (error instanceof ConfigError) return Response.json({ error: "Service is not configured" }, { status: 503 });
  if (error instanceof StoreError) return Response.json({ error: "Database unavailable, please retry" }, { status: 503 });
  if (error instanceof TinyFishError && error.code === "RATE_LIMITED") {
    return Response.json({ error: "Investigation provider is busy, please retry" }, { status: 503 });
  }
  return Response.json({ error: "Internal error" }, { status: 500 });
}
