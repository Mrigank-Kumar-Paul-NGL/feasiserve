# FeasiServe — Known Issues

Format: unique ID · severity · description · reproduction · status · proposed resolution.
Statuses: OPEN, MITIGATED (handled in code, root cause remains), FIXED, BLOCKED (needs user input).
KI-001 to KI-013 carried over from Stage 1/1.5 (renumbered from the old `#` table; none removed).

---

### KI-001 — No successful live locator extraction yet
- **Severity:** Critical
- **Description:** Both live Agent runs ended with `search_submitted:false` and no service centres (LG b4eefea8, Samsung 090e935c).
- **Reproduction:** `docs/evidence/tinyfish-run-*.json`.
- **Status:** BLOCKED. Needs one approved live run through the app.
- **Resolution:** Stage 3 runs one Samsung investigation via `POST /api/investigate`; adapter `verified` flips to `true` only if `validateLocatorRun` returns VERIFIED.

### KI-002 — LG India locator renders no PIN/category input
- **Severity:** High (LG only)
- **Description:** Page config has `mapsApiKey: null`, `serviceCenterDetailsApi: null`, `zipCode: null`; the map search widget never initialises.
- **Reproduction:** Run b4eefea8; raw HTML of `lg.com/in/support/contact-us/locate-repair-center/`.
- **Status:** MITIGATED. LG adapter is `kind: "unavailable"`; investigations report `LOCATOR_UNAVAILABLE` and spend no Agent credits.
- **Resolution:** Re-test only if LG fixes the page. Do not use LG for the live demo.

### KI-003 — Samsung run lost its connection through the IN proxy
- **Severity:** High
- **Description:** `ERR_TUNNEL_CONNECTION_FAILED` after clicking "Home Appliance" (stealth + IN proxy). The real form had been reached.
- **Reproduction:** Run 090e935c, steps 8–22.
- **Status:** MITIGATED. Without the proxy, run 96040f6c had no tunnel error and stayed on samsung.com, but hit KI-023.
- **Resolution:** Verify in the Stage 3 live run; switch the proxy back on if direct access is geo-blocked.

### KI-004 — Agent left the target domain and typed a wrong PIN
- **Severity:** High
- **Description:** Agent moved to `samsungdigitalservicecenter.com` and recorded `pin_entered: "56001"`.
- **Reproduction:** Run 090e935c, steps 23–29.
- **Status:** MITIGATED. The goal says "stay on domain"; the backend rejects PIN mismatches and unapproved domains (tests 2, 3).
- **Resolution:** None further needed; the validator is authoritative.

### KI-005 — Run `status: COMPLETED` even when the task failed
- **Severity:** High
- **Description:** Both failed runs reported COMPLETED.
- **Reproduction:** Both recorded runs.
- **Status:** MITIGATED. Run execution status and evidence verification are stored separately; completion never implies verification (tests 4, 6).
- **Resolution:** —

### KI-006 — Static "no Authorized Technical Assistance" copy on the LG page
- **Severity:** High
- **Description:** Template text present before any search; parsing it would fabricate a "no service" finding.
- **Reproduction:** Fetch of the LG locator page.
- **Status:** MITIGATED. Page text is never parsed into locator results; only validated Agent output is used, and there is no `NO_SERVICE` outcome.
- **Resolution:** —

### KI-007 — Agent runs take about 5.5 minutes, even when failing
- **Severity:** High (demo, serverless limits)
- **Description:** Both runs took 5m20s–5m29s.
- **Reproduction:** Recorded runs.
- **Status:** MITIGATED. Async start + poll; `max_duration_seconds: 240`; our own 10-minute deadline with cancel.
- **Resolution:** Record a clearly labelled fallback run for the demo.

### KI-008 — Step screenshot URLs return 401 with the API key
- **Severity:** Medium
- **Description:** `agent.tinyfish.ai/runs/{id}/steps/{id}/screenshot` → 401.
- **Reproduction:** Stage 1 curl with `X-API-Key`.
- **Status:** OPEN. Screenshots are dropped by the parser; `streaming_url` is kept as `live_view_url`.
- **Resolution:** Ask TinyFish how to authenticate screenshot access, if it's needed later.

### KI-009 — Search results carry tracking params, rarely carry dates, and mix source types
- **Severity:** Medium
- **Description:** `?srsltid=` on URLs; `date` missing on 10/10 results; official, linked and third-party mixed.
- **Reproduction:** `docs/evidence/tinyfish-search-rest-samsung.json`.
- **Status:** FIXED. Canonicalisation strips tracking params; conservative domain classification; backend stamps `retrieved_at`.
- **Resolution:** —

### KI-010 — Fetch returns static content only
- **Severity:** Medium
- **Description:** No JS-rendered results, forms stripped, promo-banner noise.
- **Reproduction:** Stage 1 LG fetch (1,964 chars); Samsung fetch.
- **Status:** OPEN (by design). Fetch is used only for official policy pages and never counts as PIN-level coverage.
- **Resolution:** —

