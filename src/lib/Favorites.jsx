import { API } from "./api";
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { sameHome } from "./search/address";
const Context = createContext();
export function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState([]),
    [message, setMessage] = useState(""),
    [loading, setLoading] = useState(true),
    pending = useRef(false);
  const [id] = useState(() => {
    try {
      let id = localStorage.getItem("propertylens.clientId");
      if (!/^[a-f0-9-]{36}$/i.test(id || "")) {
        id = crypto.randomUUID();
        localStorage.setItem("propertylens.clientId", id);
      }
      return id;
    } catch {
      return crypto.randomUUID();
    }
  });
  async function api(path = "", options = {}) {
    const r = await fetch(API + "/favorites" + path, {
      ...options,
      headers: { "X-Client-Id": id, "Content-Type": "application/json" },
    });
    const d = await r.json().catch(() => {
      throw new Error("Saved homes are temporarily unavailable. Please retry.");
    });
    if (!r.ok)
      throw new Error(d.error?.message || "Could not update favorites.");
    return d;
  }
  async function refresh() {
    setLoading(true);
    try {
      setFavorites(await api());
      setMessage("");
    } catch (e) {
      setMessage(e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [id]);
  async function toggle(p) {
    if (pending.current) return;
    const old = favorites,
      existing = old.find((x) => sameHome(x, p)),
      exists = Boolean(existing);
    if (!exists && old.length >= 5) {
      setMessage("You can save up to 5 homes. Remove one to add another.");
      return;
    }
    pending.current = true;
    setMessage("");
    setFavorites(exists ? old.filter((x) => x.id !== existing.id) : [...old, p]);
    try {
      setFavorites(
        await api(exists ? "/" + existing.id : "", {
          method: exists ? "DELETE" : "POST",
          ...(!exists ? { body: JSON.stringify(p) } : {}),
        }),
      );
    } catch (e) {
      setFavorites(old);
      setMessage(e.message);
    } finally {
      pending.current = false;
    }
  }
  return (
    <Context.Provider value={{ favorites, toggle, message, loading, refresh, clientId: id }}>
      {children}
      {message && (
        <div className="favorite-toast" role="status">
          {message}
          <button onClick={() => setMessage("")} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
export const useFavorites = () => useContext(Context);
