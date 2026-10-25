import React, { useEffect, useRef, useState } from "react";
import { usePreferences, MODULES } from "../../lib/Preferences";
import { num } from "./ListingGrid";
import { CRIME_ACTOR_BUILD } from '../../../server/config/apify';
export function InsightBody({ type, data: d }) {
  if (type === "crime")
    return (
      <>
        <span className="grade">{d.safetyScore != null ? `${num(d.safetyScore)} / 10` : "N/A"}</span>
        <p>Safety score · 10 is safest</p>
        {d.area && <p className="small-note">{d.area}</p>}
        <p>Violent crimes per 100,000 residents: {num(d.violentPer100k)}</p>
        {d.latestYear && <p className="small-note">Data year: {d.latestYear}</p>}
      </>
    );
  if (type === "hazards")
    return (
      <>
        <span className="grade">{d.rating || "N/A"}</span>
        <ul>
          {d.hazards?.map((h) => (
            <li key={h.hazard}>
              {h.hazard}: <strong>{h.rating || "N/A"}</strong>
            </li>
          ))}
        </ul>
        <p>
          <strong>Insurance considerations</strong>
          <br />
          {d.insuranceNote}
        </p>
        <p className="small-note">{d.note}</p>
      </>
    );
  if (type === "schools")
    return (
      <>
        <p>
          Average rating: <strong>{num(d.average)} / 10</strong>
        </p>
        <ul className="school-list">
          {d.schools?.map((s) => (
            <li key={s.name}>
              <span
                className={
                  s.rating >= 7
                    ? "rating good"
                    : s.rating >= 4
                      ? "rating medium"
                      : "rating"
                }
              >
                {num(s.rating)}/10
              </span>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {s.level || "N/A"} · Grades {s.grades || "N/A"} ·{" "}
                  {num(s.distance)} miles
                </small>
              </div>
            </li>
          ))}
        </ul>
        <p className="small-note">{d.note}</p>
      </>
    );
  if (type === "commute")
    return (
      <>
        <p className="small-note">
          Tuesday {d.date} · {d.timezone}
        </p>
        {["morning", "evening"].map((k) => (
          <div className="commute-trip" key={k}>
            <h4>
              {k === "morning" ? "8 AM · Home → work" : "5:30 PM · Work → home"}
            </h4>
            <strong>{num(d[k]?.minutes)} min</strong>
            <p>
              {num(d[k]?.miles)} miles · Typical: {d[k]?.range || "N/A"}
            </p>
            <small>
              3 AM: {num(d[k]?.offPeak)} min · Difference:{" "}
              {num(d[k]?.extraMinutes)} min
            </small>
          </div>
        ))}
        <p className="small-note">{d.note}</p>
      </>
    );
  if (type === "groceries")
    return (
      <>
        <ol className="grocery-list">
          {d.stores?.map((s, i) => (
            <li key={i}>
              <strong>{s.name}</strong>
              <span>{num(s.miles)} mi</span>
              <small>
                {s.brand || ""} {s.address || "Address N/A"}
              </small>
            </li>
          ))}
        </ol>
        {!d.stores?.length && <p>No stores found within 15 km.</p>}
        <p className="small-note">{d.note}</p>
      </>
    );
  return <p>{d.note || "No additional data available."}</p>;
}
function InsightCard({ type, listing, onData, snapshot }) {
  const { work } = usePreferences(),
    [state, setState] = useState({ data: type === "crime" && (snapshot?.safetyScore == null || snapshot?.actorBuild !== CRIME_ACTOR_BUILD) ? null : snapshot || null }),
    [retry, setRetry] = useState(0);
  const missing = type === "commute" && !Number.isFinite(work?.lat);
  const q = {
    listingId: listing.id,
    address: [listing.address, listing.city, [listing.state, listing.zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", "),
    url: listing.zillowUrl || "",
    zip: listing.zip || "",
    city: listing.city || "",
    state: listing.state || "",
    lat: listing.lat ?? "",
    lng: listing.lng ?? "",
    workLat: work?.lat ?? "",
    workLng: work?.lng ?? "",
  };
  const key = JSON.stringify(q);
  const previousKey = useRef(key);
  useEffect(() => {
    if (missing) return;
    const controller = new AbortController();
    const changed = previousKey.current !== key;
    previousKey.current = key;
    setState((old) => ({
      ...(changed ? {} : old),
      loading: true,
      error: null,
    }));
    fetch(
      "/api/insights/" + type + "?" + new URLSearchParams({...JSON.parse(key), ...(retry ? {retry:"1"} : {})}),
      { signal: controller.signal },
    )
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error?.message || "Data unavailable");
        if (!controller.signal.aborted) {
          setState({ data: d });
          onData?.(type, d);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setState((old) => ({ ...old, loading: false, error: e.message }));
      });
    return () => controller.abort();
  }, [type, key, retry, missing]);
  return (
    <article className="card insight-card" aria-busy={state.loading || false}>
      <h3>{MODULES[type]}</h3>
      {missing ? (
        <p>Add a work address above and choose a suggestion.</p>
      ) : (
        <>
          {state.loading && (
            <div className="module-skeleton" role="status">
              Loading {MODULES[type].toLowerCase()}…
            </div>
          )}
          {state.error && (
            <div className="insight-error" role="status">
              <p>{state.error}</p>
              <button
                className="quiet-button"
                onClick={() => setRetry((n) => n + 1)}
              >
                Retry
              </button>
              <small>{state.data ? "Showing the last available result." : "Try again to request an updated result."}</small>
            </div>
          )}
          {state.data && (
            <>
              {state.data.usingFixtures && (
                <p className="sample-badge">Sample data</p>
              )}
              {state.data.sampleNotice && (
                <p className="small-note">{state.data.sampleNotice}</p>
              )}
              <InsightBody type={type} data={state.data} />
              <p className="insight-source">Source: {state.data.source}</p>
            </>
          )}
        </>
      )}
      {!state.data && (
        <p className="insight-source">
          Source:{" "}
          {
            {
              crime: "Neighborhood Crime Safety via Apify · SpotCrime",
              hazards: "FEMA National Risk Index",
              schools: "GreatSchools in Zillow via Apify",
              commute: "Google Maps via Apify",
              groceries: "OpenStreetMap via Overpass",
            }[type]
          }
        </p>
      )}
    </article>
  );
}
export default function InsightModules({ listing, onData, snapshots = {} }) {
  const { modules } = usePreferences();
  return (
    <div className="insight-grid">
      {modules.map((type) => (
        <InsightCard
          key={listing.id + type}
          type={type}
          listing={listing}
          onData={onData}
          snapshot={snapshots[type]}
        />
      ))}
    </div>
  );
}
