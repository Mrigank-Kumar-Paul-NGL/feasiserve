// LIVE check (Stage 2.7): one directory-only investigation through the real orchestrator + Supabase.
// Run with: npx vitest run --config vitest.live.config.ts   (makes at most 2 TinyFish Fetch requests)
import { expect, it } from "vitest";
import { defaultDeps } from "@/lib/investigation/deps";
import { advanceInvestigation, type Deps } from "@/lib/investigation/orchestrator";

it("Samsung Bengaluru directory, live", async () => {
  process.loadEnvFile(".env.local");
  const real = defaultDeps();
  let fetches = 0;
  const deps: Deps = {
    ...real,
    tinyfish: {
      ...real.tinyfish,
      fetchPages: (urls, options) => {
        if (++fetches > 2) throw new Error("live budget exceeded: more than 2 Fetch requests");
        return real.tinyfish.fetchPages(urls, options);
      },
      search: () => Promise.reject(new Error("Search disabled for this live check")),
      startRun: () => Promise.reject(new Error("Agent disabled for this live check")),
    },
  };
  const inv = await deps.store.createInvestigation({
    brand: "Samsung",
    product_category: "Split Air Conditioner",
    product_model: null,
    pincode: "560001",
    status: "running",
  });
  await deps.store.createRuns([
    {
      investigation_id: inv.id,
      provider: "tinyfish",
      operation: "locator_directory",
      status: "pending",
      metadata: { strategy: "static_directory", note: "Stage 2.7 directory-only live check (no searches, no agent)" },
    },
  ]);
  const done = await advanceInvestigation(deps, inv.id);
  const run = (await deps.store.listRuns(inv.id))[0]!;
  console.log(JSON.stringify({ investigation_id: inv.id, status: done?.status, run_status: run.status, error: run.error_message, fetches, meta: { listings_found: run.metadata.listings_found, details_retrieved: run.metadata.details_retrieved } }));
  expect(fetches).toBeLessThanOrEqual(2);
}, 240_000);
