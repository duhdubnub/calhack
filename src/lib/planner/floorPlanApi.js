import { API } from "../api";
import { useEffect, useRef, useState } from "react";
import { readSession, writeSession } from "./listingSnapshot";
const base = API + "/planner/floorplan",
  starts = new Map();
export async function floorPlanApi(client, path, options = {}) {
  const r = await fetch(base + path, {
    ...options,
    headers: {
      "X-Client-Id": client,
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const d = await r.json();
  if (!r.ok) throw Error(d.error?.message || "Floor plan request unavailable.");
  return d;
}
export function useAssetImage(assetId, client) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    setUrl(null);
    if (!assetId) return;
    let disposed = false,
      objectUrl;
    const controller = new AbortController();
    fetch(`${base}/assets/${assetId}.png`, {
      headers: { "X-Client-Id": client },
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw Error();
        return r.blob();
      })
      .then((blob) => {
        if (!disposed) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, client]);
  return url;
}
export function useFloorPlans({ snapshot, homeId, clientId, savedPlans = [] }) {
  const stopped = useRef(false);
  const [job, setJob] = useState(null),
    [plans, setPlans] = useState([]),
    [retry, setRetry] = useState(0);
  const real =
    homeId &&
    homeId !== "demo" &&
    !homeId.startsWith("custom-") &&
    snapshot?.address;
  const address =
    snapshot?.address && snapshot.address.split(",").length >= 3
      ? snapshot.address
      : [
          snapshot?.address,
          snapshot?.city,
          [snapshot?.state, snapshot?.zip].filter(Boolean).join(" "),
        ]
          .filter(Boolean)
          .join(", ");
  useEffect(() => {
    let cancelled = false;
    for (const plan of savedPlans) {
      floorPlanApi(clientId, `/metadata/${plan.assetId}`)
        .then((p) => {
          if (!cancelled)
            setPlans((old) =>
              old.some((a) => a.assetId === p.assetId) ? old : [...old, p],
            );
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [clientId, JSON.stringify(savedPlans.map((p) => p.assetId))]);
  useEffect(() => {
    if (!real) return;
    stopped.current = false;
    let cancelled = false,
      timer;
    const key = `${clientId}.${homeId}.floorplan`;
    async function poll(id) {
      try {
        const result = await floorPlanApi(clientId, `/jobs/${id}`);
        if (cancelled || stopped.current) return;
        setJob({ ...result, jobId: id });
        if (result.result?.plans)
          setPlans((old) => [
            ...old.filter(
              (p) => !result.result.plans.some((n) => n.assetId === p.assetId),
            ),
            ...result.result.plans,
          ]);
        if (["queued", "running", "downloading"].includes(result.status))
          timer = setTimeout(() => poll(id), 2500);
      } catch {
        if (!cancelled && !stopped.current)
          setJob({
            status: "error",
            message:
              "Could not load the floor plan search. Retry to reconnect.",
          });
      }
    }
    async function start() {
      try {
        let previous = readSession(key);
        if (retry) previous = null;
        if (previous?.jobId) {
          await poll(previous.jobId);
          return;
        }
        if (!starts.has(key) || retry)
          starts.set(
            key,
            floorPlanApi(clientId, "/jobs", {
              method: "POST",
              body: JSON.stringify({
                homeId,
                address,
                listingUrls: [snapshot.zillowUrl, snapshot.redfinUrl].filter(
                  Boolean,
                ),
              }),
            }),
          );
        const result = await starts.get(key);
        writeSession(key, result);
        if (stopped.current) {
          await floorPlanApi(clientId, `/jobs/${result.jobId}`, {method:"DELETE"}).catch(()=>{});
          return;
        }
        if (!cancelled) {
          setJob(result);
          await poll(result.jobId);
        }
      } catch {
        starts.delete(key);
        if (!cancelled)
          setJob({
            status: "error",
            message:
              "Could not search for floor plans. Try again or upload a plan.",
          });
      }
    }
    setJob({ status: "queued", elapsedSecs: 0 });
    void start();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [homeId, clientId, real, address, retry]);
  return {
    job,
    plans,
    setPlans,
    retry: () => setRetry((n) => n + 1),
    async cancel() {
      stopped.current = true;
      if (job?.jobId)
        await floorPlanApi(clientId, `/jobs/${job.jobId}`, {
          method: "DELETE",
        }).catch(() => {});
      setJob({ status: "error", message: "Floor plan search cancelled." });
    },
    async sample() {
      const p = await floorPlanApi(clientId, "/sample", { method: "POST" });
      setPlans((old) => [
        ...old,
        ...p.filter((a) => !old.some((b) => b.assetId === a.assetId)),
      ]);
      setJob({ status: "ready", result: { plans: p, sample: true } });
    },
  };
}
