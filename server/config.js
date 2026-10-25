import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

export const serverDirectory = fileURLToPath(new URL("./", import.meta.url));
dotenv.config({ path: new URL(".env", import.meta.url), quiet: true });

export const config = {
  apiKey: process.env.RENTCAST_API_KEY,
  apifyToken: process.env.APIFY_TOKEN,
  enableApify: process.env.ENABLE_APIFY !== "false",
  useFixtures: process.env.USE_FIXTURES === "true",
  ikeaLiveSearch: process.env.IKEA_LIVE_SEARCH === "true",
  port: Number(process.env.PORT) || 3001,
  host: process.env.HOST || "127.0.0.1",
  corsOrigins: (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};
