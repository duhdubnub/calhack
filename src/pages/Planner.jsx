import {
  validateFloorPlan,
  transformPlacements,
} from "../lib/planner/calibration";
import FloorPlanPanel, {
  FloorPlanStatus,
} from "../components/planner/FloorPlanPanel";
import { planHouse, resolvePlannerHouse } from "../lib/planner/planHouse";
import { useAssetImage, useFloorPlans } from "../lib/planner/floorPlanApi";
import "../styles/floorplan.css";
import RoomPanel from "../components/planner/RoomPanel";
import { demoPlacements } from "../lib/planner/demo";
import AddFurniture from "../components/planner/AddFurniture";
import { plannerApi, localRead, localWrite } from "../lib/planner/persistence";
import FurnitureModel from "../components/planner/FurnitureModel";
import FurniturePanel from "../components/planner/FurniturePanel";
import FurnitureLibrary from "../components/planner/FurnitureLibrary";
import { catalog } from "../lib/planner/catalog";
import {
  warningsFor,
  clampPlacement,
  fitMessage,
} from "../lib/planner/collisions";
import { pushHistory, undo, redo } from "../lib/planner/history";
import React, { useMemo, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useFavorites } from "../lib/Favorites";
import { generateHouse } from "../lib/planner/houseGenerator";
import {
  readSession,
  writeSession,
  snapshotKey,
} from "../lib/planner/listingSnapshot";
import Scene from "../components/planner/Scene";
import { money } from "../components/search/ListingGrid";
import "../styles/planner.css";
const demo = {
  id: "demo",
  address: "The demo house",
  sqft: 1500,
  beds: 3,
  baths: 2,
  stories: 1,
};
export default function Planner() {
  const { homeId } = useParams();
  return <PlannerHome key={homeId || "chooser"} />;
}
function PlannerHome() {
  const { homeId } = useParams(),
    location = useLocation(),
    navigate = useNavigate(),
    { favorites, loading, clientId } = useFavorites();
  const [recoveredSnapshot, setRecoveredSnapshot] = useState(null);
  const snapshot = useMemo(
    () =>
      location.state?.snapshot ||
      (homeId === "demo" ? demo : readSession(snapshotKey(homeId))) ||
      favorites.find((f) => f.id === homeId) ||
      recoveredSnapshot,
    [homeId, location.state, favorites, recoveredSnapshot],
  );
  const [customText, setCustomText] = useState("");
  const [mobilePanel, setMobilePanel] = useState("");
  const [custom, setCustom] = useState({
      sqft: 1500,
      beds: 3,
      baths: 2,
      stories: 1,
    }),
    [view, setView] = useState(() => (window.innerWidth < 768 ? "2D" : "3D")),
    [level, setLevel] = useState(0),
    [fullWalls, setFullWalls] = useState(false),
    [roomId, setRoomId] = useState(""),
    [overrides, setOverrides] = useState({}),
    [dismissed, setDismissed] = useState(false);
  const [floorPlan, setFloorPlan] = useState({
    mode: "estimated",
    ceilingHeightIn: 96,
    ceilingSource: "default",
    plans: [],
  });
  const floorPlans = useFloorPlans({
    snapshot,
    homeId,
    clientId,
    savedPlans: floorPlan.plans,
  });
  function updatePlan(plan, patch) {
    const previous = floorPlan.plans.find((p) => p.assetId === plan.assetId);
    const next = {
      assetId: plan.assetId,
      levelIndex: /basement/i.test(plan.floorLabel)
        ? 3
        : Math.max(
            0,
            Math.min(2, (Number(plan.floorLabel?.match(/\d+/)?.[0]) || 1) - 1),
          ),
      rotationDeg: 0,
      calibration: null,
      ...previous,
      ...patch,
    };
    if (previous?.calibration && next.calibration)
      setHistory((h) => ({
        past: [],
        future: [],
        present: transformPlacements(h.present, plan, previous, next),
      }));
    const plans = [
      ...floorPlan.plans.filter(
        (p) =>
          p.assetId !== plan.assetId &&
          (!next.calibration ||
            p.levelIndex !== next.levelIndex ||
            !p.calibration),
      ),
      next,
    ];
    setFloorPlan((old) => ({
      ...old,
      convertedHouseModel: undefined,
      houseModelSource: undefined,
      mode: patch.calibration
        ? "plan"
        : plans.some((p) => p.calibration)
          ? old.mode
          : "estimated",
      plans,
    }));
    if (next.calibration) setLevel(next.levelIndex);
  }
  const heading = useRef(),
    project = useRef();
  const estimatedHouse = useMemo(
    () => generateHouse({ ...snapshot, seed: homeId }, overrides),
    [snapshot, homeId, overrides],
  );
  const imageHouse = useMemo(
    () => planHouse(floorPlan, floorPlans.plans),
    [floorPlan, floorPlans.plans],
  );
  const house = useMemo(
    () => resolvePlannerHouse(estimatedHouse, floorPlan, floorPlans.plans),
    [estimatedHouse, floorPlan, floorPlans.plans],
  );
  const inPlanMode = house.source === "floorplan";
  const converted = inPlanMode && !house.floors[0].openPlan;
  const floor = house.floors.find((f) => f.level === level) || house.floors[0];
  const activePlan = inPlanMode
    ? floorPlan.plans.find((p) => p.levelIndex === floor.level && p.calibration)
    : null;
  const activeAsset = floorPlans.plans.find(
    (p) => p.assetId === activePlan?.assetId,
  );
  const planUrl = useAssetImage(activeAsset?.assetId, clientId);
  const [history, setHistory] = useState({ past: [], present: [], future: [] }),
    [selected, setSelected] = useState(""),
    [snap, setSnap] = useState(3),
    [announcement, setAnnouncement] = useState("");
  const [library, setLibrary] = useState([]),
    [ready, setReady] = useState(false),
    [saveStatus, setSaveStatus] = useState("Loading saved layout..."),
    [editing, setEditing] = useState(null),
    [savedLayouts, setSavedLayouts] = useState([]);
  const revision = useRef(0),
    saveQueue = useRef(Promise.resolve()),
    deletedFurniture = useRef(new Set());
  useEffect(() => {
    let cancelled = false;
    async function load() {
      let lib = localRead(clientId + ".library") || [],
        saved = localRead(clientId + "." + homeId);
      try {
        const [remoteLib, remoteLayout, all] = await Promise.all([
          plannerApi(clientId, "/furniture"),
          homeId
            ? plannerApi(
                clientId,
                "/planner/layouts/" + encodeURIComponent(homeId),
              )
            : null,
          plannerApi(clientId, "/planner/layouts"),
        ]);
        lib = [
          ...remoteLib.filter(
            (r) => !lib.some((l) => l.id === r.id && l.localDirty),
          ),
          ...lib.filter(
            (l) => l.localDirty || !remoteLib.some((r) => r.id === l.id),
          ),
        ];
        if (!saved || !saved.localDirty) saved = remoteLayout || saved;
        setSavedLayouts(all);
        setSaveStatus("Saved");
      } catch {
        setSaveStatus("Saved locally only - server unavailable.");
      }
      if (cancelled) return;
      if (saved?.homeSnapshot) setRecoveredSnapshot(saved.homeSnapshot);
      setLibrary(lib);
      localWrite(clientId + ".library", lib);
      setOverrides(saved?.roomOverrides || {});
      setFloorPlan(validateFloorPlan(saved?.floorPlan));
      const defs = [...catalog, ...lib];
      let placed = (
        saved?.placements ||
        (homeId === "demo"
          ? demoPlacements(generateHouse({ ...demo, seed: "demo" }))
          : [])
      )
        .map((p) => ({ ...defs.find((d) => d.id === p.furnitureId), ...p }))
        .map((p) =>
          p.name
            ? p
            : {
                ...p,
                name: "Unavailable furniture — restore its library definition",
                category: "storage",
                widthIn: p.widthIn || 36,
                depthIn: p.depthIn || 24,
                heightIn: p.heightIn || 30,
                color: "#c86c50",
              },
        );
      if (homeId === "demo") {
        const demoHouse = resolvePlannerHouse(generateHouse({ ...demo, seed: "demo" }, saved?.roomOverrides || {}), validateFloorPlan(saved?.floorPlan), []);
        const demoFloor = demoHouse.floors[0];
        if (warningsFor(placed.filter(p=>p.level === demoFloor.level), demoFloor).some(w=>w.ids.some(id=>id.startsWith("demo-item-")))) {
          const customItems = placed.filter(p=>!p.id.startsWith("demo-item-"));
          placed = [...customItems, ...demoPlacements(demoHouse, customItems)];
        }
      }
      setHistory({ past: [], present: placed, future: [] });
      setReady(true);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [homeId, clientId]);
  useEffect(() => {
    if (!ready || !homeId || !snapshot) return;
    const version = ++revision.current;
    const data = {
      homeId,
      homeSnapshot: snapshot,
      roomOverrides: overrides,
      floorPlan,
      placements: history.present.map(
        ({
          id,
          furnitureId,
          level,
          xIn,
          zIn,
          rotationDeg,
          colorOverride,
          widthIn,
          depthIn,
          heightIn,
        }) => ({
          id,
          furnitureId,
          level,
          xIn,
          zIn,
          rotationDeg,
          colorOverride,
          widthIn,
          depthIn,
          heightIn,
        }),
      ),
      updatedAt: new Date().toISOString(),
      localDirty: true,
    };
    const localOk = localWrite(clientId + "." + homeId, data);
    setSaveStatus("Saving...");
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current
        .catch(() => {})
        .then(async () => {
          try {
            for (const def of library.filter(d=>!deletedFurniture.current.has(d.id)))
              await plannerApi(clientId, "/furniture", {
                method: "POST",
                body: JSON.stringify(def),
              });
            await plannerApi(
              clientId,
              "/planner/layouts/" + encodeURIComponent(homeId),
              { method: "PUT", body: JSON.stringify(data) },
            );
            if (revision.current === version) {
              localWrite(clientId + "." + homeId, {
                ...data,
                localDirty: false,
              });
              setSaveStatus("Saved");
            }
          } catch (e) {
            if (revision.current === version)
              setSaveStatus(
                (localOk ? "Saved locally only: " : "NOT SAVED: ") + e.message,
              );
          }
        });
    }, 650);
    return () => clearTimeout(timer);
  }, [
    history.present,
    overrides,
    floorPlan,
    ready,
    homeId,
    snapshot,
    library,
    clientId,
  ]);
  useEffect(() => {
    const ft = floorPlans.job?.result?.listingFacts?.ceilingHeightFt;
    if (ready && Number.isFinite(ft) && ft >= 6 && ft <= 20)
      setFloorPlan((p) =>
        p.ceilingSource === "default"
          ? { ...p, ceilingHeightIn: ft * 12, ceilingSource: "listing" }
          : p,
      );
  }, [ready, floorPlans.job?.result?.listingFacts?.ceilingHeightFt]);
  async function saveFurniture(def) {
    if (!library.some((d) => d.id === def.id && !d.archived) && library.filter(d=>!d.archived).length >= 50) {
      setAnnouncement("Maximum 50 library items. Delete an item first.");
      return false;
    }
    const next = [
      ...library.filter((d) => d.id !== def.id),
      { ...def, localDirty: true },
    ];
    const ok = localWrite(clientId + ".library", next);
    try {
      await plannerApi(clientId, "/furniture", {
        method: "POST",
        body: JSON.stringify(def),
      });
      next[next.length - 1].localDirty = false;
      localWrite(clientId + ".library", next);
    } catch (e) {
      setAnnouncement(
        (ok ? "Saved locally only: " : "NOT SAVED: ") + e.message,
      );
      if (!ok) return false;
    }
    setLibrary(next);
    deletedFurniture.current.delete(def.id);
    setHistory((h) => ({
      ...h,
      present: h.present.map((p) =>
        p.furnitureId === def.id
          ? { ...p, name: def.name, category: def.category, color: def.color }
          : p,
      ),
    }));
    return true;
  }
  async function deleteFurniture(id) {
    deletedFurniture.current.add(id);
    try {
      const preserve = [history.present,...history.past,...history.future].some(placements=>placements.some(p=>p.furnitureId === id));
      const deletion = saveQueue.current.catch(()=>{}).then(()=>
        plannerApi(clientId, "/furniture/" + encodeURIComponent(id) + (preserve ? "?preserveDefinition=true" : ""), {method:"DELETE"})
      );
      saveQueue.current = deletion;
      const saved = await deletion;
      const retained = saved.find(d=>d.id === id);
      const next = library.flatMap(d=>d.id === id ? retained ? [retained] : [] : [d]);
      localWrite(clientId + ".library", next);
      setLibrary(next);
      setAnnouncement("Deleted from your library. Placed copies are kept.");
    } catch (e) {
      deletedFurniture.current.delete(id);
      setAnnouncement("Could not delete: " + e.message);
      throw e;
    }
  }
  const items = history.present.filter((i) => i.level === floor.level),
    warnings = warningsFor(items, floor);
  function change(next) {
    setHistory((h) =>
      pushHistory(h, typeof next === "function" ? next(h.present) : next),
    );
  }
  function update(id, patch) {
    for (const key of ["widthIn", "depthIn", "heightIn"])
      if (key in patch)
        patch[key] = Math.max(
          key === "heightIn" ? 0.1 : 1,
          Math.min(key === "heightIn" ? 240 : 600, Number(patch[key]) || 1),
        );
    change((old) =>
      old.map((i) =>
        i.id === id
          ? clampPlacement({ ...i, ...patch }, { ...i, ...patch }, floor)
          : i,
      ),
    );
  }
  function remove(id) {
    change((old) => old.filter((i) => i.id !== id));
    setSelected("");
  }
  function add(def, room, point) {
    if (history.present.length >= 80) {
      setAnnouncement("Maximum 80 items per layout.");
      return;
    }
    const item = {
      ...def,
      id: crypto.randomUUID(),
      furnitureId: def.id,
      level: floor.level,
      xIn: point?.x != null ? point.x * 12 : room.x + room.widthIn / 2,
      zIn: point?.z != null ? point.z * 12 : room.z + room.depthIn / 2,
      rotationDeg: 0,
    };
    change((old) => [...old, item]);
    setSelected(item.id);
    setAnnouncement(def.name + " added. " + fitMessage(def, room));
  }
  function duplicate(item) {
    if (history.present.length >= 80) return;
    const copy = clampPlacement(
      {
        ...item,
        id: crypto.randomUUID(),
        xIn: item.xIn + 6,
        zIn: item.zIn + 6,
      },
      item,
      floor,
    );
    change((old) => [...old, copy]);
    setSelected(copy.id);
  }
  useEffect(() => {
    heading.current?.focus();
  }, [homeId, ready]);
  useEffect(() => {
    function key(e) {
      if (e.target.closest("input,textarea,select,dialog,[contenteditable]:not([contenteditable='false'])") || !homeId) return;
      const item = history.present.find((i) => i.id === selected);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setHistory(e.shiftKey ? redo : undo);
        return;
      }
      if (e.key === "Escape") setSelected("");
      if (!item || item.level !== floor.level) return;
      const step = e.shiftKey ? 6 : 1,
        rot = e.shiftKey ? 90 : 15;
      const actions = {
        ArrowLeft: () => update(item.id, { xIn: item.xIn - step }),
        ArrowRight: () => update(item.id, { xIn: item.xIn + step }),
        ArrowUp: () => update(item.id, { zIn: item.zIn - step }),
        ArrowDown: () => update(item.id, { zIn: item.zIn + step }),
        "[": () => update(item.id, { rotationDeg: item.rotationDeg - rot }),
        "]": () => update(item.id, { rotationDeg: item.rotationDeg + rot }),
        "{": () => update(item.id, { rotationDeg: item.rotationDeg - rot }),
        "}": () => update(item.id, { rotationDeg: item.rotationDeg + rot }),
        Delete: () => remove(item.id),
      };
      if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        update(item.id, { rotationDeg: item.rotationDeg + rot });
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicate(item);
      } else if (actions[e.key]) {
        e.preventDefault();
        actions[e.key]();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [history, selected, floor, homeId]);
  function open(s) {
    writeSession(snapshotKey(s.id), s);
    navigate("/planner/" + s.id, { state: { snapshot: s } });
  }
  if (!homeId || !snapshot)
    return (
      <main id="main" className="container planner-chooser">
        <h1 ref={heading} tabIndex={-1}>
          Try your furniture
        </h1>
        <p>Explore how your furniture could fit before you move.</p>
        {homeId && (
          <p role="status">
            {loading
              ? "Looking for your saved home…"
              : "This home is not saved in this browser. Choose a home below."}
          </p>
        )}
        <div className="chooser-grid">
          <section>
            <h2>Demo house</h2>
            <p>Sample home. No keys required.</p>
            <button onClick={() => open(demo)}>Explore the demo</button>
          </section>
          <section>
            <h2>Custom home</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const customRooms = customText.trim()
                  ? customText
                      .split("\n")
                      .slice(0, 20)
                      .map((line) => {
                        const [name, width, depth] = line.split(",");
                        return {
                          name: name.trim(),
                          type: "living",
                          widthIn: Number(width) * 12,
                          depthIn: Number(depth) * 12,
                        };
                      })
                  : undefined;
                if (
                  customRooms?.some(
                    (r) =>
                      !r.name ||
                      !Number.isFinite(r.widthIn) ||
                      r.widthIn < 36 ||
                      !Number.isFinite(r.depthIn) ||
                      r.depthIn < 36,
                  )
                ) {
                  setAnnouncement(
                    "Use one room per line: Living room, 16, 14 (feet, at least 3).",
                  );
                  return;
                }
                open({
                  ...custom,
                  customRooms,
                  id: "custom-" + crypto.randomUUID(),
                  address: "My custom home",
                });
              }}
            >
              {Object.keys(custom).map((k) => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    min={k === "beds" ? 0 : 1}
                    max={k === "sqft" ? 8000 : k === "stories" ? 3 : 10}
                    value={custom[k]}
                    onChange={(e) =>
                      setCustom({ ...custom, [k]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
              <label>
                Or enter room sizes: name, width ft, depth ft
                <textarea
                  rows={4}
                  placeholder="Living room, 16, 14"
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                />
              </label>
              <button>Create home</button>
            </form>
          </section>
          <section>
            <h2>From a saved favorite</h2>
            {favorites.length ? (
              favorites.map((f) => (
                <button key={f.id} onClick={() => open(f)}>
                  {f.address}
                </button>
              ))
            ) : (
              <p>Save a listing or start with the demo.</p>
            )}
          </section>
        </div>
        <h2>Saved layouts ({savedLayouts.length}/10)</h2>
        {savedLayouts.map((l) => (
          <article key={l.homeId}>
            <button onClick={() => open(l.homeSnapshot)}>
              {l.homeSnapshot?.address || l.homeId}
            </button>
            <button
              onClick={async () => {
                try {
                  await plannerApi(
                    clientId,
                    "/planner/layouts/" + encodeURIComponent(l.homeId),
                    { method: "DELETE" },
                  );
                  localWrite(clientId + "." + l.homeId, null);
                  setSavedLayouts(
                    savedLayouts.filter((x) => x.homeId !== l.homeId),
                  );
                } catch (e) {
                  setAnnouncement(e.message);
                }
              }}
            >
              Delete layout
            </button>
          </article>
        ))}
        <p role="status">{announcement}</p>
      </main>
    );
  if (!ready)
    return (
      <main id="main" className="container" role="status">
        Loading your layout...
      </main>
    );
  return (
    <main id="main" className="planner-page" data-panel={mobilePanel}>
      <header className="planner-header">
        {snapshot.photoUrl && (
          <img
            src={snapshot.photoUrl}
            alt="Listing"
            referrerPolicy="no-referrer"
          />
        )}
        <div>
          <p className="eyebrow">
            TRY YOUR FURNITURE {homeId === "demo" ? "· SAMPLE HOME" : ""}
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {snapshot.address}
          </h1>
          <p>
            {snapshot.price ? <>{money(snapshot.price)} · </> : null}
            {inPlanMode
              ? floorPlan.houseModelSource === "sample-json" ? "Sample 3D floor plan" : "Calibrated floor plan"
              : "Estimated layout, not the real floor plan"}
          </p>
        </div>
        <button
          onClick={() =>
            navigate(readSession("propertylens.plannerReturn")?.path || "/", {
              state: {
                plannerMessage:
                  "Return to your saved search, or find another home.",
              },
            })
          }
        >
          Back to listing
        </button>
        <Link to="/planner">Change home</Link>
        <p role="status">{saveStatus}</p>
        {saveStatus.includes("up to 10") && (
          <button
            onClick={async () => {
              try {
                const all = await plannerApi(clientId, "/planner/layouts");
                const oldest = all
                  .filter((l) => l.homeId !== homeId)
                  .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
                if (!oldest) return;
                await plannerApi(
                  clientId,
                  "/planner/layouts/" + encodeURIComponent(oldest.homeId),
                  { method: "DELETE" },
                );
                localWrite(clientId + "." + oldest.homeId, null);
                setOverrides({ ...overrides });
              } catch (e) {
                setAnnouncement(e.message);
              }
            }}
          >
            Delete oldest saved layout and retry
          </button>
        )}
        <FloorPlanStatus state={floorPlans} />
      </header>
      <div className="floorplan-switch">
        <button
          aria-expanded={mobilePanel === "floorplan"}
          onClick={() =>
            setMobilePanel(mobilePanel === "floorplan" ? "" : "floorplan")
          }
        >
          Floor plan
        </button>
      </div>
      {mobilePanel === "floorplan" && (
        <FloorPlanPanel
          state={floorPlans}
          clientId={clientId}
          homeId={homeId}
          address={snapshot.address}
          floorPlan={floorPlan}
          onCeilingChange={(height) =>
            setFloorPlan((p) => ({
              ...p,
              ceilingHeightIn: height,
              ceilingSource: "user",
            }))
          }
          onChange={updatePlan}
          onConverted={(result, converter, asset, saved) => {
            setFloorPlan((p) => ({
              ...p,
              mode: "plan",
              ceilingHeightIn: result.houseModel.ceilingHeightIn,
              ceilingSource: "user",
              convertedHouseModel: asset ? { ...result.houseModel, floors: [
                ...(p.convertedHouseModel?.floors || []).filter(f => f.level !== result.houseModel.floors[0].level),
                ...result.houseModel.floors,
              ].sort((a,b) => a.level-b.level) } : result.houseModel,
              houseModelSource: converter,
              plans: asset && result.calibration ? [
                ...p.plans.filter(plan => plan.assetId !== asset.assetId && plan.levelIndex !== result.houseModel.floors[0].level),
                { assetId: asset.assetId, levelIndex: result.houseModel.floors[0].level, rotationDeg: saved?.rotationDeg || 0,
                  calibration: result.calibration, calibratedAt: new Date().toISOString() },
              ] : asset ? p.plans : [],
            }));
            setHistory(h => {
              const customItems = h.present.filter(p=>!p.id.startsWith("demo-item-"));
              return { past: [], future: [], present: homeId === "demo" && converter === "sample-json" ? [...customItems, ...demoPlacements(result.houseModel, customItems)] : h.present };
            });
            setLevel(result.houseModel.floors[0].level);
            setFullWalls(true);
            setView("3D");
          }}
          onKeepEstimated={() => {
            setFloorPlan((p) => ({ ...p, mode: "estimated" }));
            setMobilePanel("");
          }}
          onRooms={() => {
            setFloorPlan((p) => ({ ...p, mode: "estimated" }));
            setMobilePanel("rooms");
          }}
        />
      )}
      {house.limited && !dismissed && (
        <p className="planner-notice">
          Limited listing data: using typical sizes for a 3 bed, 2 bath home.
          Adjust room sizes in the Rooms panel.{" "}
          <button onClick={() => setDismissed(true)}>Dismiss</button>
        </p>
      )}
      <div className="mobile-panel-tabs">
        <button
          aria-expanded={mobilePanel === "rooms"}
          onClick={() => setMobilePanel(mobilePanel === "rooms" ? "" : "rooms")}
        >
          Library
        </button>
        <button
          aria-expanded={mobilePanel === "furniture"}
          onClick={() =>
            setMobilePanel(mobilePanel === "furniture" ? "" : "furniture")
          }
        >
          Furniture
        </button>
        {mobilePanel && (
          <button onClick={() => setMobilePanel("")}>Close panel</button>
        )}
      </div>
      <div className="planner-toolbar">
        {(imageHouse || floorPlan.convertedHouseModel) && (
          <label>
            Layout source
            <select
              value={floorPlan.mode}
              onChange={(e) =>
                setFloorPlan((p) => ({ ...p, mode: e.target.value }))
              }
            >
              <option value="plan">Floor plan</option>
              <option value="estimated">Estimated layout</option>
            </select>
          </label>
        )}
        {homeId === "demo" && (
          <button onClick={() => change(demoPlacements(house))}>
            Reset demo furniture
          </button>
        )}
        <button onClick={() => setView(view === "3D" ? "2D" : "3D")}>
          View: {view}
        </button>
        <button onClick={() => setFullWalls(!fullWalls)}>
          {fullWalls ? "Full walls" : "Cutaway"}
        </button>
        <label>
          Floor{" "}
          <select
            value={floor.level}
            onChange={(e) => setLevel(+e.target.value)}
          >
            {house.floors.map((f) => (
              <option key={f.level} value={f.level}>
                {f.level === 3 ? "Basement" : `Level ${f.level + 1}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          Focus room{" "}
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">Whole floor</option>
            {floor.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="planner-workspace">
        <aside className="planner-panel library-panel">
          <FurnitureLibrary
            library={[...library.filter(d=>!d.archived),...catalog]}
            add={add}
            room={floor.rooms.find(r=>r.id === roomId) || floor.rooms.find(r=>r.type === 'living') || floor.rooms[0]}
            onLibraryEdit={setEditing}
            onLibraryDelete={deleteFurniture}
          />
          <details className="library-room-settings">
            <summary>Room &amp; floor settings</summary>
        {inPlanMode ? (
          <aside className="room-settings">
            <h2>{activeAsset?.sample ? "Sample floor plan" : "Floor plan"}</h2>
            {converted ? (
              <>
              <p>{floorPlan.houseModelSource === "sample-json" ? "Synthetic sample: two rooms with a 20 × 15 ft wall footprint." : "Generated from floor plan. Verify against the original."}</p>
                <p>{floor.walls?.length ?? ""} walls · {floor.doors.length} doors · {floor.windows.length} windows</p>
                <p>Canvas: {(floor.widthIn/12).toFixed(1)} × {(floor.depthIn/12).toFixed(1)} ft. Ceiling: {(house.ceilingHeightIn/12).toFixed(1)} ft.</p>
                {floor.walls && <details><summary>Check wall lengths</summary>
                  <p>Compare these centerline lengths with the plan. Room interior dimensions exclude wall thickness.</p>
                  <ul>{floor.walls.map(w => <li key={w.id}>{w.id}: {(Math.hypot(w.x2-w.x1,w.z2-w.z1)/12).toFixed(2)} ft</li>)}</ul>
                </details>}
              </>
            ) : (
              <>
                <p>
                  Walls aren't detected yet. 3D walls will come from floor plan
                  conversion.
                </p>
                <p>
                  Furniture collisions are checked. Wall and door checks are
                  unavailable.
                </p>
              </>
            )}
            <button onClick={() => setMobilePanel("floorplan")}>
              Scale and floor settings
            </button>
          </aside>
        ) : (
          <RoomPanel
            embedded
            floor={floor}
            overrides={overrides}
            setOverrides={setOverrides}
            onReset={() => setOverrides({})}
          />
        )}
          </details>
        </aside>
        <section
          className="planner-canvas"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const def = [...catalog, ...library].find(
              (d) =>
                d.id ===
                e.dataTransfer.getData("application/propertylens-furniture"),
            );
            const point = project.current?.(e.clientX, e.clientY);
            if (def && point)
              add(
                def,
                floor.rooms.find(
                  (r) =>
                    point.x * 12 >= r.x &&
                    point.x * 12 <= r.x + r.widthIn &&
                    point.z * 12 >= r.z &&
                    point.z * 12 <= r.z + r.depthIn,
                ) || floor.rooms[0],
                point,
              );
          }}
        >
          <Scene
            onProject={(fn) => (project.current = fn)}
            floor={floor}
            ceilingHeightIn={floorPlan.ceilingHeightIn}
            planUrl={planUrl}
            planRotation={activePlan?.rotationDeg || 0}
            planOpacity={converted ? 0.25 : 0.9}
            view={view}
            fullWalls={fullWalls}
            quality="low"
            focus={floor.rooms.find((r) => r.id === roomId)}
            onEmpty={() => setSelected("")}
          >
            {items.map((item) => (
              <FurnitureModel
                key={item.id}
                item={item}
                selected={selected === item.id}
                warning={warnings.some((w) => w.ids.includes(item.id))}
                onSelect={setSelected}
                onMove={(p) => update(p.id, { xIn: p.xIn, zIn: p.zIn })}
                floor={floor}
                snap={snap}
                flush={false}
              />
            ))}
          </Scene>
          {items.find(item=>item.id === selected) && (() => {
            const item = items.find(item=>item.id === selected);
            return <div className="selected-item-actions" role="group" aria-label="Selected furniture controls">
              <strong>{item.name}</strong>
              <span>{item.rotationDeg || 0}°</span>
              <button onClick={()=>update(item.id,{rotationDeg:(item.rotationDeg || 0)+15})}>Rotate</button>
              <button onClick={()=>duplicate(item)}>Duplicate</button>
              <button className="danger-action" onClick={()=>remove(item.id)}>Delete</button>
              <small>R: rotate · Shift+R: 90° · Delete: remove</small>
            </div>;
          })()}
          <p className="canvas-estimate">
            {converted
              ? floorPlan.houseModelSource === "sample-json" ? "Synthetic sample floor plan" : "Generated from floor plan. Verify against the original."
              : inPlanMode
                ? `${activeAsset?.sample ? "Sample floor plan · " : ""}Floor plan from ${activeAsset?.sourceName || "listing source"}, personal use`
                : "Estimated layout, not the real floor plan"}
          </p>
        </section>
        <FurniturePanel
          {...{
            items,
            selected,
            setSelected,
            add,
            update,
            remove,
            duplicate,
            warnings,
            floor,
            roomId,
            history,
            snap,
            setSnap,
          }}
          undo={() => setHistory(undo)}
          redo={() => setHistory(redo)}
        >
          <AddFurniture
            clientId={clientId}
            onSave={saveFurniture}
            onPlace={def => add(def, floor.rooms.find(r=>r.id === roomId) || floor.rooms[0])}
            edit={editing}
            onEditDone={() => setEditing(null)}
          />
        </FurniturePanel>
      </div>
      <p className="planner-summary" role="status">
        {history.present.length} items placed -{" "}
        {warnings.filter((w) => w.type === "collision").length} collisions -{" "}
        {warnings.filter((w) => w.type === "door").length} blocked doors on this
        floor
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement} {warnings.map((w) => w.message).join(". ")}
      </p>
      <p className="sr-only">
        {floor.rooms.map((r) => r.name).join(", ")}. Furniture:{" "}
        {items.map((i) => i.name).join(", ") || "none"}.
      </p>
    </main>
  );
}