### KI-011 — `output_schema` rejects JSON-schema type arrays
- **Severity:** Low
- **Description:** `type: ["string","null"]` → HTTP 400 before the run starts.
- **Reproduction:** Stage 1 first submit.
- **Status:** FIXED. `LOCATOR_OUTPUT_SCHEMA` uses `nullable: true`.
- **Resolution:** —

### KI-012 — FeasiServe Supabase project not yet connected to the app
- **Severity:** High
- **Description:** The org (free plan) has `tale-of-suryagarh` (active), `certum` and `cognicare` (inactive). The free tier allows 2 active projects, so one more should fit.
- **Reproduction:** `GET /api/health` → `database: not_configured`.
- **Status:** MITIGATED. Project `kldfceloxqxtysggfkif` created and migrated 2026-10-31; waiting on the user to add `SUPABASE_SERVICE_ROLE_KEY` to `.env.local`.
- **Resolution:** Create the project → apply `supabase/migrations/20261031000000_init.sql` → set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` → check `/api/health`.

### KI-013 — Taste skill flagged by Socket (1 alert) and Snyk (Med)
- **Severity:** Medium
- **Description:** Scripts spawn Chrome, run a 127.0.0.1 server, download public images, and write `~/.taste-skill/history.json`.
- **Reproduction:** `npx skills add` output; pattern scan in BUILD_LOG Stage 1.5.
- **Status:** OPEN. Reviewed (pattern scan only); no scripts executed.
- **Resolution:** Run scripts only with explicit approval during the frontend stage.

### KI-014 — Our own API has no abuse protection
- **Severity:** High (before any public deploy)
- **Description:** Anyone who can reach `POST /api/investigate` can start paid TinyFish Agent runs. The duplicate-window check only stops identical repeats.
- **Reproduction:** Repeated POSTs with different PINs.
- **Status:** OPEN.
- **Resolution:** Before deploying, add a shared demo token or a simple per-IP limit stored in Supabase. Not added now (no deploy approved).

### KI-015 — Progress only advances while someone polls
- **Severity:** Medium
- **Description:** No background worker (by design, for Vercel). If nobody calls `GET /api/investigate/[id]`, searches don't start and agent results aren't collected (TinyFish keeps the run, so they're collected on the next poll).
- **Reproduction:** Create an investigation, close the tab.
- **Status:** OPEN (accepted).
- **Resolution:** If needed later, a Vercel Cron that polls `running` investigations. No new infrastructure.

### KI-016 — Possible orphaned TinyFish run if the database write fails right after start
- **Severity:** Low
- **Description:** If `startRun` succeeds but saving `external_run_id` fails, the row goes stale → `failed`, while the TinyFish run keeps going unobserved.
- **Reproduction:** Database outage between those two calls.
- **Status:** OPEN (`shortcut:` comment in `orchestrator.ts`).
- **Resolution:** Match orphaned runs via `GET /v1/runs` by goal text if this ever happens.

### KI-017 — Two simultaneous identical POSTs can create two investigations
- **Severity:** Low
- **Description:** The duplicate check is check-then-insert, not atomic. Each investigation is still internally duplicate-free.
- **Reproduction:** Two identical POSTs within milliseconds.
- **Status:** OPEN (accepted).
- **Resolution:** Partial unique index on active investigations, if needed.

### KI-018 — Supabase client retries reads with back-off when the DB is down
- **Severity:** Low
- **Description:** supabase-js retries GET/HEAD up to 3 times (1s/2s/4s), so a DB outage takes about 7 s to surface as a 503.
- **Reproduction:** Test 10 (`tests/api-routes.test.ts`).
- **Status:** OPEN (accepted, bounded).
- **Resolution:** —

### KI-019 — Domain classification lists are small and hand-curated
- **Severity:** Low
- **Description:** Unlisted domains are `unknown` (conservative). Only Samsung and LG have official/linked domains defined.
- **Reproduction:** `lib/evidence/classify.ts`, `lib/locator/adapters.ts`.
- **Status:** OPEN.
- **Resolution:** Extend per manufacturer as adapters are added, only from observed evidence.

### KI-020 — Bulk insert of investigation runs violated `metadata NOT NULL`
- **Severity:** Critical (blocked every investigation)
- **Description:** PostgREST sends null for keys missing from some rows of a bulk insert; three of four run rows had no `metadata`.
- **Reproduction:** Stage 2.5 `POST /api/investigate` → 503; server log `create runs: null value in column "metadata"`.
- **Status:** FIXED and verified live: investigation 25f330e8 created 4 runs in Supabase.
- **Resolution:** Re-verify with the approved Stage 2.5 run.

### KI-021 — In-memory test store is more forgiving than PostgREST
- **Severity:** Medium
- **Description:** Tests passed while the live DB rejected the insert. The memory store applies column defaults per row; PostgREST does not for bulk inserts.
- **Reproduction:** KI-020.
- **Status:** OPEN (mitigated by the payload test for `createRuns`).
- **Resolution:** Smoke-test new persistence paths against the real project; keep every bulk-insert row uniform (evidence and findings rows already are).

### KI-022 — Orphaned investigation row from the failed Stage 2.5 attempt
- **Severity:** Low
- **Description:** `a6baf167-7286-4218-a524-1b2aa64d12ff` has status `running` and 0 tasks (created before the fix).
- **Reproduction:** `select * from investigations`.
- **Status:** FIXED. Marked `failed` by one GET poll on the fixed build.
- **Resolution:** One GET poll under the fixed build marks it `failed` ("Investigation has no tasks"). No SQL edit needed.

### KI-023 — Samsung locator's PIN search input never renders in the TinyFish browser
- **Severity:** Critical (live locator demo)
- **Description:** Without the proxy, the Agent reached the real Samsung page, handled popups and clicked "Home Appliance", but no location input or search button appeared. The Agent attributes this to the map-API-driven widget (`fn04-map`) not loading. Same failure class as LG (KI-002: map widget never initialises). Possibly the TinyFish browser can't load or authorise the map component; not confirmed.
- **Reproduction:** Investigation `25f330e8…`, Agent run `96040f6c-6c0b-4d15-8bc5-5f54fdc687ad`.
- **Status:** MITIGATED. Samsung now defaults to the static directory (Stage 2.7); the Agent is an opt-in fallback.
- **Resolution (needs decision, not attempted):** (a) open the page in a normal browser to see whether the form needs location permission or a slow map load; (b) try `browser_profile: "lite"` or the IN proxy again; (c) look for an official, non-map entry point (e.g. city list) on samsung.com; (d) use a clearly labelled recorded fallback for the demo. Each live attempt costs one Agent run.

### KI-024 — Samsung directory is Samsung-linked, not samsung.com itself
- **Severity:** Medium
- **Description:** `servicecenter.samsungdigitalservicecenter.com` is on a domain samsung.com links to and carries Samsung branding and copyright, but a third-party platform (SingleInterface) operates it, and the direct link from samsung.com to this subdomain wasn't observed.
- **Reproduction:** `docs/evidence/stage-2.6-discovery-notes.md` §A.
- **Status:** OPEN.
- **Resolution:** Treat listings as `manufacturer_linked` evidence. "Authorised" is a self-declaration on a Samsung-linked site → at most PARTIALLY_VERIFIED, never VERIFIED authorisation.

### KI-025 — Directory has no product scope or service-area data
- **Severity:** High
- **Description:** CE listings don't state which products each centre services (sample detail page lists fridge/washer/TV tags, not AC), and there's no PIN service-area data. The directory proves a centre exists at an address, not that it services a Split AC or covers PIN 560001.
- **Reproduction:** King Cool System detail page; Bengaluru list (no 560001 entry).
- **Status:** OPEN.
- **Resolution:** Report existence and proximity only; keep AC capability and PIN coverage as separate, unverified claims.

### KI-026 — No PIN-to-location data for proximity
- **Severity:** High (Distance rating)
- **Description:** Centre coordinates are available on detail pages, but FeasiServe has no coordinates for the customer's PIN. A numeric PIN difference isn't distance.
- **Reproduction:** n/a (design gap).
- **Status:** OPEN.
- **Resolution:** Needs a decision: a public India Post PIN dataset (data.gov.in; lat/long coverage unverified) or a city-level approximation labelled as such.

### KI-027 — TinyFish Search doesn't surface the Samsung directory
- **Severity:** Low
- **Description:** A Search with `include_domains=samsungdigitalservicecenter.com` returned 0 results, while direct fetches of the same pages succeed.
- **Reproduction:** Stage 2.6 search 1.
- **Status:** OPEN.
- **Resolution:** Build directory URLs from known structure and on-page links (state → city → pages); don't depend on Search.

### KI-028 — Directory data-quality issues
- **Severity:** Low
- **Description:** Some phone numbers look truncated ("180057000000"); "open now" text differs between list and detail pages fetched minutes apart.
- **Reproduction:** `docs/evidence/stage-2.6-discovery-notes.md` §B.
- **Status:** OPEN.
- **Resolution:** Store values verbatim, don't present "open now" status, and flag non-standard phone numbers.

### KI-029 — Directory detail-page coordinates are inconsistent between fetches
- **Severity:** Medium
- **Description:** 5 of 10 detail pages in the live run had no coordinate line in the markdown text, including King Cool, which had it in Stage 2.6. Values are kept null rather than guessed.
- **Reproduction:** Investigation ff372b3b, `evidence_sources` rows with role `directory_detail_page`.
- **Status:** OPEN.
- **Resolution:** Also request `page_metadata` and read the `geo.position` meta tag (seen in Stage 2.6) as a second source. Costs no extra request, but needs a live re-check.

### KI-030 — No Bengaluru centre explicitly lists air-conditioner service
- **Severity:** High (product story)
- **Description:** All 10 retrieved detail pages tag refrigerator / washing machine / TV only. FeasiServe reports AC capability as "not stated" for all centres.
- **Reproduction:** Live run ff372b3b.
- **Status:** OPEN (reported honestly; not inferred from names like "King Cool System").
- **Resolution:** The demo should present this as a finding: "the directory does not say which centres handle ACs".

### KI-031 — Directory mapped only for Bengaluru; 10-detail-page cap
- **Severity:** Medium
- **Description:** `cityPages` only maps PIN prefix 560 (observed URLs). Other PINs → `UNSUPPORTED`. One Fetch request holds 10 detail pages, so 3 of 13 centres have no detail data.
- **Reproduction:** `lib/locator/adapters.ts` (`shortcut:` comment).
- **Status:** OPEN.
- **Resolution:** Add cities from the state page's own links; spend a third request on remaining details if the budget allows.

### KI-032 — No recorded Refrigerator investigation exists yet
- **Severity:** High (demo)
- **Description:** Refrigerator is the preferred demo category (centre pages name it), but both stored investigations are Split AC. A Refrigerator report needs one live run: 2 Search + up to 3 Fetch requests, no Agent.
- **Reproduction:** `/` → recorded list.
- **Status:** FIXED. Live run ba8aedeb (approved) is the recorded Refrigerator demo.
- **Resolution:** Run once through the app, then use it as the clearly labelled recorded fallback.

### KI-033 — Scoring rubric is a documented heuristic, not a calibrated model
- **Severity:** Medium
- **Description:** Points (50/+5/cap 70; 40/30/30) are explainable and tested but not validated against real service outcomes. Installation & warranty measures how clearly terms are documented, not how well they are honoured.
- **Reproduction:** `lib/scoring/engine.ts`.
- **Status:** OPEN (stated in each rating's limitations).
- **Resolution:** Calibrate after real usage data.

### KI-034 — Skill visual gate not run
- **Severity:** Low
- **Description:** design-taste-frontend's `inspect.mjs`/`lint.mjs` were not executed (unreviewed scripts, KI-013). The UI was checked by screenshots at desktop width only.
- **Reproduction:** n/a.
- **Status:** OPEN.
- **Resolution:** Review the scripts, then run them on the production build; check phone width.

### KI-035 — Customer-experience tone defects (negation, ambiguity, duplicates, gap wording)
- **Severity:** Medium
- **Description:** See BUILD_LOG "Stage 3 audit": 6 confirmed defects in keyword tone counting and community gap messaging.
- **Reproduction:** `tests/scoring.test.ts` → "customer experience tone (audit regressions)" (7 failed before the fix).
- **Status:** FIXED (95/95 tests).
- **Resolution:** —

### KI-036 — Keyword tone is still a heuristic
- **Severity:** Medium
- **Description:** Phrase lists plus a 1–2 word negation window can't read sarcasm, long-range negation ("I would not say it was ever resolved"), non-English posts, or search snippets that summarise many users ("Multiple users report…" counts as one source). Near-duplicate URLs (old.reddit vs www.reddit) aren't merged.
- **Reproduction:** n/a (design limit).
- **Status:** OPEN (the rating is labelled UNVERIFIED and needs ≥5 clear-tone sources before scoring).
- **Resolution:** Extend phrase lists from real posts; normalise known mirror domains.

### KI-037 — Samsung official evidence can include non-India pages
- **Severity:** High (demo accuracy)
- **Description:** Refrigerator investigation ba8aedeb fetched `samsung.com/us/home-appliances/warranty/refrigerators/` and counted it as official; its warranty quote may be US terms.
- **Status:** OPEN (not fixed: Samsung behaviour frozen this stage). Fix = set `officialRegionPath: /^\/in\//` on Samsung (images.samsung.com assets need an exception) and re-run.

### KI-038 — LG installation charges not credited
- **Severity:** Medium
- **Description:** LG's AC installation price charter sits inside the warranty-terms page; the installation criterion only credits a page whose URL/title is about installation. A line-level rule was not added because it would have changed Samsung's stored score via the US page (KI-037).
- **Status:** OPEN.

### KI-039 — LG has no service-centre evidence
- **Severity:** High
- **Description:** LG's locator is a map widget that never renders (KI-002); no static LG directory was found. LG reports always show Service availability N/A and therefore "Insufficient evidence" unless customer evidence reaches the threshold.
- **Status:** OPEN.
