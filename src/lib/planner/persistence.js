import { API } from "../api";
export async function plannerApi(id, path, options = {}) {
  const r = await fetch(API + path, {
    ...options,
    headers: { "Content-Type": "application/json", "X-Client-Id": id },
    signal: AbortSignal.timeout(path.endsWith("/resolve") ? 110000 : 5000),
  });
  const d = await r.json();
  if (!r.ok)
    throw new Error(d.error?.message || "Planner storage unavailable.");
  return d;
}
export function localRead(key) {
  try {
    return JSON.parse(localStorage.getItem("propertylens.planner." + key));
  } catch {
    return null;
  }
}
export function localWrite(key, value) {
  try {
    localStorage.setItem("propertylens.planner." + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
