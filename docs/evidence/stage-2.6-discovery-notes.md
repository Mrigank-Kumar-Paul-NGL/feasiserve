# Stage 2.6 — Service-centre discovery evidence (2026-10-31)

Retrieved with TinyFish MCP Search (3) and Fetch (3 requests, 8 URLs). No Agent runs. All pages public, no login.
Content below is transcribed from the fetched pages; nothing is inferred.

## A. Samsung official → linked directory chain
1. `https://www.samsung.com/in/support/service-center/` (official; Stage 1.5 fetch, 259 links) links to
   `https://samsungdigitalservicecenter.com/` (+ `/pickdrop`, `/bookappointment`, `/spare-part-location`).
   It does **not** link directly to `servicecenter.samsungdigitalservicecenter.com` in that evidence.
2. `https://samsungdigitalservicecenter.com/`: title "Samsung — Digital Service Center | Samsung.com"; navigation links point to samsung.com/in; WhatsApp 1-800-5-726-7864 (same helpline as samsung.com).
3. `https://servicecenter.samsungdigitalservicecenter.com/`: "Authorized Service Centers"; state/city/locality filters; 186 pages (all products, mostly mobile). Links back to `samsung.com/in/?utm_source=locator`. Footer meta: "© Copyright … 1995-2023 SAMSUNG All Rights reserved". Favicon served from `cdn4.singleinterface.com` (third-party locator platform operating the site).

## B. Samsung CE (consumer electronics / appliances) directory — static, server-rendered, paginated
- State page: `https://servicecenter.samsungdigitalservicecenter.com/ce/location/karnataka` (4 pages; 18 cities).
- City page: `https://servicecenter.samsungdigitalservicecenter.com/ce/location/karnataka/bangalore` (+ `?page=2`, last page).
- **Bengaluru: 13 "Authorised Samsung CE Service Center" listings** (name · locality · PIN):

| # | Name | Locality | PIN | Phone shown |
|---|---|---|---|---|
| 1 | R.P.Services | Marathahalli | 560037 | 180057000000 |
| 2 | King Cool System | Nayandahalli | 560039 | 180057267864 |
| 3 | Veda Tele Venture | Banaswadi | 560043 | 180057267864 |
| 4 | Sri Krishna Enterprises | Banaswadi Main Road | 560043 | 180057267864 |
| 5 | Cantto International | M P M Layout | 560056 | 180057267864 |
| 6 | R-Logic Technology Services India Pvt Ltd | Konanakunte | 560062 | 180057267864 |
| 7 | Prism Services | Doresanipalya | 560076 | 180057267864 |
| 8 | S N Enterprises | Kuvempu Nagar | 560076 | 180057000000 |
| 9 | Delta Services | Kurubarahalli | 560086 | 180057267864 |
| 10 | Digital Service | Varthur | 560087 | 180057267864 |
| 11 | L.r.enterprises | Sahakar Nagar | 560092 | 180057267864 |
| 12 | D Smart | Ideal Homes Layout | 560098 | 180057267864 |
| 13 | Teamg Solutions Pvt Limited | Anekal | 560100 | +918088660661 |

- **No listing has PIN 560001.**
- Detail page example: `…/ce/authorised-samsung-ce-service-center-king-cool-system-repair-service-nayandahalli-bengaluru-472714/Home`
  - Title "… | Official service center"; coordinates `12.952704 77.526093` (also `geo.position` meta); weekly hours; categories "Appliance Repair Service, Electronics Repair Shop…".
  - Tags list refrigerator, washing machine, TV/LED TV repair. **Air conditioners are not mentioned.**
  - Same fetch: list page said "Open until 08:00 PM", detail page said "Closed for the day" → hours status unreliable.
- "180057000000" looks like a truncated helpline number; most centres show the national helpline, not their own.

## C. Voltas (generalisability probe)
- `https://www.voltas.com/a/store-locator/karnataka/bengaluru` (official domain, static, state/city pages): lists **3 retail locations** (Voltas Experience Zone – Peak Systems Refrigeration, Ulsoor 560008; Brand Shop – Ruthvik Tejas Synergies 560061; Brand Shop – Agora Imperium 560083). The header claims "dealers, showrooms & service centers", but **no service centres are listed** for Bengaluru.
- `https://www.voltasservice.com/` "Voltas Selfcare Portal": service request / installation **requires login with a registered mobile number**.
- Search also surfaced third-party lists (justdial.com, atozservice.in) claiming "authorized" Voltas centres. Not fetched; not proof of authorisation.

## D. Searches
1. `include_domains=samsungdigitalservicecenter.com`, "Authorised Samsung CE Service Center Bengaluru 560001 air conditioner" → **0 results** (domain poorly indexed by Search; direct URL navigation via links works).
2. Generic "authorised AC service centre Bengaluru…" → Dell, LG map locator, Motorola. Not useful.
3. "Voltas air conditioner authorised service centre Bengaluru locator address" → 10 results (above).
