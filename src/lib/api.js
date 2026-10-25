// Empty in local dev (Vite proxies /api); set VITE_API_URL at build time to reach a hosted server.
export const API = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";
