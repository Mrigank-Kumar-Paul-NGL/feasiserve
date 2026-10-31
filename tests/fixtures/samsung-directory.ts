// RECORDED: verbatim TinyFish Fetch (markdown) output from Stage 2.6 (2026-10-31), see docs/evidence/stage-2.6-discovery-notes.md.
//  - BANGALORE_P1_TEXT / BANGALORE_P2_TEXT: .../ce/location/karnataka/bangalore (+ ?page=2), tail of each page.
//  - KARNATAKA_LINKS: links:true output of .../ce/location/karnataka, whose first page lists the same 10 centres
//    as Bengaluru page 1 (the Bengaluru pages were fetched without links in Stage 2.6).
//  - KING_COOL_DETAIL_TEXT: detail page of King Cool System (start + key sections).
// SYNTHETIC: anything named SYNTHETIC_* is invented for edge cases and never shown as real data.
import type { FetchResponse } from "@/lib/tinyfish/fetch";

const D = "https://servicecenter.samsungdigitalservicecenter.com/ce";
export const BANGALORE_P1_URL = `${D}/location/karnataka/bangalore`;
export const BANGALORE_P2_URL = `${D}/location/karnataka/bangalore?page=2`;
export const KING_COOL_URL = `${D}/authorised-samsung-ce-service-center-king-cool-system-repair-service-nayandahalli-bengaluru-472714/Home`;

export const BANGALORE_P1_TEXT = `Authorized Service Centers
Locate the nearest service center
Search Nearby
Advanced Search
Search
City
All
Bengaluru
Belgaum
Locality
All
Anekal
Banaswadi
Search
Service Centers In Bengaluru, Karnataka
Authorised Samsung CE Service Center - R.P.Services
No 1347, Flat No 002, GF, Pavan Heights
Marathahalli
Bengaluru
-
560037
180057000000
Open until 08:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - King Cool System
No 96, Ground Floor, 6th Cross
Nayandahalli
Bengaluru
-
560039
180057267864
Open until 08:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Veda Tele Venture
No 22, Mathrushree Apartment, 2nd Main, Gopal Reddy Layout
Banaswadi
Bengaluru
-
560043
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Sri Krishna Enterprises
No 15A, Gr Floor, Shobha Arcade Complex
Banaswadi Main Road
Bengaluru
-
560043
180057267864
Open until 08:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Cantto International
No 368, 1st Floor, Gvk Arcade
M P M Layout
Bengaluru
-
560056
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - R-Logic Technology Services India Pvt Ltd
No 19, Srinivasa Industrial Estate, Kanakpura Road
Konanakunte
Bengaluru
-
560062
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Prism Services
No 159/2, 4th Cross, Bannergatta Road
Doresanipalya
Bengaluru
-
560076
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - S N Enterprises
No 8, New No 8/1, Ground Floor, BTM Layout Stage 2
Kuvempu Nagar
Bengaluru
-
560076
Near 28th Main Road
180057000000
Open until 08:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Delta Services
No 121, Ground Floor, 24th Main Road, JC Nagar
Kurubarahalli
Bengaluru
-
560086
180057267864
Open until 08:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Digital Service
No 634, Madhura Nagar, Hobli
Varthur
Bengaluru
-
560087
180057267864
Open until 08:00 PM
Call
Map
Website
Directions
1
2
Next
Last`;

export const BANGALORE_P2_TEXT = `Service Centers In Bengaluru, Karnataka
Authorised Samsung CE Service Center - L.r.enterprises
No 1642, 8th Main, C Block, 24th Cross
Sahakar Nagar
Bengaluru
-
560092
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - D Smart
No 474, Aashirwaad, C Cross Road, Phase 2
Ideal Homes Layout
Bengaluru
-
560098
180057267864
Open until 07:00 PM
Call
Map
Website
Directions
Authorised Samsung CE Service Center - Teamg Solutions Pvt Limited
No 160/2A, Hebbagodi Hosur Road
Anekal
Bengaluru
-
560100
Opposite to Biocon
+918088660661
Open until 07:00 PM
Call
Map
Website
Directions
First
Previous
1
2`;

