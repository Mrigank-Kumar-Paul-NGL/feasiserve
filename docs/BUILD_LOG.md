# FeasiServe — Build Log

## 2026-10-31 — Stage 0/1: Reconnaissance & TinyFish validation

### Repository state
- Folder was empty at Stage 0. Not a git repo.
- Now contains only: `.agents/skills/design-taste-frontend/` (Taste skill, installed by user via `npx skills add Leonxlnx/taste-skill`), `.claude/skills/design-taste-frontend` (symlink), `skills-lock.json`, and `docs/`.
- No application code yet. Toolchain: Node 24.21.0, npm 11.19.0.

### Stack (unchanged, decided)
Next.js + React + TS + Tailwind · Next.js server routes · Supabase Postgres · TinyFish Agent/Search/Fetch · deterministic TS scoring · Vercel.

### TinyFish runtime integration (VERIFIED from docs + one live call)
All three are plain HTTPS with header `X-API-Key: $TINYFISH_API_KEY`. Official TS SDK `@tiny-fish/sdk` exists but is optional — `fetch()` is enough.

| Surface | Call | Notes |
|---|---|---|
| Agent (start) | `POST https://agent.tinyfish.ai/v1/automation/run-async` | returns `{run_id, error}` immediately |
| Agent (status) | `GET https://agent.tinyfish.ai/v1/runs/{id}` | `status`: PENDING/RUNNING/COMPLETED/FAILED/CANCELLED, `result`, `error`, `steps[]`, `streaming_url` |
| Agent (cancel) | `POST https://agent.tinyfish.ai/v1/runs/{id}/cancel` | |
| Agent (stream) | `POST .../v1/automation/run-sse` | events STARTED, STREAMING_URL, PROGRESS, HEARTBEAT, COMPLETE |
| Search | `GET https://api.search.tinyfish.ai?query=…&location=IN` | `{results:[{position,site_name,title,snippet,url,date?}]}` · free 12k/day · 30 req/min |
| Fetch | `POST https://api.fetch.tinyfish.ai` `{urls[≤10],format}` | `{results:[{url,final_url,title,text,links?}],errors:[{url,error}]}` · free 1k URLs/day · strips forms/scripts |

Agent request body used: `url`, `goal`, `browser_profile:"stealth"`, `proxy_config:{enabled:true,type:"tinyfish",country_code:"IN"}`, `agent_config:{max_duration_seconds:300}`, `output_schema` (JSON-schema subset).

**Gotcha found:** `output_schema` rejects `type: ["string","null"]` (HTTP 400, validated before run starts). Use `type:"string", nullable:true`.

### Live test — LG / Split AC / 560001
- Request: `docs/evidence/tinyfish-request-lg-560001.json`
- Full run record: `docs/evidence/tinyfish-run-lg-560001-b4eefea8.json`
- Run `b4eefea8-31b5-499d-ba9b-2192582cbcaf`: queued 07:46:27Z, finished 07:51:48Z (~5m20s), 27 steps, status `COMPLETED`, India proxy.
- Agent **did navigate** the real LG India locator, dismissed popups, tried chatbot, site search, repair-request page, hover menus, reloaded the locator.
- Agent **did NOT** select a category or submit the PIN. `search_submitted:false`, `service_centers:[]`. It reported honestly that no PIN/category input rendered.
- **This is a failed investigation, not evidence that no service exists.**

### Diagnosis (raw HTML inspected once with curl, read-only)
- The locator component (`lge-support-repo/components/findaservicecenter`) ships config with `"mapsApiKey": null`, `"serviceCenterDetailsApi": null`, `"zipCode": null`. The Google-Maps-based search widget likely cannot initialise → no input field ever renders.
- The "Unfortunately, we did not find any Authorized Technical Assistance…" text is static template copy present in the page HTML before any search — must never be parsed as a result.
- Page declares backend endpoints `/ncms/api/v1/support/proxy/findServiceCenterDetail?locale=IN…` and `findServiceCenterPage`. Not called (undocumented, not TinyFish).

### Supabase (VERIFIED via MCP)
3 projects in account: `tale-of-suryagarh` (active), `certum` (inactive), `cognicare` (inactive). **No FeasiServe project.** No `SUPABASE_*` env vars.

### Vercel (VERIFIED from docs)
Hobby functions: 300 s max. One agent run took ~320 s → a single blocking route would time out. Async start + client polling fits (each request is short).

