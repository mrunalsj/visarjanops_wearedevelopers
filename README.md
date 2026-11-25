# VisarjanOps

**Your visarjan, thoughtfully organised.** A mobile-first civic-tech demo that connects immersion-site discovery, slot booking, a booking pass and assistance requests. The interface uses a warm ivory and saffron Ganeshotsav theme with subtle rangoli-inspired artwork and responsive layouts.

> **Data boundary:** public sites come from **MCGM's published "Arrangement of Ganeshotsav 2025" list** (Mumbai artificial ponds, downloaded from the [MCGM portal](https://portal.mcgm.gov.in/irj/portal/anonymous/qlGanpatiDeQR)). It is a **past-season** list, extracted automatically from a scanned PDF and **pending operator review**: names may be incomplete and some locations could not be read. Site **status is shown only when signed-in staff post it** in Operations; nothing is inferred or simulated for visitors. Location is used only in the visitor's browser after they tap **Use my location**. The map loads tiles from the OpenFreeMap public instance. Eight fictional, clearly labelled demo sites (four in Pune, four in Bengaluru) are shown and bookable by default (`DEMO_SITES=false` hides them). Their tracked seed records and booking-window template live in `server/seeds/demo-sites.json` and `server/seeds/demo-slot-template.json`; mutable bookings and updates are persisted separately in `data/demo.json`. Apify is an optional, manually started import for staging public-source results; it does not update site listings.

## Official site data (MCGM)

`server/sources/mcgm-ganeshotsav-2025.json` is generated, not hand-written:

```bash
swift scripts/ocr-pdf.swift "<MCGM Ganeshotsav PDF>" > /tmp/mcgm-ocr.txt   # macOS on-device OCR
node scripts/import-mcgm.mjs /tmp/mcgm-ocr.txt --resolve                  # parse + read MCGM map links
```

- Every record keeps the authority, source URL, source document, publication date, festival year, extraction time, original OCR text and a `PENDING_REVIEW` status. Missing values stay `null`.
- `--resolve` makes one request per MCGM-published `maps.app.goo.gl` short link (no redirect following, 0.4 s apart, cached in `.cache/`) and reads coordinates from the link it points to: place pin, search coordinates or a Plus Code decoded locally. Coordinates outside Mumbai are discarded. A map link is not proof that a site is operating this season.
- 2025 run: 208 records from 288 listed ponds (some rows list several ponds); 105 with coordinates, 86 links unreadable from OCR, 77 names unreadable (shown as "MCGM artificial pond N"). One repeated link merged; one possible duplicate flagged.
- Re-running the import updates the store on next start without overwriting staff status posts or any record an operator has verified or rejected. Municipal sites are not bookable.

## Home page

The home hero is a WebGL river (three.js, vendored, about 2.1 MB) with drifting lantern lights and a 3D journey carousel. three.js loads only on screens 900 px and wider; reduced motion, data saver and small screens get a static gradient and never download it. The carousel pauses on hover/focus, has previous/next/dot controls and swipe, and stays still under reduced motion.

## Find sites near me

Explore opens with **Use my location** and a manual **Choose an area** fallback. Nothing is requested on page load.

- **One-time lookup:** a single `navigator.geolocation.getCurrentPosition` call after the tap (no `watchPosition`, low accuracy, 10-second timeout). Denied, unavailable or timed-out requests show a plain-language message pointing to the area picker.
- **Privacy:** distances are calculated in the browser from the public site list. Visitor coordinates stay in page memory only; they are never sent to the server, logged or stored. Geolocation requires a secure context: `localhost` qualifies for local demos; any shared deployment needs HTTPS.
- **Sorting:** straight-line (haversine) distance, labelled as such. No driving times are shown.
- **Map-first layout:** a full map with a pin per located site (coloured by status freshness) beside a compact list of the nearest sites, 20 at a time with **Show more**. Selecting a row flies the map to its pin; selecting a pin highlights the row. Sites without a readable location are listed separately. **List only** hides the map for slow connections.
- **Directions** open the map link MCGM published for that site. Municipal sites show "No online booking"; arrival booking exists only for demo sites.
- **Status labels:** **Live** (staff update or authorised feed ≤5 min old), **Delayed** (≤30 min old), **Demo** (simulated, demo sites only) or **Unavailable** (no report, invalid or stale). Queue and wait values are shown only alongside their source and time. See `server/status-source.js`.
- **Staff status updates:** signed-in staff post Open / Busy / Near capacity / Closed, people waiting and wait time per site in Operations (`POST /api/v1/operations/sites/{id}/status`). Visitors see it within about 15 seconds.
- **Map:** MapLibre GL JS 6.19.0 (vendored in `public/vendor/`, BSD-3-Clause) with OpenFreeMap's `liberty` style, loaded when Explore opens. No API key or billing account. The map requests tiles for the visible area from `tiles.openfreemap.org`; if a location was shared, that includes tiles around it.

