import { API } from '../../lib/api';
import React, { useState } from 'react';
import ListingGrid from './ListingGrid';
import Pagination, { usePagination } from './Pagination';
export default function CommuteResults({ data, listings, onUpdate, clientId, ...grid }) {
  const [over, setOver] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [showUnchecked, setShowUnchecked] = useState(false);
  const c = data.commute;
  const verified = listings.filter(p => Number.isFinite(p.commute?.minutes) && p.commute.minutes <= c?.maxMinutes);
  const tooLong = listings.filter(p => Number.isFinite(p.commute?.minutes) && p.commute.minutes > c?.maxMinutes);
  const unchecked = listings.filter(p => !Number.isFinite(p.commute?.minutes));
  const pagination = usePagination([...verified, ...(over ? tooLong : []), ...(showUnchecked ? unchecked : [])]);
  const pageIds = new Set(pagination.items.map(p => p.id));
  const onPage = items => items.filter(p => pageIds.has(p.id));
  if (!c) return <ListingGrid listings={listings} {...grid} />;
  async function more() {
    setBusy(true); setError('');
    try {
      const r = await fetch(API + '/search/commute-more', { method:'POST', headers:{'Content-Type':'application/json','X-Client-Id':clientId}, body:JSON.stringify({token:c.token}) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error?.message || 'Could not check more homes.'); onUpdate(j);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <section className="commute-results" aria-label="Commute search results">
    <p role="status" aria-live="polite">Checked commute for {c.checked} of {c.totalWithin} homes within about {c.maxMinutes} miles of work. {c.under} are within {c.maxMinutes} minutes.</p>
    <p className="small-note">Driving, next Tuesday departing at {c.departAt}, typical traffic. {c.excluded} homes pruned by straight-line distance; {c.missing} have no coordinates. This generous distance cutoff can exclude unusual fast routes.</p>
    {c.usingFixtures && <p className="sample-badge">Sample data: only saved routes can be checked.</p>}
    {c.error && <p role="status">Commute couldn’t be checked: {c.error}</p>}
    {error && <p role="alert">{error}</p>}
    {c.remaining > 0 && <p><button disabled={busy} onClick={more}>{busy ? 'Checking commute…' : `Check ${Math.min(c.batchSize,c.remaining)} more`}</button> <small>uses Apify credits (live mode)</small></p>}
    {verified.length === 0 && <p>No homes have a verified commute within your limit yet.</p>}
    <ListingGrid listings={onPage(verified)} {...grid} paginate={false} />
    <label className="check"><input type="checkbox" checked={over} onChange={e=>setOver(e.target.checked)} /> Show homes over {c.maxMinutes} min ({tooLong.length})</label>
    {over && <ListingGrid listings={onPage(tooLong)} {...grid} paginate={false} />}
    <details open={showUnchecked} onToggle={e => setShowUnchecked(e.currentTarget.open)}><summary>Not checked for commute ({unchecked.length})</summary>{showUnchecked && <ListingGrid listings={onPage(unchecked).map(p=>({...p,commute:p.commute || {error:c.usingFixtures ? 'Commute not verified (sample data)' : 'Commute not verified'}}))} {...grid} paginate={false} />}</details>
    <Pagination {...pagination} />
  </section>;
}
