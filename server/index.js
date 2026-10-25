import { claimRun } from "./providers/actor.js";
import { join } from "node:path";
import { config, serverDirectory } from "./config.js";
import { createCache } from "./cache.js";
import { createApp } from "./app.js";
import { createAutocompleteProvider } from "./providers/autocomplete.js";
import { createAutocomplete } from "./autocomplete.js";
import { createApifyClient } from "./providers/apify.js";
import { createEnrichment, loadApifyFixtures } from "./enrich.js";

const apifyFixtures =
  config.useFixtures && config.enableApify
    ? await loadApifyFixtures()
    : undefined;
const enrich = createEnrichment({
  request: createApifyClient({ token: config.apifyToken, beforeRun: claimRun }),
  cache: createCache(join(serverDirectory, ".cache", "apify-sale-v1.json"), {
    ttl: 3600000,
  }),
  enabled: config.enableApify,
  token: config.apifyToken,
  useFixtures: config.useFixtures,
  fixtures: apifyFixtures,
});
const autocomplete = createAutocomplete({
  provider: createAutocompleteProvider(),
});
if (
  !process.env.GEOAPIFY_API_KEY ||
  process.env.GEOAPIFY_API_KEY === "your_key_here"
)
  console.log(
    "Address search uses Photon. Add GEOAPIFY_API_KEY to server/.env for Geoapify autocomplete.",
  );
if (!config.enableApify)
  console.log("Zillow enrichment disabled by ENABLE_APIFY=false.");
else if (
  !config.useFixtures &&
  (!config.apifyToken || config.apifyToken === "your_token_here")
)
  console.log(
    "Zillow enrichment unavailable: add APIFY_TOKEN to server/.env and restart to enable it.",
  );
const server = createApp(undefined, { autocomplete, enrich }).listen(
  config.port,
  config.host,
  () => {
    console.log(
      `Property API: http://${config.host}:${config.port} (${config.useFixtures ? "saved fixtures; no quota used" : "live providers with one-hour sale-status cache"})`,
    );
  },
);
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? "API port is in use. Stop the other server or change PORT."
      : "Could not start the API server.",
  );
  process.exitCode = 1;
});