### What a real deployment still needs

- **Operator verification and this season's list:** imported sites are `PENDING_REVIEW` and from 2025. An authorised operator must review names and locations (an approve/reject screen is not built yet), and the current season's MCGM list must be imported when published.
- **Staff at sites, or an authorised feed:** status is only as live as staff posting it. Real use needs individual staff accounts and roles (today there is one shared login), or an authorised municipal/site-operator feed implementing `createStatusSource` in `server/status-source.js`. Scraped pages must never be treated as live queue data.

## Booking, QR pass and gate check-in (demo sites)

1. A visitor books an arrival slot at a demo site. The booking stores only a hash of the recovery key.
2. The pass shows a **scannable QR** (generated server-side with `qrcode`) containing `VJ1|<reference>|<check-in code>` and the same code as text. The check-in code is an HMAC of the reference with a server secret (`PASS_SIGNING_SECRET`, or one generated into the local store), so it is never stored in plain text and the QR never contains the recovery key.
3. Operations → **Gate check-in**: staff choose the gate's site, then **Scan QR with camera** (decoded on the device with vendored jsQR; camera needs `localhost` or HTTPS) or type the reference and code. The first scan checks the group in, the second checks them out, and further scans are refused. A pass only works at its own site. Requires a staff session and the `ops_status_updates` flag.
4. **Crowd estimate** per site and slot: *expected* = booked, not yet arrived; *on site* = scanned in, not out; *completed* = scanned out. Operations sees the full breakdown; visitors see "~N on site · M expected" labelled as an estimate from gate check-ins. No names or emails leave Operations.

Municipal (MCGM) sites are not bookable, so they have no pass or crowd counts.

## Sponsor integrations

The server loads a local `.env` file on start (`server/env.js`; variables already set in the shell win). See `.env.example` for every variable. Never commit `.env`.

### Flagsmith: feature flags

Uses the official **`@flagsmith/nodejs`** SDK with **local evaluation**: the SDK downloads the environment once and refreshes it every 60 s (`FLAGSMITH_REFRESH_SECONDS`), so checking a flag makes no network call. That is about 43k requests a month, within the Free plan's 50k. Flags control rollout only; every staff route still checks the session first, and live site data stays in the app's API.

| Flag | Fallback | Controls |
|---|---|---|
| `nearby_discovery` | on | "Use my location" and area sorting |
| `map_view` | on | Explore map (off = list only) |
| `apify_import` | on | Staff Apify run (still needs sign-in and Apify credentials) |
| `voice_assistance` | **off** | Sarvam voice search and spoken answers |
| `ops_status_updates` | **off** | Staff live-status posting |

Setup: create a free project at app.flagsmith.com → Development environment → create the five features above (exact names, switched on) → **Settings → Keys → Server-side Environment Key** (starts with `ser.`) → put it in `.env` as `FLAGSMITH_SERVER_KEY`. Fallback values apply when Flagsmith is unconfigured, unreachable or a flag is missing; `FEATURE_FLAG_DEFAULTS=voice_assistance=on,ops_status_updates=on` changes those fallbacks for a local demo (Flagsmith values always win). Operations shows each flag's current state.

### Sarvam AI: voice search

**Ask by voice** (Explore) records up to 8 seconds only after a tap, sends it to Sarvam **Saaras v4** (`mode: translate`, with Mumbai area names as keyterms) and matches the English text to a listed area, locality or site. A spoken answer is generated with **Bulbul v4 Flash** in the language the visitor used (English, Hindi, Marathi or Kannada) from fixed templates and our own site data. Hindi/Marathi/Kannada templates need native-speaker review.

- Needs `SARVAM_ENABLED=true`, `SARVAM_API_KEY` and the `voice_assistance` flag. Calls spend account credits: capped at `SARVAM_DAILY_CALL_LIMIT` (default 150) per server per day, 10 per visitor per 10 minutes, recordings ≤800 KB, silent recordings rejected before any call, same-origin requests only. Audio and transcripts are not logged or stored.
- For a device location, the spoken answer has names and status only; distances are not sent to the server because they could reveal the visitor's position.
- Spoken localities with no listed site (for example "Dadar") are centred using OpenStreetMap **Nominatim** (only the locality name is sent, bounded to Mumbai, ≤1 request/second, cached).

### NudgeBee: health monitoring