---

## 2026-10-31 — Stage 1.5: TinyFish REST validation completion

### Search REST — VERIFIED
- `GET https://api.search.tinyfish.ai?query=Samsung India authorised AC service center locator&location=IN&language=en`, header `X-API-Key`.
- HTTP 200, 1.85 s. Headers: `x-request-id`, `x-ratelimit-limit: 30`, `x-ratelimit-remaining`, `x-ratelimit-reset`.
- Body (identical shape to MCP): `{query, results:[{position, site_name, title, snippet, url, date?}], total_results, page}`. 10 results.
- Evidence: `docs/evidence/tinyfish-search-rest-samsung.json`.
- Observations: Google-style `?srsltid=` tracking params on samsung.com URLs (strip before storing/fetching). `date` absent on all 10 results. Mix of official (`samsung.com`), Samsung-linked (`samsungdigitalservicecenter.com`, linked from samsung.com's own page) and third-party (`24x7homeservice.com`, `indiacustomercare.com`) — backend must classify domains.

### Fetch REST — VERIFIED (with limits)
- `POST https://api.fetch.tinyfish.ai` `{"urls":["https://www.samsung.com/in/support/service-center/"],"format":"markdown","links":true,"iframe_links":true,"include_etag_and_last_modified":true}`.
- HTTP 200, 3.6 s (latency_ms 2300). Body `{results:[…], errors:[]}`.
- Result fields seen: `url, final_url, title, description, language, author(null), published_date ("2026-08-13"), latency_ms, format, etag, last_modified, text (3442 chars markdown), links (259), iframe_links ([])`.
- Content quality: clean. Category tree (Home Appliance > Air Conditioner), "How to search" steps, helplines (1800-5-7267864), Pick & Drop Rs 199 offer — usable as *official promise* evidence.
- Limits: no dynamic results (locator results need Agent); promo-banner noise; no timestamp of retrieval (backend must stamp); forms/scripts stripped.
- Evidence: `docs/evidence/tinyfish-fetch-rest-samsung-service-center.json`.

### Agent — Samsung / Split AC / 560001 — FAILED (infrastructure)
- Request: `docs/evidence/tinyfish-request-samsung-560001.json`; run: `docs/evidence/tinyfish-run-samsung-560001-090e935c.json`.
- Run `090e935c-e918-4319-a19a-cc6ab0f1428f`: 07:58:44Z → 08:04:13Z (~5m29s), 31 steps, `status: COMPLETED`, stealth + IN proxy.
- Steps 0–7: loaded samsung.com locator, closed coupon popup, found the form, clicked "Home Appliance" tab (34.5 s step).
- Steps 8–22: repeated reloads; agent reports `ERR_TUNNEL_CONNECTION_FAILED` (proxy tunnel error — not a Samsung response).
- Steps 23–29: agent self-diverted to `servicecenter.samsungdigitalservicecenter.com` (state/city/locality form only), recorded `pin_entered: "56001"` (wrong PIN), no results.
- Final result: `search_submitted:false`, `service_centers:[]`. **Not evidence of unavailable service.** Stopped per instructions; no retry.
- Step object keys: `id, timestamp, status, action, screenshot, html, duration`.

### Lessons for backend validation (VERIFIED by these runs)
1. Run `status: COMPLETED` ≠ task success. Success must be judged from `result.search_submitted` + non-empty data.
2. Agent echo fields must be checked against inputs (`pin_entered` "56001" ≠ "560001" → reject).
3. Agent may wander to other domains; check `results_page_url` host against an allow-list.
4. Both runs ran ~5.5 min to failure → set lower `max_duration_seconds` and/or stricter goal ("do not leave domain X; stop if page fails to load twice").

### Taste skill security review (read-only, no scripts executed)
- Lock: `skills-lock.json` → source `Leonxlnx/taste-skill`, hash `53590ee9…2b90`.
- Content: SKILL.md, README, `library/`(9), `references/`(11), `assets/`(6), `evals/`(1), `scripts/`(10 `.mjs`, ~319 KB).
- Script behaviour found by pattern scan: `lib/cdp.mjs` spawns local Chrome via `child_process`; `inspect.mjs` serves files on `127.0.0.1` and runs `page.eval()` **inside the headless browser** (CDP), not Node `eval`; `assets.mjs` downloads images from public archives (Openverse, Wikimedia, Met, Art Institute, archive.org, NASA); `draw.mjs` uses picsum.photos and writes `~/.taste-skill/history.json`. No credential/env harvesting or unknown hosts seen. Likely source of Socket/Snyk flags: child_process + network + fs writes.
- Not a full audit. Policy: SKILL.md guidance OK to read; run scripts only with explicit approval.

### Supabase — requirements for a dedicated project (not created)
- Org: `wxzpspdxkywpklgywslq` (existing). Create project `feasiserve`, region `ap-south-1` (Mumbai, closest to India users).
- Free-plan note: org already has 3 projects (1 active, 2 inactive/paused); free tier allows 2 active — verify cost/limits before creating.
- App runtime needs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (or publishable key), `SUPABASE_SERVICE_ROLE_KEY` (server-only, for writes from routes).
- Schema (to apply via migration later): `investigations`, `investigation_tasks` (incl. `tinyfish_run_id`, status), `evidence`, `scores`. RLS on; server writes with service role.

---

## 2026-10-31 (~13:40–14:05 IST) — Stage 2: Application foundation & investigation infrastructure

### Files created
- Config: `package.json`, `package-lock.json`, `tsconfig.json` (strict, `noUncheckedIndexedAccess`), `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example` (names only).
- DB: `supabase/migrations/20261031000000_init.sql`.
- App: `app/layout.tsx`, `app/page.tsx`, `app/investigation-console.tsx` (minimal client console), `app/globals.css`, `app/api/investigate/route.ts`, `app/api/investigate/[id]/route.ts`, `app/api/health/route.ts`.
- Lib: `lib/env.ts`; `lib/supabase/{types,store}.ts`; `lib/tinyfish/{http,search,fetch,agent}.ts`; `lib/evidence/{url,classify}.ts`; `lib/locator/{adapters,agent-locator,validate}.ts`; `lib/investigation/{input,store,orchestrator,view,deps}.ts`.
- Tests: `tests/{locator-validation,tinyfish-clients,orchestrator,api-routes}.test.ts`, `tests/fixtures/index.ts`, `tests/helpers/{memory-store,harness}.ts`.
- Modified: `docs/BUILD_LOG.md`, `docs/KNOWN_ISSUES.md` (renumbered KI-001…KI-019, all prior issues kept).
- Untouched: `.agents/`, `.claude/skills/` (symlink intact), `skills-lock.json`, `docs/evidence/*`.

### Dependencies (npm 11.19 / Node 24.21; `npm audit`: 0 vulnerabilities)
| Package | Version | Why |
|---|---|---|
| next / react / react-dom | 16.4.3 / 19.3.1 / 19.3.1 | Locked stack |
| @supabase/supabase-js | 2.118.0 | Supabase PostgreSQL access (server-only, service role) |
| typescript | 5.9.3 | Pinned to 5.x; 7.0 (native compiler) not assumed compatible with Next 16 |
| @types/node, @types/react, @types/react-dom | 24 / 19 / 19 | Types |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | Locked stack (v4) |
| vitest | 5.0.5 | Test runner (required: automated tests with mocks) |
Not added: zod (hand-written validation is ~20 lines), server-only (no `NEXT_PUBLIC_` secrets; client-bundle scan below), TinyFish SDK (plain fetch works), any LLM SDK.

### Architecture implemented
- **Adapters** (`lib/locator/adapters.ts`): per-manufacturer official domains, linked domains, locator strategy. Samsung = `tinyfish_agent`, `verified:false`, no proxy. LG = `unavailable` (KI-002). Unknown brand = `UNSUPPORTED`.
- **Validator** (`lib/locator/validate.ts`): exact PIN match, approved-domain check (true subdomains only), submitted-search check, structural centre validation, `ERR_*` navigation detection. States VERIFIED / PARTIALLY_VERIFIED / UNVERIFIED / FAILED. There is no `NO_SERVICE` outcome; an empty verified search is `NO_CENTERS_RETURNED` + PARTIALLY_VERIFIED.
- **Orchestrator** (`lib/investigation/orchestrator.ts`): 4 runs per investigation (`search_official`, `search_community`, `fetch_official`, `locator_agent`). POST creates rows and starts only the Agent; each GET advances every unfinished task one bounded step. Duplicate protection: DB unique `(investigation_id, operation)`, atomic status claims (`UPDATE … WHERE status = from`), evidence de-dupe on `(investigation_id, retrieval_method, canonical_url)`, duplicate-POST window of 10 min. Retries: max 3, back-off ≥5 s × attempt or `Retry-After`; Agent start retried only on 429 (a timeout may have created a run). Agent deadline 10 min → `timed_out` + cancel. Stale `running` tasks (>3 min) → `failed`. Investigation `completed` only if nothing failed **and** the locator is VERIFIED; otherwise `partial` / `failed` with `error_summary`.
- **Evidence**: every row keeps original URL, canonical URL, domain, source type, method, `retrieved_at`, content (≤50k chars, truncation flagged) and metadata. Locator evidence also keeps expected/returned PIN, search_submitted, domain_approved, result domain, structural validity, verification, outcome, reasons, agent run id, steps, provider status/error.
- **Security**: TinyFish and Supabase are server-only; key only in the `X-API-Key` header; client view strips `metadata.last_error` and provider bodies; inputs validated (PIN `^[1-9][0-9]{5}$`, length and charset limits, 4 KB body cap, UUID path check, run-id allow-list).

### Database operations
- None executed. Migration written, not applied (no project; KI-012). No changes to tale-of-suryagarh / certum / cognicare.
- Supabase checks (MCP, read-only): org `wxzpspdxkywpklgywslq` plan **free**; 1 active + 2 inactive projects; no FeasiServe project.

### Commands executed
`npm view …` (versions) · `npm install …` (above) · `npx tsc --noEmit` · `npx vitest run` · `npx next build` · `npx next start -p 3107` + curl smoke test (stopped afterwards) · grep of `.next/static` for secrets.
No TinyFish calls (live or otherwise) were made in this stage.

### Results
- **Tests:** 44/44 passed, 4 files (~7 s). Covers all 12 required cases. Recorded fixtures: LG b4eefea8 (not submitted), Samsung 090e935c (tunnel failure, wrong PIN), Search and Fetch REST responses. Synthetic fixtures: successful locator outputs, centres named `SYNTHETIC TEST CENTRE …`.
- **Type-check:** `tsc --noEmit` exit 0.
- **Build:** `next build` OK. Routes: `/` static; `/api/health`, `/api/investigate`, `/api/investigate/[id]` dynamic.
- **Client bundle:** 0 matches for `TINYFISH_API_KEY | SERVICE_ROLE | tinyfish.ai | X-API-Key` in `.next/static`.
- **Smoke test (real server, no DB configured):** `/api/health` 503 `{tinyfish_key_configured:true, database:"not_configured"}`; invalid PIN 400 with field error; valid POST 503 "Service is not configured"; GET 503; `/` 200.

### Working vs scaffolded
- Working (tested with mocks/recordings): input validation, TinyFish REST clients + error mapping, canonicalisation/classification, locator validation, orchestration state machine, retry/dedupe/timeout logic, client view, error responses.
- Not yet proven live: Supabase store (no project), end-to-end investigation, Samsung locator without proxy, `maxDuration` behaviour on Vercel.

### Outstanding blockers
KI-012 (Supabase project approval), KI-001 (live locator verification), KI-014 (abuse protection before deploy).

### Supabase — created and migrated (user approved, 2026-10-31)
- Project `feasiserve`, ref `kldfceloxqxtysggfkif`, region ap-south-1, org `wxzpspdxkywpklgywslq` (free). Status ACTIVE_HEALTHY. URL `https://kldfceloxqxtysggfkif.supabase.co`.
- Migration `init` applied via MCP (same SQL as `supabase/migrations/20261031000000_init.sql`). Tables: investigations, investigation_runs, evidence_sources, findings (RLS on, 0 rows).
- Security advisor: only INFO `rls_enabled_no_policy` ×4. Intended (deny-all for anon/authenticated; server uses service role).
- `.env.local` created (gitignored) with `SUPABASE_URL`; `SUPABASE_SERVICE_ROLE_KEY` left blank for the user to paste (the connector does not expose secret keys).
- Not yet verified from the app: `/api/health` → `database: ok` needs the service-role key.
- Other projects (tale-of-suryagarh, certum, cognicare) untouched.

---

## 2026-10-31 (~08:38–08:45Z) — Stage 2.5: First end-to-end live investigation — HALTED before the Agent

### Pre-flight (all passed)
- `/api/health` 200 `{ok:true, tinyfish_key_configured:true, database:"ok"}` (key value never printed).
- Samsung adapter: `proxyCountry: null`, `officialDomains: ["samsung.com"]`, `verified: false`; "Split Air Conditioner" → hint "Home Appliance > Air Conditioner".
- Validation rules unchanged: exact PIN, approved domain (true subdomains), search_submitted, structural centres, `ERR_*` detection. Agent cap 240 s, backend deadline 10 min.
- Polling path: GET unknown UUID → 404 (DB read OK). Validation path: PIN `56001` → 400.

### Execution
- `POST /api/investigate` `{brand:"Samsung", product_category:"Split Air Conditioner", pincode:"560001"}` → **HTTP 503 "Database unavailable, please retry"**.
- Server log: `StoreError: create runs: null value in column "metadata" of relation "investigation_runs" violates not-null constraint`.
- **Root cause:** PostgREST bulk insert uses the union of keys across rows and sends `null` (not DEFAULT) for missing ones. Only the locator row carried `metadata`, so the other three rows sent null. The in-memory test store didn't model this, so the Stage 2 tests missed it.
- **Agent NOT launched.** Failure happened at task creation, before `startRun`. TinyFish `list_runs` since 08:30Z → 0 runs. No credits used.
- DB state: 1 row in `investigations` (`a6baf167-7286-4218-a524-1b2aa64d12ff`, status `running`, created 08:40:38Z), 0 runs, 0 evidence, 0 findings.

### Fix (scoped to this failure)
- `lib/supabase/store.ts` `createRuns`: every row sends an explicit `metadata` (`{}` default).
- `lib/investigation/orchestrator.ts`: if task creation fails, the investigation is marked `failed` (it no longer lingers as `running` or blocks resubmission via the duplicate window); `deriveStatus([])` → `failed` (previously would have been `completed`).
- New `tests/supabase-store.test.ts` (3 tests): captures the actual insert payload; init-failure handling; zero-task status.
- Results: `tsc` OK; **47/47 tests pass**; `next build` OK.

### Status
Stopped per the stage rule ("if an essential precondition fails, STOP without launching the Agent"). Waiting for approval to run the single Agent investigation on the fixed build. The orphan row will be marked `failed` by one normal GET poll under the fixed code.

### Stage 2.5 — approved run on the fixed build (08:43–08:47Z)
- Orphan `a6baf167…` closed out by one normal GET → `failed` ("Investigation has no tasks").
- `POST /api/investigate` → **202**, investigation **`25f330e8-19f7-4095-b307-a2d824378d21`**, `reused:false`.
- Polled `GET /api/investigate/[id]` every 10 s (26 polls); final **`partial`** after ~257 s. `error_summary`: "Service locator investigation: result UNVERIFIED".
- **TinyFish Agent run `96040f6c-6c0b-4d15-8bc5-5f54fdc687ad`** (the only one): provider `COMPLETED`, 38 steps, 08:43:19Z → 08:47:31Z, `provider_error: null`, streaming URL saved in evidence metadata. No proxy, stealth profile.
- Agent behaviour: stayed on `www.samsung.com/in/support/service-center/` the whole time (no domain drift, no `ERR_*`); closed the coupon, AI-offer and cookie popups; clicked "Home Appliance" (tab10005) more than once; scrolled; reloaded. It reported that **no PIN/location input or search button ever rendered**. Its words: "the search functionality relies on a dynamically loaded map API (fn04-map) and the input field is not rendered".
- Agent output: `search_submitted:false`, `pin_entered:""`, `category_selected:""`, `results_page_url:""`, `service_centers:[]`.
- **Backend validation: UNVERIFIED / NOT_VERIFIED.** Reasons: "Agent did not confirm the locator search was submitted"; "Submitted PIN "" does not match expected "560001"". `domainApproved:null` (no result URL), `resultsStructurallyValid:true` (empty array). The finding claim says availability is **unknown**, not absent.
- Other tasks: official search succeeded (3 results, include_domains samsung.com); community search succeeded (3 results; reddit.com as community, 1 samsung.com, 1 duplicate skipped); fetch of 3 official pages succeeded.
- **Persisted in Supabase:** 4 runs, 9 evidence rows (search 5 = official 4 + community 1; fetch 3 official; agent 1), 1 finding (`locator_result`, UNVERIFIED). Verified by SQL.
- Evidence files: `docs/evidence/e2e-investigation-25f330e8-samsung-560001-view.json`, `docs/evidence/e2e-investigation-25f330e8-poll-log.txt`.
- **Adapter:** stays `verified:false`. Not changed.
- TinyFish usage this stage: 1 Agent run; 2 Search + 1 Fetch (3 URLs) as part of the normal flow; 1 `list_runs` check (read-only).

---

## 2026-10-31 — Stage 2.6: Service-centre discovery feasibility (investigation only)

- No code, schema, scoring or dependency changes. No Agent runs. No investigation submissions.
- TinyFish usage: 3 Search + 3 Fetch requests (8 URLs) via MCP. Raw findings: `docs/evidence/stage-2.6-discovery-notes.md`.

### Key findings
1. **Samsung has a static, map-free directory**: `servicecenter.samsungdigitalservicecenter.com/ce/location/<state>/<city>`. It's server-rendered and paginated with no login. Bengaluru: 13 "Authorised Samsung CE Service Center" listings with name, street address, locality, city and PIN. Detail pages add lat/long and weekly hours. Fetch extracts it cleanly (markdown, ~1–14 s per page).
2. **Provenance:** samsung.com/in/support/service-center → samsungdigitalservicecenter.com ("Samsung — Digital Service Center | Samsung.com") → same registrable domain hosts the `servicecenter.` directory (Samsung copyright meta, links back to samsung.com, operated on the SingleInterface platform). Samsung-linked, not samsung.com itself. The direct link from samsung.com to the `servicecenter.` subdomain was **not** observed.
3. **Gaps:** no centre at PIN 560001; no per-centre product list (example detail page tags fridge/washer/TV, not AC); no service-area / PIN coverage data; hours status inconsistent between list and detail; most phones are the national helpline.
4. **Search can't find the directory** (0 results with include_domains). Discovery must go through known URL structure and links, not Search.
5. **Voltas:** official static locator exists (`voltas.com/a/store-locator/<state>/<city>`) but lists retail stores only for Bengaluru; the service portal needs a login. Weaker than Samsung for service-centre discovery.

### Recommendation
CONDITIONAL GO for Samsung via the static directory (Fetch), not the map locator. Proposed next step (not implemented): a `static_directory` locator strategy. Details in the Stage 2.6 report.

---

## 2026-10-31 (~08:55–09:10Z) — Stage 2.7: Samsung static-directory discovery

### Files
- New: `lib/locator/directory.ts` (pure parsers), `tests/directory.test.ts` (17 tests), `tests/fixtures/samsung-directory.ts` (recorded Stage 2.6 pages + labelled SYNTHETIC variants), `tests/live/samsung-directory.live.ts`, `vitest.live.config.ts`, `supabase/migrations/20261031020000_locator_directory.sql`.
- Modified: `lib/locator/adapters.ts` (new `static_directory` strategy = Samsung default; Agent kept as `agentFallback`, opt-in via `FEASISERVE_LOCATOR_FALLBACK=agent`), `lib/locator/agent-locator.ts` (takes the strategy explicitly), `lib/tinyfish/fetch.ts` (optional `links`), `lib/investigation/orchestrator.ts` (`locator_directory` task, `runDirectory`, generic locator handling), `lib/investigation/view.ts` (strategy field), `lib/supabase/types.ts` (new operation), `app/investigation-console.tsx` (centre panel; raw JSON moved into a collapsible), `tests/orchestrator.test.ts` (enables the Agent fallback for the Agent-path tests).
- No new dependencies.

### Database
- Migration `locator_directory` applied: `investigation_runs_operation_check` now allows `locator_directory`. Constraint swap only; no data touched.

### Live check (1 directory-only investigation, real orchestrator + Supabase)
- Investigation `ff372b3b-f7b3-4835-bfa0-683e3032d492` (Samsung / Split Air Conditioner / 560001). Only a `locator_directory` task (no searches, no Agent; guarded in the script).
- **TinyFish Fetch requests: 2** (city pages ×2 with links; 10 detail pages). Search 0, Agent 0.
- Result: run `succeeded`; investigation `partial` ("Service centre directory: result PARTIALLY_VERIFIED").
- **13 centres extracted** (all with valid PINs 560037–560100; none in 560001). 13/13 matched a detail link; 10 detail pages fetched (cap); 3 without details.
- **Coordinates: 5 of 10** detail pages (R-Logic, Prism, S N Enterprises, Delta, Digital Service). The other 5, including King Cool (which had coordinates in Stage 2.6), had no coordinate line in this fetch's text → stored as null.
- **AC explicitly listed: 0 of 13.** All 10 detail pages list refrigerator / washing machine / TV only → `ac_service: "not_stated"` (not "not supported").
- Persisted: 12 evidence rows (2 city + 10 detail, all `manufacturer_linked`, `tinyfish_fetch`, with `retrieved_at`), 14 findings (1 `locator_result` + 13 `service_center`, all PARTIALLY_VERIFIED). Served correctly by `GET /api/investigate/ff372b3b…` on the production build.

### Results
- Tests: **64/64** (6 files). `tsc` clean. `next build` OK.

---

## 2026-10-31 (~09:15–09:50Z) — Stage 3: Scoring engine and report UI

### Scoring engine (`lib/scoring/engine.ts`, pure, deterministic)
- S = 0.20D + 0.15R + 0.35A + 0.30I, renormalised over scored ratings. N/A is `null`, never 0.
- Overall score only if ≥2 ratings are scored **and** they carry ≥50% of the weight; otherwise "Insufficient evidence" with the reason.
- Coverage (scored weight) and verification confidence (weighted VERIFIED=1 / PARTIALLY=0.5 / UNVERIFIED=0 → High ≥0.8, Moderate ≥0.5, Low) are reported separately from the score.
- **Distance:** always N/A for now (no PIN coordinates; KI-026).
- **Customer experience:** N/A below 5 community sources; above that, a deterministic keyword tally, marked UNVERIFIED.
- **Service availability:** directory → only centres whose own page *names* the product count. 50 + 5 per extra centre, **capped at 70** (self-declared authorisation, city-level). Never VERIFIED. 0 explicit → N/A ("not stated ≠ not offered"). Official locator VERIFIED → 90; anything else N/A.
- **Installation & warranty:** official-site pages only. 40 warranty terms cover the product + 30 a stated duration on a line naming the product + 30 an official installation page for the product. Address-level eligibility always listed as not established.
- Also builds Promise vs Reality (official quotes / network facts / customer posts + deterministic gaps), community assessment, recommendations (helpline quoted only from an official source), unresolved questions.
- Attached server-side as `report` on `GET /api/investigate/[id]`.

### UI
- `/`: start form (Samsung; Refrigerator default; PIN) + recorded investigations from Supabase.
- `/report/[id]`: polls the API; live vs **Recorded investigation** badge (already finished when opened); score or amber "Insufficient evidence"; coverage bar; confidence; four rating cards with criteria, points and limitations; centres table (products named, category status, coordinates, source link, retrieval time); Promise vs Reality; community; recommendations; unresolved; evidence sources; investigation log.
- Design: design-taste-frontend `references/app-screens.md` rules (no-sidebar report shell, one face (IBM Plex Sans via next/font), tone steps instead of shadows or gradients, amber only for uncertainty). **Skill scripts were not run** (draw/inspect/lint unreviewed); visual check done by screenshot in Chrome instead.
- Motion (`motion@14.9.0`, new dependency, requested): section reveal, rating-card stagger, score count-up; `MotionConfig reducedMotion="user"` plus `useReducedMotion` for the count-up.
- Removed `app/investigation-console.tsx` (replaced by start form + report).

### Verified on recorded data (production build)
- 25f330e8 (Split AC, full run): Installation & warranty 100 (VERIFIED, quotes "10 year compressor warranty"); availability N/A (locator UNVERIFIED); overall **Insufficient evidence** (30% weight); confidence High for what was rated.
- ff372b3b (Split AC, directory only): availability N/A ("13 listed, none names air conditioner"); everything else N/A; **Insufficient evidence**.

### Results
- Tests **85/85** (7 files; +21 scoring tests). `tsc` clean. `next build` OK.
- No TinyFish calls, no Agent runs, no DB changes in this stage.

### Live Refrigerator investigation (approved, ~09:45Z)
- `POST /api/investigate` Samsung / Refrigerator / 560001 → 202, **`ba8aedeb-f951-4f56-aca2-404676607eea`**; finished `partial` on the first poll.
- TinyFish usage: 2 Search + 3 Fetch requests (official pages ×1, directory city pages ×1, directory details ×1). No Agent.
- 28 evidence rows (search: 5 official, 5 community, 3 unclassified; fetch: 3 official, 12 Samsung-linked directory).
- Report: **overall 70/100**, coverage 65%, confidence **Moderate (0.73)**.
  - Service availability 70 (PARTIALLY_VERIFIED): 10 of 13 Bengaluru centres name refrigerator service; capped.
  - Installation & warranty 70 (VERIFIED): warranty terms + duration ("standard 1-year manufacturer's warranty, plus extended coverage of up to 10 years…") on samsung.com; no official refrigerator installation page retrieved.
  - Distance N/A; Customer experience N/A (5 posts, too few with a clear tone).
- Fixes after reading it: negative keyword list missed "delays" (plural); community wording for the ≥5-posts-but-unclear case. +1 test. Score unchanged.
- Final: tests **86/86**, `tsc` clean, `next build` OK.

---

## 2026-10-31 — Stage 3 audit: customer-experience tone and community messaging

### Findings (inspected on disk, not from the transcript)
- The "malformed regex" seen earlier was a node edit script that **failed and changed nothing** ("missing …" error); the follow-up Edit tool change applied correctly. No malformed code remained.
- Confirmed logic defects in `rateExperience` / `buildReport`:
  1. "not resolved" matched NEG **and** POS ("resolved") → a clearly negative post scored neutral.
  2. Negated positives ("not helpful", "never got fixed", "not very satisfactory") counted as positive.
  3. Ambiguous single words gave false positives/negatives: "quick question", "fixed price", "prompt", "no waiting".
  4. Plural/-ing forms missed: "complaints", "delaying".
  5. Duplicate community rows (same canonical URL) counted as separate sources.
  6. Promise vs Reality gap keyed on post count, not on the rating: with ≥5 posts but no clear tone, the rating was N/A and the gap was silent.
- Test review: the recently added "unclear tone" test was correct but weak (no gap check). Two assertions I wrote during this audit were themselves wrong (a non-tie labelled as a tie; a gap expected without any official promise) and were corrected before the fix was judged.

### Changes (`lib/scoring/engine.ts` only; weights, thresholds, UI and stored evidence untouched)
- New exported `toneOf(text)`: phrase-level NEG/POS patterns; negative phrases removed before positives are read; a negator in the 1–2 preceding words flips a positive to negative and cancels a negative ("no complaints").
- `rateExperience`: one source per canonical URL; neutral sources counted for nothing.
- Gap message now depends on the Experience rating being N/A, with distinct wording for "too few posts" and "no clear tone".

### Tests
- +9 tests in `tests/scoring.test.ts` ("customer experience tone (audit regressions)") + a gap assertion on the existing unclear-tone test. 7 failed before the fix, all pass after.
- Full suite **95/95**, `tsc` clean, `next build` OK.
- Recomputed from stored evidence (no TinyFish calls): Refrigerator ba8aedeb still **70/100** (experience N/A: 3 of 5 posts with a clear tone); new gap line now shown. Split AC 25f330e8 unchanged.

---

## 2026-10-31 — LG India as second manufacturer
- Feasibility: 1 TinyFish Fetch (6 LG URLs, 0 errors; `docs/evidence/lg-support-fetch-summary.json`). `/in/support/warranty-terms/` (171k chars) holds per-product warranty tables + clauses, exclusions, in-home/carry-in terms, AC installation price charter, Authorized Service Center statement. contact-us: WhatsApp/call channels + link to the (broken) locator. Other 4 pages are 1-1.4k-char shells.
- Changes: LG adapter gets `officialPages` (6 URLs, fetched fresh every run) and `officialRegionPath` /^\/in\// (lg.com pages outside /in/ → "unknown"); `runFetch` fetches adapter pages + search results (≤10, one request; Samsung unchanged: no pages → top 3 search); engine credits warranty durations under the product's section heading ("Purchase …" sub-headings keep the section; any other heading ends it); LG in the form; report explains a skipped locator.
- No interactive map existed in the report; none removed. Locator for LG stays `unavailable` (KI-002).
- Live LG Refrigerator 8e7280b7: installation & warranty 70 VERIFIED (quotes from lg.com/in/support/warranty-terms/), availability/distance/experience N/A, overall "Insufficient evidence". Surfaced lg.com/ca_en/ stored as official → fixed by the region rule (stored row left untouched).
- Samsung recomputed after changes: Refrigerator 70 (A70/I70), Split AC insufficient (I100), directory-only insufficient — unchanged.
- Tests 107/107 (+12 LG), tsc clean, build OK.
