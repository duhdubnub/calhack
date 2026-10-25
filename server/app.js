import { exactAddress, splitAddress, parseAddressText } from "../src/lib/search/address.js";
import { fastSuggestion } from "../src/lib/search/suggestions.js";
import { verifyAddress } from "./providers/census.js";
import { lookupAddress, cleanSelected } from "./search/address.js";
import {
  isDisplayable,
  normalizeListingStatus,
  visibleListings,
} from "./search/status.js";
import { plannerRouter } from "./storage/planner-routes.js";
import express from "express";
import { favoritesRouter } from "./storage/favorites-routes.js";
import { insightHandlers } from "./insights/index.js";
import { search } from "./search/index.js";
import { LookupError } from "./errors.js";
import { parseSearch } from "./search/parse.js";
import { parseTrace } from './search/parse-trace.js';
import { config } from "./config.js";
import { resolvePlaces } from "./search/places.js";
import { describedSearch } from "./search/described.js";
import { partialCriteria } from "./search/nlParser.js";
import { commuteSearch } from "./search/commute.js";
import { createFloorPlanRouter } from "./floorplan/routes.js";

export function createApp(
  lookup,
  {
    autocomplete,
    enrich,
    parse = parseSearch,
    resolve = resolvePlaces,
    addressLookup = lookupAddress,
    addressVerifier = verifyAddress,
    searchProvider = search,
    describedProvider = describedSearch,
    moreProvider = commuteSearch.more,
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  if (config.corsOrigins.length)
    app.use("/api", (req, res, next) => {
      const origin = req.get("Origin");
      if (origin && config.corsOrigins.includes(origin)) {
        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
        res.set("Access-Control-Allow-Headers", "Content-Type, X-Client-Id");
        res.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE");
        res.set("Access-Control-Max-Age", "600");
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      next();
    });
  app.use(express.json({ limit: "200kb" }));
  app.use("/api/planner/floorplan", createFloorPlanRouter());
  app.use("/api/favorites", favoritesRouter);
  app.use("/api", plannerRouter);
  app.get("/api/search/config", (_req, res) =>
    res.json({
      openaiConfigured:
        !config.useFixtures &&
        Boolean(
          process.env.OPENAI_API_KEY &&
          process.env.OPENAI_API_KEY !== "your_key_here",
        ),
    }),
  );
  const verificationClients = new Map();
  app.post(["/api/address/verify", "/api/autocomplete/verify"], async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const client = String(req.get("X-Client-Id") || req.ip).slice(0, 100),
        now = Date.now();
      for (const [key, v] of verificationClients)
        if (v.until <= now) verificationClients.delete(key);
      if (verificationClients.size >= 5000 && !verificationClients.has(client))
        return res
          .status(429)
          .json({ error: { message: "Verification is busy." } });
      const rate = verificationClients.get(client) || {
        n: 0,
        until: now + 60000,
      };
      verificationClients.set(client, rate);
      if (++rate.n > 30)
        return res
          .status(429)
          .json({
            error: { message: "Too many verifications. Try again shortly." },
          });
      const batch = req.path === "/api/autocomplete/verify";
      if (batch && (!Array.isArray(req.body?.suggestions) || req.body.suggestions.length > 3)) throw Error("Invalid batch");
      const rows = batch ? req.body.suggestions : [req.body?.selected || {}];
      const result = await Promise.all(rows.map(async row => {
        const p = cleanSelected(row);
        const v = config.useFixtures ? { ...p, zip: "", verified: false } : await addressVerifier(p);
        return { ...v, originalLabel: row.label };
      }));
      res.json(batch ? result : result[0]);
    } catch {
      res
        .status(400)
        .json({ error: { message: "Choose a complete US address." } });
    }
  });
  app.post("/api/search/address", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const v = await addressLookup(
        { ...req.body, debug: process.env.NODE_ENV !== "production" && req.body?.debug === true },
        String(req.get("X-Client-Id") || req.ip).slice(0, 100),
      );
      res.json({
        ...v,
        ...(process.env.NODE_ENV === "production" ? { debug: undefined } : {}),
        ...(v.listings ? { listings: visibleListings(v.listings) } : {}),
      });
    } catch (e) {
      res
        .status(e.status || 503)
        .json({
          error: {
            message: e.status
              ? e.message
              : "Address lookup is temporarily unavailable.",
          },
        });
    }
  });
  app.post("/api/search/parse", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const parsed = await parse(
        req.body,
        String(req.get("X-Client-Id") || req.ip).slice(0, 100),
      );
      const result = parsed.intent === "address" ? parsed : await resolve(parsed);
      if (req.body.debug === true && process.env.NODE_ENV !== 'production') result.debug = parseTrace(req.body.text, result);
      res.json(result);
    } catch (e) {
      if (e.status === 429) res.set("Retry-After", "60");
      res.status(e.status || 400).json({ error: { message: e.message } });
    }
  });
  app.post("/api/search/resolve", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const { parsed, field, choice } = req.body;
      if (
        !["location", "work", "radius"].includes(field) ||
        !parsed?.extras ||
        !Array.isArray(parsed.questions) ||
        !Array.isArray(parsed.assumptions)
      )
        throw new Error("Invalid clarification");
      parsed.criteria = partialCriteria(parsed.criteria);
      res.json(await resolve(parsed, { field, choice }));
    } catch {
      res
        .status(400)
        .json({
          error: {
            message:
              "Could not resolve this place. Please enter a full US address or city and state.",
          },
        });
    }
  });
  app.post("/api/search/described", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await describedProvider(
        req.body,
        String(req.get("X-Client-Id") || req.ip).slice(0, 100),
      );
      res.json({ ...result, listings: visibleListings(result.listings) });
    } catch (e) {
      res.status(400).json({ error: { message: e.message } });
    }
  });
  app.post("/api/search/commute-more", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const result = await moreProvider(
        req.body?.token,
        String(req.get("X-Client-Id") || req.ip).slice(0, 100),
      );
      res.json({ ...result, listings: visibleListings(result.listings) });
    } catch (e) {
      res.status(400).json({ error: { message: e.message } });
    }
  });
  app.get("/api/insights/:module", async (req, res) => {
    try {
      const handler = Object.hasOwn(insightHandlers, req.params.module)
        ? insightHandlers[req.params.module]
        : null;
      if (!handler)
        return res.status(404).json({ error: { message: "Unknown insight" } });
      res.json(await handler(req.query));
    } catch (e) {
      res.status(503).json({ error: { message: e.message } });
    }
  });
  app.post("/api/search", async (req, res) => {
    try {
      const result = await searchProvider(req.body);
      res.json({ ...result, listings: visibleListings(result.listings) });
    } catch (e) {
      res
        .status(
          /Invalid|Enter|Choose|Minimum|HTTPS/.test(e.message) ? 400 : 503,
        )
        .json({ error: { message: e.message } });
    }
  });
  app.get("/api/autocomplete", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      res.json(
        autocomplete
          ? (await autocomplete(
              req.query.q,
              String(req.get("X-Client-Id") || req.ip).slice(0, 100),
              req.query.lat != null && req.query.lng != null
                ? { lat: Number(req.query.lat), lng: Number(req.query.lng) }
                : undefined,
            )).map(fastSuggestion)
          : [],
      );
    } catch (error) {
      if (error instanceof LookupError) {
        if (error.status === 429) res.set("Retry-After", "60");
        res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
      } else res.json([]);
    }
  });
  app.get("/api/enrich", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!enrich)
        throw new LookupError(
          503,
          "APIFY_UNAVAILABLE",
          "Zillow data unavailable right now",
        );
      const result = await enrich(req.query.address);
      if (
        normalizeListingStatus(
          result?.status || result?.listingStatus,
          "Zillow",
        ) !== "for_sale"
      )
        return res
          .status(404)
          .json({
            error: {
              code: "NOT_FOR_SALE",
              message: "No active for-sale enrichment is available.",
            },
          });
      const query = splitAddress(req.query.address),
        line1 =
          query.base.split(",")[0] + (query.unit ? " Apt " + query.unit : "");
      if (
        !exactAddress(
          { ...parseAddressText(req.query.address), line1 },
          result,
        )
      )
        return res
          .status(404)
          .json({
            error: {
              message: "No exact for-sale enrichment match is available.",
            },
          });
      res.json({ ...result, status: "for_sale" });
    } catch (error) {
      res.status(error instanceof LookupError ? error.status : 502).json({
        error: {
          code: error instanceof LookupError ? error.code : "APIFY_UNAVAILABLE",
          message: "Zillow data unavailable right now",
        },
      });
    }
  });
  app.get("/api/lookup", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      if (!lookup) {
        const v = await addressLookup(
          { text: req.query.address },
          String(req.get("X-Client-Id") || req.ip).slice(0, 100),
        );
        return res.json({
          ...v,
          ...(v.listings ? { listings: visibleListings(v.listings) } : {}),
        });
      }
      const result = await lookup(req.query.address);
      if (
        normalizeListingStatus(
          result?.listing?.status,
          "RentCast",
          result?.listing || {},
        ) !== "for_sale"
      )
        return res
          .status(404)
          .json({
            error: {
              code: "NOT_FOR_SALE",
              message:
                "This home isn't currently for sale, so we're not showing it. Try another address.",
            },
          });
      res.json({
        ...result,
        status: "for_sale",
        checkedAt: new Date().toISOString(),
      });
    } catch (error) {
      const known = error instanceof LookupError;
      if (known && error.status === 429) res.set("Retry-After", "30");
      res.status(known ? error.status : 500).json({
        error: {
          code: known ? error.code : "SERVER_ERROR",
          message: known
            ? error.message
            : "We couldn’t load this property right now. Please try again later.",
        },
      });
    }
  });
  app.use("/api", (_req, res) =>
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "API route not found." } }),
  );
  app.use((error, _req, res, _next) =>
    res
      .status(error.status === 413 ? 413 : 400)
      .json({ error: { message: "Invalid or oversized request body." } }),
  );
  return app;
}
