# PropertyLens · Cal Hacks

A responsive home-search app built with Vite, React (JavaScript), React Router, plain CSS and Express. Search criteria combine Zillow and Redfin listings, deduplicate shared homes, and open an accessible detail dialog with independently loaded insights. Save up to five homes per anonymous browser ID. The shared address lookup is available at `/lookup` and `/results?address=...`.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
npm run dev
```

If `server/.env` does not exist, copy `server/.env.example` to it. **Preserve an existing file and append settings instead of replacing it.** Example values only:

```dotenv
RENTCAST_API_KEY=your_key_here
APIFY_TOKEN=your_token_here
USE_FIXTURES=true
ENABLE_APIFY=true
APIFY_MAX_RUNS_PER_HOUR=60
PORT=3001
```

- `USE_FIXTURES=true`: sale lookups and property/insight endpoints use saved/demo data without paid calls. Autocomplete uses saved examples, then live geocoding for other queries. Images may still be fetched by the browser; unavailable photos have placeholders.
- `USE_FIXTURES=false`: live providers with persistent caches. Both keys stay in `server/.env`, read through `process.env`. Missing provider credentials produce unavailable/fallback behavior.
- `ENABLE_APIFY=false`: no live Apify launches. Search can fall back to RentCast; public FEMA remains available (groceries now use Google Maps via Apify). New-module fixtures still work. The legacy enrichment section remains disabled by this switch.
- `APIFY_MAX_RUNS_PER_HOUR`: rolling one-hour actor-launch cap across search, insights and legacy enrichment; default 60. Reservations persist across restarts. One enabled search source counts as one run. Commute uses three runs on a cold request (two peak directions and a batched off-peak comparison).
- `PORT`: Express port; Vite proxies `/api` to it. Servers bind locally. Open the Vite URL printed in the terminal, normally `http://127.0.0.1:5173`. Restart after changing `.env`.

The existing workspace retains its live settings. For a predictable offline demo, set `USE_FIXTURES=true` and restart. Never use `VITE_` for secrets. No keys belong in source, screenshots, URLs, logs or commits.

