import { API } from "../lib/api";
import { shouldRetryAddress, shouldRetryDescription, addressRetryText } from "../lib/search/intent";
import { exactAddress, addressLabel, sameHome } from "../lib/search/address";
import AddressResults from "../components/search/AddressResults";
import { usePreferences } from "../lib/Preferences";
import DescribeSearch, {
  localRead,
  localWrite,
} from "../components/search/DescribeSearch";
import CommuteResults from "../components/search/CommuteResults";
import "../styles/describe.css";
import { Link, useLocation } from "react-router-dom";
import { readSession, writeSession } from "../lib/planner/listingSnapshot";
import { useFavorites } from "../lib/Favorites";
import React, { useEffect, useRef, useState } from "react";
import Filters, { LABELS } from "../components/search/Filters";
import DetailModal from "../components/search/DetailModal";
import WorkAddress from "../components/search/WorkAddress";
import { ModuleSelector } from "../lib/Preferences";
import { defaults, SORTS } from "../../server/search/criteria";
export default function Home({ addressOnly = false }) {
  const location = useLocation();
  const { work } = usePreferences();
  const restored = useRef(
    (() => {
      const v = readSession("propertylens.search");
      if (!v) return null;
      const checked = v.addressResult?.checkedAt || v.data?.checkedAt;
      if (checked && Date.now() - Date.parse(checked) > 3600000)
        return { ...v, data: null, addressResult: null, selected: null };
      return v;
    })(),
  ).current;
  const { favorites, toggle, clientId } = useFavorites();
  const [criteria, setCriteria] = useState(
      restored?.criteria || {
        ...defaults,
        location: "Austin, TX",
      },
    ),
    [applied, setApplied] = useState(restored?.applied || null),
    [data, setData] = useState(restored?.data || null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(
      restored?.selected?.status === "for_sale" ? restored.selected : null,
    ),
    [sort, setSort] = useState(restored?.sort || "relevance");
  const [mode, updateMode] = useState(
    restored?.mode || localRead("propertylens.searchMode", "describe"),
  );
  const [text, setText] = useState(restored?.text || "");
  const [parsed, setParsed] = useState(restored?.parsed || null);
  const [addressResult, setAddressResult] = useState(
    restored?.addressResult || null,
  );
  const [understanding, setUnderstanding] = useState(false);
  const [attemptNote, setAttemptNote] = useState("");
  const setMode = (value) => {
    updateMode(value);
    localWrite("propertylens.searchMode", value);
  };
  const request = useRef(null);
  const lastAddress = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    writeSession("propertylens.search", {
      criteria,
      mode,
      text,
      parsed,
      addressResult,
      applied,
      data,
      selected,
      sort,
      scroll: window.scrollY,
    });
  }, [
    criteria,
    applied,
    data,
    selected,
    sort,
    mode,
    text,
    parsed,
    addressResult,
  ]);
  useEffect(() => {
    if (restored)
      requestAnimationFrame(() => window.scrollTo(0, restored.scroll || 0));
  }, []);
  async function search(c, extras = parsed?.extras, originalText = text, allowFallback = true) {
    if (allowFallback) setAttemptNote("");
    setAddressResult(null);
    setSelected(null);
    if (extras?.sort) setSort(extras.sort);
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setApplied(c);
    try {
      const r = await fetch(API + (extras ? "/search/described" : "/search"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": clientId,
        },
        body: JSON.stringify(extras ? { criteria: c, extras } : c),
        signal: controller.signal,
      });
      const j = await r.json().catch(() => {
        throw new Error("Search is temporarily unavailable. Please retry.");
      });
      if (!r.ok) throw new Error(j.error?.message);
      if (controller.signal.aborted) return;
      if (!j.listings?.length && allowFallback && shouldRetryAddress(originalText)) {
        await addressSearch({ text: addressRetryText(originalText), safetyRetried: true });
        return;
      }
      setData(j);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(e.message || "Search unavailable");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  async function addressSearch(value) {
    setAttemptNote(value.safetyRetried ? "No homes matched the description. We also tried an exact address lookup." : "");
    lastAddress.current = value;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    setData(null);
    setSelected(null);
    setAddressResult(null);
    const bias =
      addressResult?.address ||
      data?.listings?.find((p) => p.lat != null && p.lng != null) ||
      work;
    try {
      const r = await fetch(API + "/search/address", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": clientId,
        },
        body: JSON.stringify({ ...value, bias, savedWork: work }),
        signal: controller.signal,
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error?.message || "Address lookup unavailable");
      if (controller.signal.aborted) return;
      if (
        v.result === "not_found" &&
        value.text &&
        !value.safetyRetried && shouldRetryDescription(value.text)
      ) {
        const response = await fetch(API + "/search/parse", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Client-Id": clientId,
          },
          body: JSON.stringify({ text: value.text, fallbackDescription: true }),
          signal: controller.signal,
        });
        const p = await response.json();
        if (!response.ok) throw Error(p.error?.message || "Search unavailable");
        setParsed(p);
        setCriteria(p.criteria);
        setAttemptNote("We couldn't resolve an exact address. We also tried interpreting your text as a description.");
        if (!p.questions.length) await search(p.criteria, p.extras, value.text, false);
        return;
      }
      setAddressResult({ ...v, ...(value.safetyRetried ? { triedNote: "No homes matched the description. We also tried an exact address lookup." } : {}) });
      setParsed({
        intent: "address",
        address: {
          text: v.address?.standardized || value.text || value.selected?.label,
          verified: v.address?.verified,
        },
        notApplied: value.notApplied || [],
      });
      if (v.result === "for_sale" && v.listings.length === 1)
        setSelected({ ...v.listings[0], usingFixtures: v.usingFixtures });
    } catch (e) {
      if (!controller.signal.aborted) setError(e.message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("address");
    if (q && q !== restored?.text) {
      setText(q);
      addressSearch({ text: q });
    }
  }, []);
  useEffect(() => {
    if (addressResult?.result !== "for_sale" || addressResult.usingFixtures)
      return;
    const controller = new AbortController();
    for (const p of addressResult.listings
      .filter((p) => !p.photoUrl)
      .slice(0, 6)) {
      fetch(
        API + "/enrich?" +
          new URLSearchParams({
            address: addressLabel({ ...p, line1: p.address }),
          }),
        { signal: controller.signal },
      )
        .then((r) => (r.ok ? r.json() : null))
        .then((v) => {
          if (
            !v ||
            v.status !== "for_sale" ||
            !exactAddress({ ...p, line1: p.address }, v)
          )
            return;
          const patch = {
            photoUrl: v.photos?.[0] || p.photoUrl,
            zillowUrl: v.zillowUrl || p.zillowUrl,
          };
          setAddressResult((old) =>
            old?.checkedAt === addressResult.checkedAt
              ? {
                  ...old,
                  listings: old.listings.map((row) =>
                    row.id === p.id ? { ...row, ...patch } : row,
                  ),
                }
              : old,
          );
          setSelected((old) => (old?.id === p.id ? { ...old, ...patch } : old));
        })
        .catch(() => {});
    }
    return () => controller.abort();
  }, [addressResult?.checkedAt]);
  function nearby(p) {
    const c = { ...defaults, location: p.city + ", " + p.state };
    setCriteria(c);
    setParsed(null);
    search(c, {
      radius: {
        miles: 5,
        center: { label: p.standardized, lat: p.lat, lng: p.lng },
      },
      commute: null,
      insights: [],
      sort: null,
    });
  }
  const rows = (data?.listings || []).filter((p) => p.status === "for_sale");
  if (sort !== "relevance") {
    const key =
      {
        newest: "daysOnMarket",
        "price-asc": "price",
        "price-desc": "price",
        lot: "lotSizeSqft",
      }[sort] || sort;
    const val = (p) =>
      sort === "price-per-sqft"
        ? p.price != null && p.sqft > 0
          ? p.price / p.sqft
          : null
        : p[key];
    rows.sort((a, b) =>
      val(a) == null
        ? val(b) == null
          ? 0
          : 1
        : val(b) == null
          ? -1
          : (val(a) - val(b)) *
            (sort === "newest" ||
            sort === "price-asc" ||
            sort === "price-per-sqft"
              ? 1
              : -1),
    );
  }
  return (
    <main id="main" className="container search-page">
      <section className="search-intro">
        <p className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</p>
        <h1>
          {addressOnly ? "Look up an address." : "Find a home."}
          <br />
          <span>See the whole picture.</span>
        </h1>
        <p>Homes from multiple sources. The details that matter to you.</p>
      </section>
      {location.state?.plannerMessage && !restored?.data && (
        <p role="status">
          Your previous search is no longer available. Find a home below or open
          the demo planner.
        </p>
      )}
      <div className="home-entry-cards">
        <Link className="planner-entry" to="/planner">
          <span className="eyebrow">PICTURE YOUR NEXT HOME</span>
          <h2>Try your furniture</h2>
          <p>
            Build an estimated 3D layout. Bring your furniture. See what fits.
          </p>
          <strong>Open the room planner &rarr;</strong>
        </Link>
        <a href="#home-search">
          <span className="eyebrow">EXPLORE THE POSSIBILITIES</span>
          <h2>Find homes</h2>
          <p>Search US listings, compare insights and save your shortlist.</p>
          <strong>Start your search &rarr;</strong>
        </a>
      </div>
      <div id="home-search" />
      <DescribeSearch
        mode={mode}
        setMode={setMode}
        text={text}
        setText={setText}
        parsed={parsed}
        setParsed={setParsed}
        criteria={criteria}
        setCriteria={setCriteria}
        onSearch={search}
        onAddress={addressSearch}
        bias={addressResult?.address || data?.listings?.[0] || work}
        onStart={() => {
          request.current?.abort();
          setData(null);
          setAddressResult(null);
          setSelected(null);
          setApplied(null);
          setError("");
        }}
        busy={loading}
        setUnderstanding={setUnderstanding}
      />
      <div
        id="panel-filters"
        role="tabpanel"
        aria-labelledby="tab-filters"
        hidden={mode !== "filters"}
      >
        <Filters
          value={criteria}
          onChange={setCriteria}
          onSearch={(c) => {
            setCriteria(c);
            if (parsed?.intent !== "address" && parsed)
              setParsed({
                ...parsed,
                criteria: c,
                questions: parsed.questions.filter(
                  (q) => q.field !== "location",
                ),
              });
            search(c);
          }}
          onReset={() => {
            request.current?.abort();
            setLoading(false);
            setApplied(null);
            setParsed(null);
            setData(null);
            setError("");
          }}
          busy={loading}
        />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {understanding
          ? "Understanding your search…"
          : loading
            ? "Searching…"
            : data
              ? `${data.listings.length} homes found`
              : ""}
      </p>
      <ModuleSelector />
      {attemptNote && <p className="small-note" role="status">{attemptNote}</p>}
      <WorkAddress />
      {applied && !parsed && (
        <div className="chips active-filters" aria-label="Active filters">
          {Object.entries(applied)
            .filter(
              ([k, v]) =>
                !["sources", "limit"].includes(k) &&
                v !== "" &&
                v !== false &&
                !(Array.isArray(v) && !v.length),
            )
            .map(([k, v]) => (
              <button
                className="toggle-chip"
                key={k}
                onClick={() => {
                  const next = {
                    ...criteria,
                    [k]: defaults[k] ?? (Array.isArray(v) ? [] : ""),
                  };
                  setCriteria(next);
                  if (k !== "location") search(next);
                }}
                aria-label={"Remove " + (LABELS[k] || k)}
              >
                {LABELS[k] || k}:{" "}
                {Array.isArray(v) ? v.join(", ") : v === true ? "Yes" : v} ×
              </button>
            ))}
        </div>
      )}
      {loading || understanding ? (
        <div className="listing-grid" role="status" aria-label="Finding homes">
          {[1, 2, 3].map((n) => (
            <div className="listing-skeleton" key={n} />
          ))}
        </div>
      ) : error ? (
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button
            onClick={() =>
              parsed?.intent === "address"
                ? addressSearch({ text })
                : search(applied || criteria)
            }
          >
            Retry search
          </button>
        </div>
      ) : addressResult ? (
        <AddressResults
          result={addressResult}
          onRetry={() => addressSearch({ ...(lastAddress.current || { text }), bypassCache: true })}
          onChoose={(p) => addressSearch({ selected: p })}
          onNearby={nearby}
          onReset={() => {
            setAddressResult(null);
            setParsed(null);
            setText("");
            document.getElementById("describe-input")?.focus();
          }}
          onOpen={(p) =>
            setSelected({
              ...p,
              usingFixtures:
                addressResult?.usingFixtures || data?.usingFixtures,
            })
          }
          favorites={favorites}
          onFavorite={toggle}
        />
      ) : data ? (
        <>
          {data.hiddenCount > 0 && (
            <p className="small-note">
              {data.hiddenCount} homes hidden because they aren’t currently for
              sale
            </p>
          )}
          <div className="results-toolbar">
            <h2>{rows.length} homes to explore</h2>
            <label>
              Sort{" "}
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map((s) => (
                  <option value={s} key={s}>
                    {s.replaceAll("-", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {data.usingFixtures && (
            <p>
              <span className="sample-badge">Sample data</span> Saved Austin
              properties, independent of the location entered.
            </p>
          )}
          <div className="source-statuses">
            {Object.entries(data.sourceCounts).map(([s, n]) => (
              <span key={s}>
                {s}:{" "}
                {data.sourceErrors[s] ? (
                  <>
                    failed{" "}
                    <button
                      className="quiet-button"
                      onClick={() => search(applied)}
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  n + " homes"
                )}
              </span>
            ))}
          </div>
          {data.notes.map((n) => (
            <p className="small-note" key={n}>
              {n}
            </p>
          ))}
          {Object.entries(data.notApplied).map(
            ([s, keys]) =>
              keys.length > 0 && (
                <p className="small-note" key={s}>
                  {keys.map((k) => LABELS[k] || k).join(", ")} not applied to{" "}
                  {s} results.
                </p>
              ),
          )}
          <CommuteResults
            key={data.commute?.token || "standard"}
            data={data}
            clientId={clientId}
            onUpdate={(next) =>
              setData((old) =>
                old.commute?.token === next.commute?.token
                  ? { ...old, ...next }
                  : old,
              )
            }
            listings={rows}
            onOpen={setSelected}
            favorites={favorites}
            onFavorite={toggle}
          />
          {!rows.length && (
            <div className="empty-state">
              No homes match, try widening your filters
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">
          Set your criteria above to discover homes.
        </div>
      )}
      {selected && (
        <DetailModal
          listing={selected}
          onClose={() => setSelected(null)}
          saved={favorites.some((p) => sameHome(p, selected))}
          onFavorite={toggle}
        ></DetailModal>
      )}
    </main>
  );
}
