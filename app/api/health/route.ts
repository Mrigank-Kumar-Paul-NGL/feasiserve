import { envStatus } from "@/lib/env";
import { checkDatabase } from "@/lib/supabase/store";

export const dynamic = "force-dynamic";

/** Reports configuration and database reachability. Makes no TinyFish calls (they cost credits). */
export async function GET(): Promise<Response> {
  const env = envStatus();
  let database: "ok" | "not_configured" | "unreachable" = "not_configured";
  if (env.supabase) {
    try {
      await checkDatabase();
      database = "ok";
    } catch (error) {
      console.error(`[health] ${error instanceof Error ? error.message : String(error)}`);
      database = "unreachable";
    }
  }
  const ok = env.tinyfish && database === "ok";
  return Response.json(
    { ok, tinyfish_key_configured: env.tinyfish, database },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