Get an Apify token in your [Apify Console account settings](https://console.apify.com/). Actor pricing and account access vary; using an existing token does not make actors free. Runs request bounded rows, have no automatic retry, use a $1 actor-charge cap, and share a three-run concurrency limit. Platform/proxy charges may be separate. The legacy one-property enrichment retains its smaller cap.

### Windows terminal

If `node` or `npm` is not recognized, install Node.js LTS with npm, then reopen VS Code's terminal. In the original workspace, the temporary development runtime can also be enabled for the current PowerShell session:

```powershell
$env:PATH = "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
function npm { node "$env:LOCALAPPDATA\Temp\calhack-npm\package\bin\npm-cli.js" @args }
npm run dev
```

That npm directory is machine-specific and temporary. A normal Node.js installation is the portable setup.

```sh
npm test
npm run build
npm run check:secrets
```

`npm run preview` previews the build; start `npm run start:server` separately for API routes. Static hosting alone cannot run the backend. No deployment is included.

## Providers and filters

Actor IDs/settings live in `server/config/apify.js`. `server/search/criteria.js` is the single shared, allowlisted filter validator. Adapters map validated values to documented actor fields. [Provider comparisons and verification](docs/providers.md) record candidate schemas and small live tests.

| Source                                  | Native filters used                                                                                                                                                                                                                                                                                        | Post-filters when fields exist                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Zillow — `TopApi/zillow-scraper`        | Location/search URL, sale/sold/coming soon/pending, price, minimum/exact beds, fractional baths, home types, sqft, lot size, years, HOA/no HOA, parking, garage, single story, new construction, price cuts, open house, 3D tour, A/C, pool, waterfront, views, keywords, supported days-on-market windows | Numeric bounds, exact beds, home types, stories, HOA, days on market (including 3 days)                   |
| Redfin — `brilliant_gum/redfin-scraper` | Location/search URL, sale/sold, price, minimum beds/baths, supported home types, sqft, minimum year, positive HOA cap, new construction, days on market                                                                                                                                                    | Exact beds, numeric bounds, no HOA, max year, lot size, stories and any other supported post-filter field |
| RentCast fallback                       | City/state or ZIP, active/inactive, property type, beds/baths, price, sqft, lot size, years, days on market                                                                                                                                                                                                | Same numeric/home-type checks; unavailable features are reported                                          |

Post-filtering **retains listings with missing data**. Results report `notApplied` by source for filters that cannot be enforced, including fireplace, 55+ restrictions, basement, foreclosure/pre-foreclosure/auction restrictions, and unsupported Redfin features. Walk Score is hidden because the selected actors do not supply it. Only active sale status is selectable; pending/coming-soon requests are reported as not applied.

Only HTTPS Zillow/Redfin hosts and their subdomains are accepted for advanced URLs; credentials, custom ports and other hosts are rejected. A pasted URL controls its matching source and bypasses that source's form/post-filters. Other enabled sources need a location. Sort runs in the browser over the returned merged subset, not the site's entire inventory.

Search defaults to 12 items **per source**, capped at 50. Each source has a 90-second deadline. A failed source does not discard successful results. If every enabled Apify source fails, RentCast is attempted. Inactive RentCast listings do not establish a completed sale. Redfin's chosen actor supports a limited list of cities by name; paste a Redfin search URL for other locations. Search counts represent the retrieved subset, not total market inventory.

## Insights

Only selected modules fetch, only after a listing opens. Preferences and the chosen work address/coordinates are kept in localStorage. Each card has its own loading, error/retry and source display.

| Module          | Provider                                                | Behavior / limitations                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safety / crime  | `QMw7eHkWvgqxhnd0C` (build `0.7.1`, version `0.7`)      | Full-address lookup; SpotCrime city-level safety score (0–10), violent crimes per 100,000 residents, national/state grades, and data year. Uncovered cities show unavailable.                                                                                    |
| Natural hazards | `malonestar/fema-nri-county-risk-profile`               | Requests census tracts; falls back to the keyless FEMA ArcGIS tract point query. County-only actor results trigger the tract fallback. Area loss is not a property insurance quote.                                                                              |
| Schools         | `TopApi/zillow-scraper`, property details               | Public GreatSchools entries from Zillow. Uses listing URL or address. Can backfill year built and four photos. No insurance premium is invented when the provider does not supply one.                                                                           |
| Commute         | `rastriq/google-maps-directions-traffic`                | Verified different next-Tuesday 8 AM/3 AM predictions. Home-to-work at 8 AM, work-to-home at 5:30 PM, both compared to 3 AM in the same direction. `tz-lookup` derives the home's calendar; actor times are local to each origin. Predictions, not live traffic. |
| Groceries       | Google Maps via Apify (`compass/crawler-google-places`) | One run per cold request: "grocery store" search within 5 km of the point, grocery-category filter, nearest five by haversine straight-line miles. Labeled illustrative fixtures are included.                                                                   |

Crime, hazard, school and commute successes cache for 24 hours; grocery successes cache for seven days at coordinates rounded to three decimals. Failures cache only five minutes. Retry does not bypass that protection. Search caches one hour (partial failures five minutes). Identical in-flight requests share work. All caches are ignored JSON files under `server/.cache/`, for **one Express process**, not a multi-replica deployment.

## Fixtures and demos

Search fixtures contain recorded Austin listings with two genuine Zillow/Redfin overlaps: 5101 Trail West Dr and 1601 Faro Dr unit 1303. They merge once with both source badges/links. Schools, hazards and commute fixtures include these two homes. Crime and grocery fixtures are explicitly **illustrative**, with notices that they are not measured crime data or verified businesses. Every insight fixture has a sample badge. Entering another location does not turn saved data into live data.

Fixture numeric and home-type filters operate on the saved rows. Native-only provider filters and pasted URL contents are not simulated; the UI explains this. The recorded commute test is in `server/fixtures/commute-verification.json`. Old Phase 2/3 lookup fixtures are retained. Inspection scripts are explicit paid diagnostics and must not be run during ordinary setup.

## Endpoints

| Endpoint                                                | Purpose                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /api/search`                                      | Canonical criteria plus optional `limit`; merged listings, source counts/errors, not-applied notes |
| `GET /api/autocomplete?q=`                              | US street/address suggestions; ten-minute cache, 30/client/minute                                  |
| `GET /api/insights/crime?address=&city=&state=&zip=`    | Crime area data                                                                                    |
| `GET /api/insights/hazards?lat=&lng=`                   | FEMA tract hazards                                                                                 |
| `GET /api/insights/schools?listingId=&url=&address=`    | Public schools and detail backfill                                                                 |
| `GET /api/insights/commute?lat=&lng=&workLat=&workLng=` | Peak/off-peak driving predictions                                                                  |
| `GET /api/insights/groceries?lat=&lng=`                 | Nearby grocery distances                                                                           |
| `GET /api/favorites`                                    | List this browser ID's saved homes                                                                 |
| `POST /api/favorites`                                   | Add/update normalized listing and optional loaded `snapshots`                                      |
| `DELETE /api/favorites/:id`                             | Remove a saved home                                                                                |
| `GET /api/lookup?address=`                              | Preserved RentCast property lookup                                                                 |
| `GET /api/enrich?address=`                              | Preserved single-property Zillow enrichment via crawloop                                           |

## Favorites storage

`server/storage/favorites.js` exposes `list`, `add`, `remove`. `MAX_FAVORITES=5` is enforced inside a serialized mutation queue. Writes create `server/data/` automatically, write a temporary file, then atomically rename to `favorites.json`. The file is gitignored. Failed/corrupt reads never overwrite the data. Different anonymous UUIDs are isolated. These are browser identifiers, **not authentication**; clearing localStorage loses the browser's association, and possession of an ID allows access to its favorites. No login or cloud database is implemented.

The browser generates `crypto.randomUUID()`, stores it locally and sends `X-Client-Id`. The server validates IDs, sanitizes listings/snapshots and lightly rate limits requests. Heart updates are optimistic with rollback on error; favorites survive reloads and server restarts. The favorites dialog uses saved snapshots immediately and refreshes selected modules through their caches.

## Structure

```text
src/
  components/           Original lookup components
    search/             Filters, grid, modal, work address, independent insights
  pages/                Home search, Favorites, Lookup, Results, NotFound
  lib/                  App name, formatters, preferences and favorites contexts
  styles/               Responsive plain CSS
server/
  config.js             Environment loading; no secrets exposed to Vite
  config/apify.js       Chosen actors and run settings
  search/criteria.js    Canonical shared validation
  search/adapters/      Zillow / Redfin mappings
  search/               Merge, post-filters, search/fallback orchestration
  insights/             Separate validated module handlers
  providers/            Photon, Apify guard/client and commute interface
  storage/              Persistent cache and favorites interfaces
  fixtures/             Recorded and clearly labeled illustrative demo data
  tests/                Offline unit/integration checks
  data/                 Ignored local favorites
  .cache/               Ignored provider caches / rolling actor budget
```

Rename the app in `src/lib/config.js`. Unknown routes render the not-found page. Native modal dialogs trap focus, support Escape and outside dismissal, restore focus and fill the screen on mobile.

## Planned next

OpenAI-generated listing summaries, Azure deployment, Visa payments and a cloud storage adapter remain future work. Optional OpenAI search/furniture interpretation is described below; accounts, payments and cloud deployment are not implemented.

## Verification

37 automated tests pass, including unchanged Phase 2/3 behavior, canonical validation, adapter input mapping, cross-source merge, missing-field retention, one/both-source failure handling, persistent success/failure caches, concurrent favorites and the rolling actor budget. Fixture tests disable `fetch` and blank both keys to prove that the new search and all five modules require no external services.

Browser checks covered filtered Austin results, URL precedence, selected-module loading, work-address selection, all five fixture cards, dialog Escape dismissal, favorites reload persistence, reset filters, and a 360-pixel viewport with no horizontal overflow. Production `npm run build` and secret checks pass. Live provider outcomes and unavailable services are recorded above; offline fixtures do not claim live coverage.

## Try Your Furniture: 3D room planner

The headline planner opens from any search or favorite card's **3D** shortcut or the listing popup's **Open 3D room planner** action. Go to `/planner` for a custom home, saved favorite, or the furnished demo at `/planner/demo`. Back to listing restores the last search and popup without rerunning the search actors.

Switch between 2D and 3D, edit room dimensions, add catalog/name/manual/link/bulk furniture, confirm measurements, drag or nudge items, rotate, inspect collision and door warnings, undo/redo, and download a watermarked PNG. All houses are **Estimated layout, not the real floor plan**. Furniture sizes read from product pages or estimated from names must be verified.

Furniture libraries (50 items) and layouts (10 homes, 80 placements each) persist in gitignored server JSON, scoped by the existing anonymous browser ID. Autosave has a visible localStorage fallback. Favorites remain limited to five. The demo needs no API keys; `USE_FIXTURES=true` makes no external furniture calls and supports three sample product URLs documented in [docs/planner.md](docs/planner.md).

Run `npm install`, then `npm run dev`. Server environment is loaded from `server/.env`, following `server/.env.example`. Optional furniture-only settings:

- `OPENAI_API_KEY=your_key_here` (server only; omit for catalog/heuristic fallback)
- `OPENAI_MODEL=gpt-4.1-mini`
- `OPENAI_MAX_CALLS_PER_HOUR=30`
- `ENABLE_FURNITURE_APIFY=false` (opt in to single-page fallback; shares `APIFY_MAX_RUNS_PER_HOUR`)

Privacy: layouts, furniture names, and listing snapshots are stored for this browser's anonymous ID. Product URLs are fetched by the server and may be sent to enabled providers. No secrets are sent to the browser. Clearing the browser ID removes access to that anonymous library; this is not an authenticated account system.

See [planner architecture and limitations](docs/planner.md) and [provider details](docs/providers.md). Validate with `npm test`, `npm run check:secrets`, and `npm run build`.

## Describe it: plain-English home search

Choose **Describe it**, type what you want and press Enter. Try `4 bed los angeles`, `LA 3br 2ba under 1.5m`, `sf condo under 1m`, `austin tx 3/2 with pool`, `90210 2 bed`, or `houses near UCLA`. Bare cities, aliases, common typos, number words and shorthand work without an AI key. Chips show understood criteria; unknown text offers keyword/ignore/edit actions. Missing locations, ambiguous cities, regions and multiple places ask for a choice instead of guessing. Exact street addresses still route to the existing address lookup first.

Optional server-only settings in `server/.env`: `OPENAI_API_KEY`, `OPENAI_MODEL=gpt-4.1-mini`, `OPENAI_MAX_CALLS_PER_HOUR=30`. Rules and place resolution always run first. ChatGPT is called only for missing locations, unexplained wording or low confidence; fully understood queries and confident addresses bypass it. Without a key, on provider failure, or in fixture mode, built-in rules parse the text. The shared provider uses the official OpenAI SDK, Responses API and strict Structured Outputs, with no request storage, an eight-second timeout, and no retries. Furniture extraction shares the same budget.

Prices, bed/bath ranges, exact beds, types, area/lot sizes, years, HOA, features, listing freshness/status, keywords, sort, insights, radius and driving commute are supported. Insight requests enable detail modules; they do not rank or filter homes. Queries and recent searches can contain addresses; the UI explains when text goes to OpenAI and where work coordinates are used.

Commute filtering requests at most 30 candidates per source (configurable up to 50), prunes by straight-line distance, and checks eight routes in a single Apify run (configurable up to 12). Seven-day route caching, the shared hourly actor cap, and one in-flight batch per browser bound costs. **Check more** uses another bounded batch and Apify credits. Unchecked and over-limit homes are clearly separated.

Set `USE_FIXTURES=true` for offline rules, saved Austin listings and sample route data with no paid calls. Sample listings do not move to the requested city; an SF commute constraint may therefore return none. See [the full phrase list, API, privacy and limitations](docs/nl-search.md). The 236-case offline corpus improved from 42.37% to 100%, including 40 exact-address regressions. Inspect a query with `npm run debug:parse -- "4 bed los angeles"`; measure with `npm run test:parse:corpus`. Run `npm run dev`; validate with `npm test`, `npm run build` and `npm run check:secrets`.

## Address and description search

You can search a house number and street plus city without a state or ZIP, for example `16305 Almaden Dr, Austin` or `16305 Almaden Dr Austin`. Matching recent listings or the existing Census geocoder fill in missing components before the normal sale check. The city you typed narrows candidates; genuinely ambiguous addresses still offer a choice. Your input text stays unchanged.

The shared combobox changes text only when you type/paste/delete or explicitly select a suggestion. Nothing is highlighted initially; arrows only move the highlight, hover never selects, and Enter without an arrow-highlight submits your typed text. Escape, blur, Tab, network responses and saved-state restoration do not autocomplete or reopen a dismissed list. Browser address autofill and password-manager hints are disabled. Standardization appears in the interpretation chip; typed text and ZIP remain unchanged.

Suggestions first appear without ZIPs. After 300 ms of stable results, the top three are checked with Census in parallel (three-second request timeout, global concurrency/politeness guard, seven-day cache). Verified ZIPs appear in reserved space with a check mark; rows never reorder. Unverified rows keep their city/state and a ZIP-unverified tooltip. Listing ZIPs take precedence in property details, with a note when the typed ZIP differs.

Exact matches ignore ZIP differences and require matching house/street/unit plus locality or coordinates within 100 meters. Address results bypass criteria filters. Failed, timed-out or capped checks return `check_failed` with Retry and are never cached. Conclusive negatives last one hour and offer a rate-limited Check again. See [the investigation and measured results](docs/address-search-debugging.md).

```sh
npm run debug:address -- "16305 Almaden Dr, Austin, TX 99999"
npm run probe:autocomplete -- --all
npm run test:address:live -- "Austin, TX"
npm test
npm run build
npm run check:secrets
```

The live round-trip command may run a bounded paid criteria search; the autocomplete probe only uses public geocoders. Dev-only `debug: true` on `/api/search/address` returns safe pipeline events. Production never returns a trace.

The main box accepts both `4 bed house in Los Angeles under $1.5M` and `147 Midway Ln`. Confident rules avoid OpenAI. Addresses resolve to an active sale listing, a choice of cities/units, a not-for-sale message without property details, or spelling/location tips. `/lookup` and `/results?address=...` use the same flow. Bare number/street fragments that cannot resolve fall back to description clarification. The planner's Back to listing restores the search session without another lookup; sale snapshots older than one hour are discarded on restoration.

Only active for-sale homes are displayed. Pending, contingent, coming-soon, sold, off-market and rental records are removed on the server. Favorites remain saved snapshots and are exempt. Search/address status caches last at most one hour, and the detail popup shows the status-check time. Unknown provider status is accepted only from an explicit sale-only request with no contradictory signal.

For better US address suggestions, get an optional free key from [Geoapify MyProjects](https://myprojects.geoapify.com/), create a project, and copy its API key into the existing `server/.env`:

```dotenv
GEOAPIFY_API_KEY=your_key_here
AUTOCOMPLETE_PROVIDER=auto
GEOAPIFY_MAX_REQUESTS_PER_DAY=2500
RENTCAST_ADDRESS_MAX_REQUESTS_PER_DAY=100
```

No key is required: missing keys, errors and the daily cap fall back to Photon. The server logs a setup hint once at startup. Keys never enter the browser. Suggestions use last-result/work coordinates as a bias and require a US house number, street and locality when a house number is typed. Census verifies the top rows without trusting provider ZIPs. Verification describes an address match, not sale status or unit existence.

```sh
npm run probe:autocomplete -- "147 midway lane"
npm run probe:autocomplete -- --all
```

The probe prints safe provider results and Census verification; it does not run RentCast or Apify. See [provider findings](docs/providers.md#address-search-and-autocomplete) for measured limitations and thresholds.

Fixture demos: `5101 Trail West Dr` → active sample; `100 Pending St` / `200 Sold St` → no property details; `147 Midway Ln` → two sample cities; `999 Unknown Street` → not found. Sample candidate addresses and property values are illustrative, not current market claims. Address lookups remain offline in fixture mode. Autocomplete uses saved examples and falls back to live public geocoding for other queries, as requested; unmatched queries may therefore need network access.