export const KARNATAKA_LINKS = [
  `${D}/location/karnataka#searchNearby`,
  `${D}/authorised-samsung-ce-service-center-r-p-services-repair-service-marathahalli-bengaluru-388422/Home`,
  `${D}/authorised-samsung-ce-service-center-r-p-services-repair-service-marathahalli-bengaluru-388422/Map`,
  "https://maps.google.com/maps?cid=13354295212159397211",
  KING_COOL_URL,
  `${D}/authorised-samsung-ce-service-center-veda-tele-venture-repair-service-banaswadi-bengaluru-291889/Home`,
  `${D}/authorised-samsung-ce-service-center-sri-krishna-enterprises-repair-service-banaswadi-main-road-bengaluru-388413/Home`,
  `${D}/authorised-samsung-ce-service-center-cantto-international-repair-service-m-p-m-layout-bengaluru-292046/Home`,
  `${D}/authorised-samsung-ce-service-center-r-logic-technology-services-india-pvt-ltd-repair-service-konanakunte-bengaluru-292048/Home`,
  `${D}/authorised-samsung-ce-service-center-s-n-enterprises-repair-service-kuvempu-nagar-bengaluru-388464/Home`,
  `${D}/authorised-samsung-ce-service-center-prism-services-repair-service-doresanipalya-bengaluru-291896/Home`,
  `${D}/authorised-samsung-ce-service-center-delta-services-repair-service-kurubarahalli-bengaluru-472722/Home`,
  `${D}/authorised-samsung-ce-service-center-digital-service-repair-service-varthur-bengaluru-312881/Home`,
  `${D}/location/karnataka?page=2`,
  "https://www.samsung.com/in/?utm_source=locator&utm_medium=main_website",
];

export const KING_COOL_DETAIL_TEXT = `12.952704 77.526093

# Authorised Samsung CE Service Center - King Cool System

* No 96, Ground Floor, 6th Cross
  Nayandahalli
  Bengaluru - 560039
* 180057267864
* + Closed for the day
* Call    Directions

### Business Hours

* Mon 10:00 AM - 08:00 PM
* Tue 10:00 AM - 08:00 PM
* Wed 10:00 AM - 08:00 PM
* Thu 10:00 AM - 08:00 PM

* Fri 10:00 AM - 08:00 PM
* Sat 10:00 AM - 08:00 PM
* Sun Closed

### Categories

Repair Service Appliance Repair Service Electronics Repair Shop Electronics Retail And Repair Shop Small Appliance Repair Service

### Tags

samsung refrigerator service  samsung washing machine service  samsung washing machine service centre  samsung refrigerator service center  samsung fridge service  tv repair near me  television repair near me  led tv repair near me  television repair

### Nearby Samsung CE Service Center`;

export const SYNTHETIC_AC_DETAIL_TEXT = `12.9716 77.5946

# SYNTHETIC detail page

### Categories

Appliance Repair Service

### Tags

samsung split ac service  samsung air conditioner repair  samsung refrigerator service`;

export const SYNTHETIC_NO_COORDS_DETAIL_TEXT = `# SYNTHETIC detail page without coordinates

### Business Hours

* Mon 10:00 AM - 06:00 PM`;

const page = (url: string, text: string, links: string[] = []) => ({
  url,
  final_url: url,
  title: "Samsung CE Service Center Locator | Bengaluru | Repair Service",
  description: null,
  language: null,
  published_date: null,
  last_modified: null,
  etag: null,
  text,
  latency_ms: 1000,
  links,
});

/** City-page Fetch response: page 1 (with links) + page 2. */
export function cityPagesResponse(): FetchResponse {
  return { results: [page(BANGALORE_P1_URL, BANGALORE_P1_TEXT, KARNATAKA_LINKS), page(BANGALORE_P2_URL, BANGALORE_P2_TEXT)], errors: [] };
}

/** Detail-page Fetch response: recorded King Cool page; the others get a SYNTHETIC page without coordinates. */
export function detailPagesResponse(urls: string[]): FetchResponse {
  return {
    results: urls.map((u) => page(u, u === KING_COOL_URL ? KING_COOL_DETAIL_TEXT : SYNTHETIC_NO_COORDS_DETAIL_TEXT)),
    errors: [],
  };
}
