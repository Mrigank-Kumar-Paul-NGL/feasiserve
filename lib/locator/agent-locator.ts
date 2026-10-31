import type { AgentRequest } from "@/lib/tinyfish/agent";
import type { AgentStrategy, ManufacturerAdapter } from "./adapters";

export const AGENT_MAX_DURATION_SECONDS = 240;

// Same structure as the Stage 1.5 runs; `nullable` because TinyFish rejects type arrays (KI-011).
const nullableString = { type: "string", nullable: true } as const;
export const LOCATOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    search_submitted: { type: "boolean" },
    category_selected: nullableString,
    pin_entered: nullableString,
    location_selected: nullableString,
    radius_used: nullableString,
    results_page_url: nullableString,
    page_message: nullableString,
    obstacles: nullableString,
    service_centers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: nullableString,
          phone: nullableString,
          distance: nullableString,
          hours: nullableString,
          products: nullableString,
        },
        required: ["name"],
      },
    },
  },
  required: ["search_submitted", "service_centers"],
} as const;

export interface LocatorInput {
  product_category: string;
  product_model: string | null;
  pincode: string;
}

/** Generic TinyFish Agent fallback; manufacturer specifics come only from the adapter. */
export function buildLocatorAgentRequest(adapter: ManufacturerAdapter, strategy: AgentStrategy, input: LocatorInput): AgentRequest {
  const { url, proxyCountry, categoryHint } = strategy;
  const category = categoryHint(input.product_category) ?? input.product_category;
  const domains = adapter.officialDomains.join(", ");
  const goal = [
    `You are on ${adapter.name}'s official service centre locator.`,
    `Stay on ${domains}. Do not navigate to any other website. If the page fails to load twice, stop and describe the error in obstacles.`,
    `1) Close any cookie banner or popup.`,
    `2) Select the product category closest to "${category}"${input.product_model ? ` (model ${input.product_model})` : ""}.`,
    `3) Type exactly ${input.pincode} into the PIN code / post code / location field and submit the search. Choose the suggestion matching ${input.pincode} if a list appears.`,
    `4) Wait for the results list to load. If none appear, increase the search radius once and search again.`,
    `5) Extract every service centre listed: name, address, phone, distance, hours and handled products if shown.`,
    `Report honestly: search_submitted=true only if you submitted the search; pin_entered must be exactly the characters you typed; results_page_url must be the URL of the page showing the results. If no results appear, copy the page's exact message into page_message. Never invent data.`,
  ].join("\n");
  return {
    url,
    goal,
    browser_profile: "stealth",
    ...(proxyCountry ? { proxy_config: { enabled: true, type: "tinyfish", country_code: proxyCountry } } : {}),
    agent_config: { max_duration_seconds: AGENT_MAX_DURATION_SECONDS },
    output_schema: LOCATOR_OUTPUT_SCHEMA,
  };
}
