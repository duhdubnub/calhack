import { API } from "../lib/api";
import React, { useEffect, useId, useRef, useState, useReducer } from "react";
import { comboboxReducer, initialCombobox, inputPrivacy } from "../lib/search/combobox";
import { fastSuggestion } from "../lib/search/suggestions";
import { useNavigate } from "react-router-dom";
import { classifyIntent } from "../lib/search/intent";
import { useFavorites } from "../lib/Favorites";
import { usePreferences } from "../lib/Preferences";
import "../styles/address.css";
function Highlight({ text = "", query }) {
  const words = query.split(/\W+/).filter(Boolean);
  return words.length
    ? text
        .split(new RegExp(`(${words.join("|")})`, "gi"))
        .map((s, i) => (i % 2 ? <mark key={i}>{s}</mark> : s))
    : text;
}
export default function AddressCombobox({
  onSelect,
  onSubmit,
  label = "Start with a US property address",
  value,
  onChange,
  bias,
  embedded = false,
  description = false,
  disabled = false,
  id: givenId,
  placeholder,
}) {
  const [interaction, dispatch] = useReducer(comboboxReducer, undefined, initialCombobox);
  const [loading, setLoading] = useState(false);
  const { items, open, active } = interaction;
  const address = value ?? interaction.value,
    change = (v) => onChange?.(v),
    container = useRef(),
    request = useRef(),
    sequence = useRef(0),
    navigate = useNavigate(),
    generated = useId(),
    id = givenId || `home-search-${generated}`,
    listId = id + "-suggestions";
  const { clientId } = useFavorites(),
    { work } = usePreferences();
  bias = bias || work;
  const eligible =
    address.trim().length >= 3 &&
    (!description || classifyIntent(address).intent === "address");
  const expanded = open && eligible;
  useEffect(() => {
    const seq = ++sequence.current,
      controller = new AbortController();
    request.current = controller;
    setLoading(false);
    if (!eligible || !open) return () => controller.abort();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: address.slice(0, 300) });
        if (Number.isFinite(bias?.lat) && Number.isFinite(bias?.lng)) {
          params.set("lat", bias.lat);
          params.set("lng", bias.lng);
        }
        const r = await fetch(API + "/autocomplete?" + params, {
            signal: controller.signal,
            headers: { "X-Client-Id": clientId },
          }),
          v = r.ok ? await r.json() : [];
        if (seq === sequence.current && !controller.signal.aborted)
          dispatch({ type: "results", revision: interaction.revision, items: Array.isArray(v) ? v.slice(0, 6).map(fastSuggestion) : [] });
      } catch {
      } finally {
        if (seq === sequence.current && !controller.signal.aborted)
          setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [address, eligible, open, bias?.lat, bias?.lng, clientId]);
  useEffect(() => {
    if (!open || !items.length || interaction.verifiedRevision === interaction.revision) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(API + "/autocomplete/verify", {
          method: "POST", headers: { "Content-Type": "application/json", "X-Client-Id": clientId },
          body: JSON.stringify({ suggestions: items.slice(0, 3) }), signal: controller.signal,
        });
        const v = r.ok ? await r.json() : [];
        if (!controller.signal.aborted) dispatch({ type: "verified", revision: interaction.revision, items: Array.isArray(v) ? v : [] });
      } catch {}
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [items, open, interaction.revision, interaction.verifiedRevision, clientId]);
  function close() {
    request.current?.abort();
    sequence.current++;
    dispatch({ type: "close" });
  }
  useEffect(() => {
    const outside = (e) => {
      if (!container.current?.contains(e.target)) {
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  async function choose(p) {
    close();
    dispatch({ type: "select", item: p });
    change(p.label);
    if (p.resultType === "city" || p.resultType === "street") return;
    if (description) {
      onSelect?.(p);
      return;
    }
    if (onSelect) onSelect(p);
    else
      navigate(
        "/lookup?" +
          new URLSearchParams({ address: p.standardized || p.label }),
      );
  }
  function submit() {
    close();
    if (!address.trim() || disabled) return;
    if (onSubmit) onSubmit(address);
    else if (onSelect) onSelect({ label: address.trim() });
    else
      navigate("/lookup?" + new URLSearchParams({ address: address.trim() }));
  }
  function keys(e) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
    if (["ArrowUp", "ArrowDown"].includes(e.key) && expanded && items.length) {
      e.preventDefault();
      dispatch({ type: "arrow", direction: e.key === "ArrowDown" ? 1 : -1 });
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (expanded && active >= 0) choose(items[active]);
      else submit();
    }
  }
  const Input = description ? "textarea" : "input",
    Wrapper = embedded ? "div" : "form";
  return (
    <Wrapper
      ref={container}
      className="address-combobox"
      {...(!embedded
        ? {
            onSubmit: (e) => {
              e.preventDefault();
              submit();
            },
          }
        : {})}
    >
      <label htmlFor={id}>{label}</label>
      <div className="autocomplete-wrap">
        <Input
          id={id}
          name={`home-search-${generated}`}
          {...inputPrivacy}
          value={address}
          onChange={(e) => {
            request.current?.abort();
            sequence.current++;
            dispatch({ type: "type", value: e.target.value });
            change(e.target.value);
          }}
          onKeyDown={keys}
          onBlur={(e) => {
            if (!container.current?.contains(e.relatedTarget)) close();
          }}
          disabled={disabled}
          rows={description ? 3 : undefined}
          maxLength={description ? 500 : 300}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={
            expanded && active >= 0 ? `${listId}-${active}` : undefined
          }
          placeholder={placeholder || "Enter street address, city, state"}
        />
        <div className="autocomplete-dropdown" hidden={!expanded}>
          {loading && <p role="status">Searching addresses…</p>}
          {!loading && !items.length && (
            <p role="status">
              No matching addresses. Keep typing or press Enter to search.
            </p>
          )}
          <ul id={listId} role="listbox" aria-label="Suggested US addresses">
            {items.map((p, i) => (
              <li
                key={i}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={active === i}
                className={active === i ? "highlighted" : ""}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(p)}
              >
                <span>
                  <strong>
                    <Highlight
                      text={p.line1 || p.street || p.city}
                      query={address}
                    />
                  </strong>
                  <small>
                    <Highlight
                      text={`${p.city}, ${p.state}`}
                      query={address}
                    />
                  </small>
                  <small className="suggestion-zip" title={p.verified ? "ZIP verified by US Census" : "ZIP unverified"}>
                    {p.verified ? `${p.zip} ✓` : "\u00a0"}
                  </small>
                </span>
                {p.forSale && <span className="sample-badge">For sale</span>}
              </li>
            ))}
          </ul>
          <p className="suggestion-credit">
            {items.some((p) => p.provider === "sample")
              ? "Sample addresses"
              : `Address search by ${items.some((p) => p.provider === "geoapify") ? "Geoapify" : "Photon"}, © OpenStreetMap contributors`}
          </p>
        </div>
      </div>
      {!embedded && (
        <button disabled={disabled || !address.trim()}>
          {onSelect ? "Set address" : "Search"}
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {expanded && !loading
          ? `${items.length} suggestions. Use arrow keys and Enter to choose.`
          : ""}
      </span>
    </Wrapper>
  );
}