`GET /api/v1/health` returns service status, uptime, store health, flag mode and voice usage (no secrets, no visitor data). It requires `Authorization: Bearer <OPS_MONITOR_TOKEN>` (24+ characters) or a staff session. In NudgeBee, add a Workflow with an **HTTP Request** task (`integrations.http`): method GET, auth type Bearer, token = `OPS_MONITOR_TOKEN`, URL = your deployed app's `/api/v1/health`, on a schedule trigger; alert when `status_code` is not 200 or `body.data.status` is not `ok`. NudgeBee's cloud cannot reach `localhost`, so this needs a deployed (HTTPS) URL or a self-hosted NudgeBee on the same network. No NudgeBee workflow has been configured or verified yet.

### Integration Q&A

#### How have you used Flagsmith, and what problem does it solve?

I use Flagsmith to control features such as nearby discovery, map view, Apify imports, voice assistance, and staff status updates. This lets the team enable or disable features as they roll them out, without changing the app's code for each rollout. Flagsmith controls feature availability; staff-only features still require staff sign-in.

**What I liked about Flagsmith:** It makes rollouts easier to manage and gives the team a quick way to switch off a feature if it causes problems.

#### How have you used NudgeBee, and what problem does it solve?

I prepared a protected health endpoint for monitoring VisarjanOps. NudgeBee could use monitoring data to help the team notice and investigate app issues. The NudgeBee workflow and observability connections have not yet been configured or verified, so this is prepared rather than a live integration.

**What I liked about NudgeBee:** Its goal of bringing monitoring information together to help teams understand incidents faster.

#### How have you used Sarvam AI, and what problem does it solve?

I integrated Sarvam as an optional voice assistant for site discovery. When configured, visitors can speak a search request instead of typing; the app transcribes it, matches it to a listed area or site, and can provide a spoken response. It requires server credentials and the `voice_assistance` feature flag.

**What I liked about Sarvam AI:** Voice search can make finding a site more convenient for people who are on the move or prefer speaking to typing, with support for multiple Indian languages.

## Run locally

Requirements: Node.js 20 or later. The local demo starts without a database or external account; Apify is optional and requires an Apify account.

```powershell
$env:OPS_USERNAME = 'site-ops'
$env:OPS_PASSWORD = 'choose-a-unique-password-at-least-12-characters'
npm run dev
```

macOS / Linux:

```bash
OPS_USERNAME=site-ops OPS_PASSWORD='choose-a-unique-password-at-least-12-characters' npm run dev
```

