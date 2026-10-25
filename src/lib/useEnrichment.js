import { API } from "./api";
import { useEffect, useState } from "react";

export default function useEnrichment(property) {
  const address = property?.address;
  const key = address
    ? `${property.sampleData ? "fixture" : "live"}:${address}`
    : null;
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!address) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 65000);
    let current = true;
    setState({ key, status: "loading", data: null });
    async function load() {
      try {
        const response = await fetch(
          `${API}/enrich?${new URLSearchParams({ address })}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json();
        if (!Array.isArray(data.sources) || !Array.isArray(data.photos))
          throw new Error("Invalid response");
        if (current) setState({ key, status: "success", data });
      } catch {
        if (current) setState({ key, status: "unavailable", data: null });
      } finally {
        clearTimeout(timeout);
      }
    }
    load();
    return () => {
      current = false;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [address, key]);
  return state?.key === key ? state : null;
}
