// Two kinds of fixtures, kept apart on purpose:
//  - RECORDED: real TinyFish responses captured in Stage 1/1.5 (docs/evidence). Real failures and real search/fetch output.
//  - SYNTHETIC: invented agent outputs for cases we have not observed live (e.g. a successful locator search).
//    Every synthetic service centre is named "SYNTHETIC TEST CENTRE ..." and must never appear outside tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentRun } from "@/lib/tinyfish/agent";
import { parseAgentRun } from "@/lib/tinyfish/agent";

const evidenceDir = fileURLToPath(new URL("../../docs/evidence/", import.meta.url));
export const recorded = (file: string): unknown => JSON.parse(readFileSync(join(evidenceDir, file), "utf8"));

export const RECORDED = {
  lgNotSubmitted: () => parseAgentRun(recorded("tinyfish-run-lg-560001-b4eefea8.json")),
  samsungTunnelFailure: () => parseAgentRun(recorded("tinyfish-run-samsung-560001-090e935c.json")),
  samsungSearch: () => recorded("tinyfish-search-rest-samsung.json"),
  samsungFetch: () => recorded("tinyfish-fetch-rest-samsung-service-center.json"),
};

const SYNTHETIC_CENTRES = [
  { name: "SYNTHETIC TEST CENTRE A", address: "1 Test Road, Testville 560001", phone: "000-0000000", distance: "1.2 km", hours: null, products: "Air Conditioner" },
  { name: "SYNTHETIC TEST CENTRE B", address: "2 Test Road, Testville 560001", phone: null, distance: "3.4 km", hours: null, products: null },
];

export function syntheticAgentRun(resultOverrides: Record<string, unknown> = {}, runOverrides: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: "synthetic-run-0001",
    status: "COMPLETED",
    started_at: "2026-10-31T00:00:00Z",
    finished_at: "2026-10-31T00:03:00Z",
    num_of_steps: 12,
    error: null,
    streaming_url: null,
    steps: [{ action: "SYNTHETIC: submitted search", status: "COMPLETED", timestamp: "2026-10-31T00:02:00Z" }],
    result: {
      search_submitted: true,
      category_selected: "Home Appliance > Air Conditioner",
      pin_entered: "560001",
      location_selected: "560001",
      radius_used: "10 KM",
      results_page_url: "https://www.samsung.com/in/support/service-center/?srsltid=tracking123",
      page_message: null,
      obstacles: null,
      service_centers: SYNTHETIC_CENTRES,
      ...resultOverrides,
    },
    ...runOverrides,
  };
}
