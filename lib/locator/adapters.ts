// Manufacturer-specific locator configuration. Only facts observed in Stage 1 / 1.5 / 2.6 evidence are recorded here.
// No adapter is marked verified until a real run passes backend validation.

export interface AgentStrategy {
  kind: "tinyfish_agent";
  url: string;
  /** True only after a real run passed validateLocatorRun. */
  verified: boolean;
  proxyCountry: string | null;
  categoryHint: (category: string) => string | null;
}

export interface DirectoryStrategy {
  kind: "static_directory";
  /** Domains the directory pages must be served from (checked on every fetched page). */
  directoryDomains: readonly string[];
  /** PIN prefix (first 3 digits) -> observed city directory page URLs. */
  cityPages: Readonly<Record<string, { city: string; urls: readonly string[] }>>;
  /** Detail-page path pattern; links not matching it are ignored. */
  detailLinkPattern: RegExp;
  /** Title prefix of each listing block on a city page. */
  listingPrefix: RegExp;
  maxDetailPages: number;
}

export type LocatorStrategy = AgentStrategy | DirectoryStrategy | { kind: "unavailable"; url: string; reason: string };

export interface ManufacturerAdapter {
  id: string;
  name: string;
  aliases: readonly string[];
  /** Domains the manufacturer owns. Agent locator results must come from one of these. */
  officialDomains: readonly string[];
  /** Domains the official site links to as its own service channels. Never accepted as Agent locator results. */
  linkedDomains: readonly string[];
  /** Default discovery strategy. */
  locator: LocatorStrategy;
  /**
   * Official policy/support pages fetched fresh on every investigation, in addition to search results.
   * URLs only: nothing found on them is stored in code.
   */
  officialPages?: readonly string[];
  /** If set, official-domain pages outside this path (another country's site) are not treated as official. */
  officialRegionPath?: RegExp;
  /** Interactive locator kept for later; used only when FEASISERVE_LOCATOR_FALLBACK=agent. */
  agentFallback?: AgentStrategy;
}

const isAc = (c: string) => /\b(ac|air ?conditioner|split|window)\b/i.test(c);
const SAMSUNG_DIR = "https://servicecenter.samsungdigitalservicecenter.com/ce/location";

export const ADAPTERS: readonly ManufacturerAdapter[] = [
  {
    id: "samsung",
    name: "Samsung",
    aliases: ["samsung", "samsung india"],
    officialDomains: ["samsung.com"],
    // linked from samsung.com/in/support/service-center/ (docs/evidence/tinyfish-fetch-rest-samsung-service-center.json)
    linkedDomains: ["samsungdigitalservicecenter.com"],
    // India only: samsung.com/in/... and India assets (images.samsung.com/.../assets/in/...). Investigation ba8aedeb had used samsung.com/us/ (KI-037).
    officialRegionPath: /^\/in(\/|$)|\/assets\/in\//,
    locator: {
      kind: "static_directory",
      directoryDomains: ["servicecenter.samsungdigitalservicecenter.com"],
      // shortcut: only Bengaluru is mapped (URLs observed in Stage 2.6); add cities from the state page links as needed
      cityPages: {
        "560": { city: "Bengaluru", urls: [`${SAMSUNG_DIR}/karnataka/bangalore`, `${SAMSUNG_DIR}/karnataka/bangalore?page=2`] },
      },
      detailLinkPattern: /^https:\/\/servicecenter\.samsungdigitalservicecenter\.com\/ce\/authorised-samsung-ce-service-center-[a-z0-9-]+-\d+\/Home$/,
      listingPrefix: /^Authori[sz]ed Samsung CE Service Center - (.+)$/,
      maxDetailPages: 10, // one Fetch request
    },
    agentFallback: {
      kind: "tinyfish_agent",
      url: "https://www.samsung.com/in/support/service-center/",
      verified: false,
      // map widget never rendered in run 96040f6c (KI-023); IN proxy failed in 090e935c (KI-003)
      proxyCountry: null,
      categoryHint: (c) => (isAc(c) ? "Home Appliance > Air Conditioner" : null),
    },
  },
  {
    id: "lg",
    name: "LG",
    aliases: ["lg", "lg electronics", "lg india"],
    officialDomains: ["lg.com"],
    linkedDomains: [],
    officialRegionPath: /^\/in\//, // search returned lg.com/ca_en/ (LG Canada) in the first live run

    // LG India support pages named for the demo; all six fetched successfully in the feasibility check (docs/evidence/lg-support-fetch-summary.json)
    officialPages: [
      "https://www.lg.com/in/support/warranty-terms/",
      "https://www.lg.com/in/support/contact-us/",
      "https://www.lg.com/in/support/product-support/repair-request/",
      "https://www.lg.com/in/support/product-support/warranty/",
      "https://www.lg.com/in/support/product-support/",
      "https://www.lg.com/in/support/",
    ],
    locator: {
      kind: "unavailable",
      url: "https://www.lg.com/in/support/contact-us/locate-repair-center/",
      reason: "LG's official locator did not render a PIN search input when tested (run b4eefea8, KI-002).",
    },
  },
];

function normalise(brand: string): string {
  return brand.trim().toLowerCase().replace(/\s+/g, " ");
}

export function findAdapter(brand: string): ManufacturerAdapter | null {
  const b = normalise(brand);
  return ADAPTERS.find((a) => a.aliases.includes(b)) ?? null;
}

/** The strategy an investigation should use. The Agent fallback is opt-in only. */
export function activeLocator(adapter: ManufacturerAdapter): LocatorStrategy {
  if (process.env.FEASISERVE_LOCATOR_FALLBACK === "agent" && adapter.agentFallback) return adapter.agentFallback;
  return adapter.locator;
}