Open [http://localhost:4173](http://localhost:4173) (use `localhost` so browser geolocation is allowed without HTTPS). The API creates `data/demo.json` at first startup; set `DATA_DIR` to keep it elsewhere. Stores created before this version are upgraded in place: existing bookings and slot counts are kept, coordinates and provenance are added. Set `PORT` to change the port. Set `DEMO_MODE=false` to disable the public demo-reset endpoint.

The **Staff sign in** link opens the operations login. Use the username/password set in the server environment above. Passwords are not stored in the repository or demo database. If either variable is missing (or the password is shorter than 12 characters), operations sign-in stays disabled. Sessions use an HttpOnly, SameSite=Strict cookie, expire after eight hours and are kept in memory until expiry or sign-out; restarting the server clears them. The demo server listens on `127.0.0.1`. Configure a real identity provider, HTTPS and persistent session controls before any shared deployment.

## Optional Apify connection

Apify runs only after an operations user clicks **Run configured Actor**. To configure it, set these variables in the same PowerShell window before `npm run dev`:

```powershell
$env:APIFY_API_TOKEN = 'your Apify API token'
$env:APIFY_ACTOR_ID = 'your-account~your-actor'
$env:APIFY_ACTOR_INPUT_JSON = '{"startUrls":[{"url":"https://example.org"}]}'
$env:APIFY_MAX_ITEMS = '25'
$env:APIFY_MAX_TOTAL_CHARGE_USD = '1'
npm run dev
```

Use the input fields required by your chosen Actor; the `startUrls` example is only illustrative. The API token stays on the server and is never sent to the browser. Each run has a $1 maximum charge by default; change `APIFY_MAX_TOTAL_CHARGE_USD` deliberately if your Actor needs a higher cap. Results are limited to 1–100 items (25 by default), saved as pending review in the local demo store, and shown only in Operations. They do not change public site records or bookings. The three most recent runs are retained in `data/demo.json`. `.env.example` lists the names, but this zero-dependency demo does not automatically load `.env` files.

To reset demonstration reservations, use **Reset demo data** on the booking page. It clears local bookings and restores the fictional site's initial slot counts. The reset is available only in demo mode.

## Demo walkthrough

1. Open Explore, tap **Use my location** (or choose an area) and see the nearest MCGM artificial ponds on the map. Select a row to fly to its pin.
2. Open Lakeview Artificial Pond and choose an arrival window.
3. Enter a name, email and group size. The API validates and reserves capacity before confirming.
4. View the booking page and reference.
5. Select a help category. The assistance request is saved and receives a reference.
6. Use the waste guidance page to review basic sorting guidance.
7. Reset the demo before the next walkthrough.

The pass currently displays a demo visual derived from the reference. It is **not a standards-compliant, scanner-valid QR code** and must not be used for entry. The demo has no staff scanner/check-in workflow. These are known gaps, not live features.

## Current repository and architecture

The working application uses a dependency-free Node.js HTTP server plus a static HTML/CSS/JavaScript client, with JSON-file persistence in `data/demo.json`. The server implements public site discovery, booking creation with serialized slot-capacity reservation, secured booking lookup by a random recovery key (stored as a hash), pass metadata, assistance request create/status, feedback persistence, simulated SSE, demo reset, and an optional protected Apify Actor run that stages a capped dataset for staff review. The interface is responsive and uses fictional demo data.

### Deploying this demo to Vercel

The static client is served from `public/`; Vercel serves that directory as the site output. API requests route through `api/[...path].js` to the existing Node.js request handler. In Vercel, the JSON store defaults to `/tmp/visarjanops`, which is temporary per function instance; bookings and operations updates can reset or differ between instances. Staff sessions are also held in memory. Use a shared database and session store before relying on this for a public event. Add `OPS_USERNAME`, `OPS_PASSWORD`, and any Flagsmith/Sarvam settings in the Vercel project environment variables; do not commit secrets.

This is a runnable foundation, not the complete Node.js/PostgreSQL platform planned for production. The application does not yet provide React/TypeScript, PostgreSQL/PostGIS, Redis, production database migrations, a production identity provider, real QR generation/scanning, cancellation, facilities API, live queue processing, navigation, or complete visit/feedback UI. Do not represent these features as implemented.

### Intended production architecture

- React + TypeScript + Vite PWA for the public client; React Router, TanStack Query, React Hook Form/Zod, i18next, Workbox, MapLibre and ZXing where appropriate.
- Node.js modular monolith for the API and business logic, evolving the existing server; add request validation, OpenAPI documentation, and production-grade staff authentication. Do not introduce a Java/Spring Boot service.
- PostgreSQL + PostGIS for persistent and spatial data, with Node.js-compatible migrations and database access; Redis only for a defined ephemeral workload; SSE for live queue updates.
- Docker Compose for local infrastructure. Configurable map tiles and optional OSRM; never rely on public OSM tiles for unlimited production traffic.
- Role-based, authenticated staff operations; privacy-preserving public booking recovery; audit events, cancellation, check-in replay protection and idempotency.

The demo storage file is for local demonstration only: simultaneous processes, durable transactional guarantees, authentication and data retention are not supported. Use an actual transactional database and threat-model review before deployment.

## Verification

With the server running in one terminal, run `npm test` in another terminal for the local API smoke test (including concurrent capacity reservation) and the status-freshness unit tests. The API test resets demo data, so point the test server at a throwaway store, for example `FEATURE_FLAG_DEFAULTS=ops_status_updates=on SARVAM_ENABLED=false DATA_DIR=/tmp/visarjanops-test PORT=4173 npm run dev`. Run `npm run check` for Node source syntax validation. This is not a complete backend, authorization, QR-scan or browser end-to-end suite; accessibility review and broader tests are needed before production readiness.

## Licensing and attribution

Runtime npm dependencies are the official Flagsmith SDK `@flagsmith/nodejs` 9.5.0 (MIT) and `qrcode` 1.5.4 (MIT), pinned in `package-lock.json`; run `npm install` before starting. QR scanning uses vendored jsQR 1.4.0 (Apache-2.0, `public/vendor/JSQR-LICENSE.txt`). The application code is offered under MIT; see `LICENSE`. The UI uses Google Fonts via the fonts.googleapis.com service when online (Poppins, Inter and Noto Sans Devanagari, SIL Open Font License 1.1); system sans-serif fallbacks work without a network connection. The optional map uses vendored MapLibre GL JS (BSD-3-Clause, `public/vendor/MAPLIBRE-LICENSE.txt`) and OpenFreeMap tiles built from OpenStreetMap data (© OpenStreetMap contributors, ODbL); attribution is shown on the map. Source listings and full license text are in `THIRD_PARTY_NOTICES.md`.

The Operations route requires configured staff credentials and shows fictional site data alongside the optional manual Apify import control. It does not provide site editing or approve imported data into public listings. The header uses the Ganesh logo supplied by the user, cropped to fit the brand mark.

See [ARCHITECTURE.md](ARCHITECTURE.md), [DEMO_GUIDE.md](DEMO_GUIDE.md) and [DEPENDENCY_AUDIT.md](DEPENDENCY_AUDIT.md).
