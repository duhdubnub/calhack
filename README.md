# PropertyLens

Home listings show bedrooms, square footage, and photos. PropertyLens helps answer the everyday questions: How long is the commute? What's nearby? Will my furniture fit?

## What it does

- Combines Zillow and Redfin listings with plain-English home search.
- Brings together schools, commute estimates, groceries, crime information, and natural hazards.
- Lets users save homes and try furniture layouts in an interactive 2D and 3D planner with a searchable IKEA catalog.

## How we built it

Built with React, Vite, Express, and Three.js. Apify actors gather listing and neighborhood data, while CubiCasa helps turn uploaded floor plans into room layouts. The planner also supports estimated layouts.

## Challenges and lessons

Turning floor plans into accurate layouts was our biggest challenge: missed doors, windows, and room boundaries made real-world scaling difficult. We also learned to adapt inputs for different AI models, validate incomplete property data, and clearly label sources and estimates.

We're proud of bringing home search, neighborhood context, and hands-on space planning into one experience.

## What's next

Improve floor plan accuracy and 3D visuals, expand data coverage, and make it easier to compare homes based on each buyer's priorities.

## Run locally

Requires Node.js 20.19+ or 22.12+ and npm.

```sh
npm install
```

If `server/.env` doesn't exist, copy `server/.env.example` to it. Set `USE_FIXTURES=true` for sample property data, then start the app:

```sh
npm run dev
```

Open the Vite URL printed in the terminal. Live listing and insight providers require credentials in `server/.env`; keep keys on the server. Some live Apify runs may incur charges.

For implementation and configuration details, see [providers](docs/providers.md), [plain-English search](docs/nl-search.md), [the planner](docs/planner.md), and [CubiCasa](docs/cubicasa.md).

## Apify actors

- Neighborhood Crime Safety: `QMw7eHkWvgqxhnd0C`
- IKEA Furniture Finder: `1s1g2xDQFnPD0zt6C`
