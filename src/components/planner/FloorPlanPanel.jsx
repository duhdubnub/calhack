import React, { useEffect, useRef, useState } from "react";
import { floorPlanApi, useAssetImage } from "../../lib/planner/floorPlanApi";
import { parseLength, planSize } from "../../lib/planner/calibration";
import PlanViewer from "./PlanViewer";
import { importFloorPlan } from "../../lib/planner/importFloorPlan";
import sampleFloorPlan from "../../lib/planner/sampleFloorPlan.json";
export function FloorPlanStatus({ state }) {
  const j = state.job;
  if (!j) return null;
  const pending = ["queued", "running", "downloading"].includes(j.status);
  const title = pending
    ? `Searching for a floor plan… ${j.elapsedSecs || 0}s`
    : j.status === "ready"
      ? `Floor plan found (${j.result?.plans?.filter((p) => p.assetId).length || 0})`
      : j.status === "not_found"
        ? "No floor plan found"
        : j.status === "capped"
          ? "Search limited right now"
          : j.status === "disabled"
            ? "Floor plan search disabled"
            : "Couldn't search for floor plans";
  return (
    <span className="floorplan-status" role="status" aria-live="polite">
      {title}{" "}
      {pending ? (
        <button onClick={state.cancel}>Cancel</button>
      ) : (
        ["error", "blocked", "capped"].includes(j.status) && (
          <button onClick={state.retry}>Retry</button>
        )
      )}
    </span>
  );
}
function Thumbnail({ plan, clientId, onOpen }) {
  const url = useAssetImage(plan.assetId, clientId);
  return (
    <button className="plan-thumbnail" onClick={onOpen} disabled={!url}>
      {url ? (
        <img
          src={url}
          alt={`${plan.sample ? "Sample floor plan" : plan.floorLabel || "Floor plan"} preview`}
        />
      ) : (
        <span>Preview unavailable</span>
      )}
    </button>
  );
}
export default function FloorPlanPanel({
  state,
  clientId,
  homeId,
  address,
  floorPlan,
  onChange,
  onKeepEstimated,
  onRooms,
  onCalibrate,
  onCeilingChange,
  onConverted,
}) {
  const [selected, setSelected] = useState(null),
    [pending, setPending] = useState([]),
    [error, setError] = useState(""),
    [uploading, setUploading] = useState(false),
    input = useRef();
  const [converters, setConverters] = useState([]),
    [converting, setConverting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    floorPlanApi(clientId, "/converters")
      .then((c) => {
        if (!cancelled) setConverters(c);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [clientId]);
  const available = converters.find((c) => c.imageBased && !c.stub);
  async function importJson(file) {
    if (!file) return;
    try {
      if (file.size > 200000) throw Error("Choose a JSON file under 200 KB.");
      const houseModel = importFloorPlan(JSON.parse(await file.text()));
      onConverted({ houseModel, warnings: [] }, "notebook-json");
      setError("");
    } catch (e) { setError(e.message); }
  }
  async function convertPlan(p, saved) {
    if (!available || (!saved?.calibration && !available.automaticScale)) return;
    setConverting(true);
    try {
      const result = await floorPlanApi(clientId, `/${p.assetId}/convert`, {
        method: "POST",
        body: JSON.stringify({
          converter: available.id,
          calibration: saved?.calibration,
          rotationDeg: saved?.rotationDeg || 0,
          levelIndex: saved?.levelIndex ?? 0,
          ceilingHeightIn: floorPlan.ceilingHeightIn,
          listingFacts: state.job?.result?.listingFacts,
        }),
      });
      onConverted(result, available.id, p, saved);
      setError(result.warnings.join(" "));
    } catch (e) {
      setError(e.message);
    } finally {
      setConverting(false);
    }
  }
  const chosen =
    state.plans.find((p) => p.assetId === selected) ||
    pending.find((p) => p.assetId === selected);
  async function upload(file) {
    if (!file) return;
    setError("");
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a file up to 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const r = await floorPlanApi(clientId, "/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      setPending(r.plans);
      setSelected(r.plans[0]?.assetId);
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading(false);
      input.current.value = "";
    }
  }
  return (
    <aside
      className="planner-panel floorplan-panel"
      aria-label="Floor plan panel"
    >
      <h2>Floor plan</h2>
      <p className="small-note">
        {homeId === "demo" || homeId?.startsWith("custom-")
          ? "Upload your own plan or use the labeled sample. No address lookup runs for this home."
          : "We look up public listings for this address to find a floor plan."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const n = parseLength(new FormData(e.currentTarget).get("ceiling"));
            if (n < 72 || n > 240)
              throw Error("Ceiling height must be 6–20 ft.");
            onCeilingChange(n);
            setError("");
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <label>
          Ceiling height (
          {floorPlan.ceilingSource === "listing"
            ? "from listing"
            : floorPlan.ceilingSource === "user"
              ? "set by you"
              : "default"}
          )
          <input
            key={floorPlan.ceilingHeightIn}
            name="ceiling"
            defaultValue={floorPlan.ceilingHeightIn / 12}
            placeholder="8 ft or 2.44 m"
          />
        </label>
        <button>Set ceiling height</button>
      </form>
      {state.job?.message && <p>{state.job.message}</p>}
      <label>
        Import an existing 3D floor plan (plan1_clean.json, feet or inches)
        <input type="file" accept=".json,application/json" onChange={e => { importJson(e.target.files[0]); e.target.value = ""; }} />
      </label>
      {!available && <p className="small-note">Image conversion needs the local CubiCasa model configured on the server. You can import your notebook JSON now.</p>}
      {homeId === "demo" && <button onClick={() => onConverted({ houseModel: importFloorPlan(sampleFloorPlan), warnings: [] }, "sample-json")}>Try sample 3D floor plan</button>}
      <label>
        Upload your own floor plan (PNG, JPG, WebP or PDF, up to 10 MB)
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          disabled={uploading}
          onChange={(e) => upload(e.target.files[0])}
        />
      </label>
      {uploading && <p role="status">Preparing your preview…</p>}
      {error && <p role="alert">{error}</p>}
      {pending.length > 0 && (
        <section>
          <h3>Confirm uploaded pages</h3>
          <p>Select a page to preview, then add the pages you want.</p>
          {pending.map((p) => (
            <div key={p.assetId}>
              <button onClick={() => setSelected(p.assetId)}>
                Preview page {p.floorLabel}
              </button>
              <button
                onClick={() => {
                  state.setPlans((old) => [...old, p]);
                  onChange?.(p, {});
                  setPending((old) =>
                    old.filter((x) => x.assetId !== p.assetId),
                  );
                }}
              >
                Use this page
              </button>
            </div>
          ))}
          <button
            onClick={() => {
              pending.forEach((p) =>
                floorPlanApi(clientId, "/uploads/" + p.assetId, {
                  method: "DELETE",
                }).catch(() => {}),
              );
              setPending([]);
              setSelected(null);
            }}
          >
            Cancel upload
          </button>
        </section>
      )}
      {homeId === "demo" && (
        <button
          onClick={() => state.sample().catch((e) => setError(e.message))}
        >
          Use sample floor plan
        </button>
      )}
      <div className="floorplan-fallbacks">
        <button onClick={onKeepEstimated}>Keep the estimated layout</button>
        <button onClick={onRooms}>Enter room sizes</button>
      </div>
      {state.plans.map((p, i) => {
        const saved = floorPlan?.plans?.find((s) => s.assetId === p.assetId);
        return (
          <article className="floorplan-card" key={p.assetId || i}>
            {p.assetId ? (
              <Thumbnail
                plan={p}
                clientId={clientId}
                onOpen={() => setSelected(p.assetId)}
              />
            ) : (
              <p>
                {p.reason ||
                  "Preview unavailable. Upload a screenshot instead."}
              </p>
            )}
            <strong>
              {p.sample ? "Sample floor plan" : p.floorLabel || "Floor plan"}
            </strong>
            {p.confidence != null && (
              <span>
                {" "}
                · {Math.round(p.confidence * 100)}% detection confidence
              </span>
            )}
            {p.assetId && (
              <label>
                Assign floor
                <select
                  value={
                    saved?.levelIndex ??
                    (/basement/i.test(p.floorLabel)
                      ? 3
                      : Math.max(
                          0,
                          Math.min(
                            2,
                            (Number(p.floorLabel?.match(/\d+/)?.[0]) || 1) - 1,
                          ),
                        ))
                  }
                  onChange={(e) =>
                    onChange?.(p, { levelIndex: +e.target.value })
                  }
                >
                  {["Level 1", "Level 2", "Level 3", "Basement"].map((s, n) => (
                    <option key={s} value={n}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <p className="small-note">
              Floor plan from{" "}
              {p.sourcePageUrl ? (
                <a
                  href={p.sourcePageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.sourceName || "listing source"}
                </a>
              ) : (
                p.sourceName || "listing source"
              )}
              . For your personal evaluation only.
            </p>
            {p.assetId && (
              <button
                onClick={() => {
                  setSelected(p.assetId);
                  onCalibrate?.(p);
                }}
              >
                {saved?.calibration
                  ? "Re-calibrate"
                  : "Set the scale to use this plan"}
              </button>
            )}
            {saved?.calibration && (
              <p>
                This plan covers about{" "}
                {(planSize(p, saved).widthIn / 12).toFixed(1)} ft by{" "}
                {(planSize(p, saved).depthIn / 12).toFixed(1)} ft.
              </p>
            )}
            <button
              disabled={!available || (!saved?.calibration && !available.automaticScale) || converting}
              aria-disabled={!available || (!saved?.calibration && !available.automaticScale) || converting}
              onClick={() => convertPlan(p, saved)}
              title="Detect walls, doors and windows. Printed dimensions can set the scale automatically; you can also calibrate it yourself."
            >
              {converting
                ? "Analyzing floorplan…"
                : available
                  ? "Convert to 3D"
                  : "Convert to 3D · Coming soon"}
            </button>
            {converting && <p className="conversion-progress" role="status">Detecting walls, doors and windows. This can take up to three minutes.</p>}
          </article>
        );
      })}
      {chosen && (
        <PlanViewer
          plan={chosen}
          saved={floorPlan.plans.find((p) => p.assetId === chosen.assetId)}
          onChange={
            pending.some((p) => p.assetId === chosen.assetId) ? null : onChange
          }
          clientId={clientId}
          address={address}
          onClose={() => setSelected(null)}
        />
      )}
    </aside>
  );
}
