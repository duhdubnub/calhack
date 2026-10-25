import tzLookup from "tz-lookup";
import { runActor } from "./actor.js";
import { ACTORS } from "../config/apify.js";
import { config, serverDirectory } from '../config.js';
import { persistentMemo } from '../storage/memo.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
export function nextTuesday(lat, lng, now = new Date()) {
  const timezone = tzLookup(lat, lng);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (k) => parts.find((p) => p.type === k).value;
  const date = new Date(
    Date.UTC(Number(get("year")), Number(get("month")) - 1, Number(get("day"))),
  );
  date.setUTCDate(date.getUTCDate() + ((2 - date.getUTCDay() + 7) % 7 || 7));
  return { date: date.toISOString().slice(0, 10), timezone };
}
export function normalizeTrip(row) {
  if (
    row?.status !== "OK" ||
    !Number.isFinite(row.durationInTrafficSeconds ?? row.durationSeconds) ||
    (row.durationInTrafficSeconds ?? row.durationSeconds) < 0
  )
    throw new Error("Commute data unavailable for this route");
  return {
    minutes: Math.round(
      (row.durationInTrafficSeconds ?? row.durationSeconds) / 60,
    ),
    miles:
      typeof row.distanceMeters === "number"
        ? Math.round((row.distanceMeters / 1609.344) * 10) / 10
        : null,
    range: row.typicalRangeText || null,
    trafficLevel: row.trafficLevel || null,
  };
}
export function routeKey(p) {
  return [ACTORS.commute, ...[p.lat,p.lng,p.workLat,p.workLng].map(n => Number(n.toFixed(3))), p.departAt || '08:00', 'Tuesday', 'driving'];
}
export function createDirectionsBatch({ runner = runActor, cache = persistentMemo(join(serverDirectory, '.cache', 'commute-routes-v1.json'), {cacheErrors:false}), fixtureMode = () => config.useFixtures, enabled = () => config.enableApify } = {}) {
  let waiting = [], scheduled = false;
  async function flush() {
    const pending = waiting; waiting = []; scheduled = false;
    // Date/time apply to the entire Actor run, not individual route objects.
    // Keep morning, evening and off-peak predictions in separate scheduled runs.
    const schedules = new Map();
    for (const entry of pending) {
      const date = nextTuesday(entry.p.lat, entry.p.lng).date;
      const time = entry.p.departAt || '08:00';
      const key = `${date}T${time}`;
      if (!schedules.has(key)) schedules.set(key, { date, time, entries: [] });
      schedules.get(key).entries.push(entry);
    }
    for (const { date, time, entries } of schedules.values()) {
    for (let start = 0; start < entries.length; start += 12) {
      const group = entries.slice(start, start + 12);
      const routes = group.map(({ p }, i) => ({ origin: `${p.lat},${p.lng}`, destination: `${p.workLat},${p.workLng}`, label: `route-${i}` }));
      try {
        const rows = await runner(ACTORS.commute, { routes, travelModes: ['driving'], timeMode: 'depart_at', travelDate: date, travelTime: time, maxRoutes: 1, maxResults: routes.length, outputFormat: 'request', maxConcurrency: 2, includeSteps: false, includePolyline: false }, { limit: routes.length });
        group.forEach(({ resolve, reject }, i) => { try { const row = rows.find(r => r.label === routes[i].label); resolve({ ...normalizeTrip(row), date: nextTuesday(group[i].p.lat,group[i].p.lng).date, timezone: nextTuesday(group[i].p.lat,group[i].p.lng).timezone, usingFixtures: false }); } catch { reject(new Error('Commute data unavailable for this route')); } });
      } catch { group.forEach(({reject}) => reject(new Error('Commute provider unavailable or hourly cap reached. Try again later.'))); }
    }
    }
  }
  return async function batch(params) {
    if (params.length > 12) throw new Error('Commute batch limit is 12 routes');
    if (fixtureMode()) {
      const fixtures = JSON.parse(await readFile(join(serverDirectory, 'fixtures', 'commute-verification.json'), 'utf8'));
      return params.map(p => {
        const match = fixtures.find(f => {
          const route = f.input?.routes?.[0];
          return route?.origin === `${p.lat},${p.lng}` && route?.destination === `${p.workLat},${p.workLng}` && f.input.travelTime === (p.departAt || '08:00');
        });
        return match ? { ...normalizeTrip({ ...match, status: 'OK' }), usingFixtures: true, date: match.input.travelDate } : { error: 'Commute not verified (sample data)', usingFixtures: true };
      });
    }
    if (!enabled()) return params.map(() => ({ error: 'Commute provider disabled' }));
    return Promise.all(params.map(p => cache(routeKey(p), () => new Promise((resolve, reject) => {
      waiting.push({ p, resolve, reject });
      if (!scheduled) { scheduled = true; setTimeout(() => { void flush(); }, 0); }
    }), 7 * 86400000).catch(() => ({ error: 'Commute provider unavailable or hourly cap reached. Try again later.' }))));
  };
}
export const commuteBatch = createDirectionsBatch();
export async function commuteProvider(p) {
  const { date, timezone } = nextTuesday(p.lat, p.lng),
    home = p.lat + "," + p.lng,
    work = p.workLat + "," + p.workLng;
  async function query(time, routes) {
    const result = await commuteBatch(routes.map(r => {
      const [lat,lng] = r.origin.split(',').map(Number), [workLat,workLng] = r.destination.split(',').map(Number);
      return { lat,lng,workLat,workLng,departAt: time };
    }));
    if (result.some(r => r.error)) throw new Error('Commute data unavailable');
    return result.map((r,i) => ({ ...r, label: routes[i].label, status: 'OK', durationInTrafficSeconds: r.minutes * 60, distanceMeters: r.miles == null ? undefined : r.miles * 1609.344, typicalRangeText: r.range }));
  }
  const forward = { origin: home, destination: work, label: "home-to-work" },
    back = { origin: work, destination: home, label: "work-to-home" };
  const [morning, evening, offpeak] = await Promise.all([
    query("08:00", [forward]),
    query("17:30", [back]),
    query("03:00", [forward, back]),
  ]);
  const am = normalizeTrip(morning[0]),
    pm = normalizeTrip(evening[0]);
  const offAm = normalizeTrip(
      offpeak.find((r) => r.label === forward.label) || offpeak[0],
    ),
    offPm = normalizeTrip(
      offpeak.find((r) => r.label === back.label) || offpeak[1],
    );
  return {
    source: "Google Maps via Apify (rastriq)",
    date,
    timezone,
    morning: {
      ...am,
      offPeak: offAm.minutes,
      extraMinutes: am.minutes - offAm.minutes,
    },
    evening: {
      ...pm,
      offPeak: offPm.minutes,
      extraMinutes: pm.minutes - offPm.minutes,
    },
    note: "Traffic-pattern predictions, not live traffic. Morning departs home at 8 AM; evening departs work at 5:30 PM, each in its origin’s local time. Off-peak comparisons depart at 3 AM.",
  };
}
