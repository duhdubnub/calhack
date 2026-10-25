import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectionsBatch, routeKey } from '../providers/commute.js';
import { createCommuteSearch, pruneCommute, groupCommutes, bounded } from '../search/commute.js';
import { createDescribedSearch } from '../search/described.js';
const c={maxMinutes:30,work:{label:'work',lat:30.2672,lng:-97.7431},departAt:'08:00'};
const homes=Array.from({length:21},(_,i)=>({id:String(i),lat:30.2672+i*.001,lng:-97.7431}));
function memory() { const values=new Map(); return async (key,fn)=>{ const k=JSON.stringify(key); if(!values.has(k)) values.set(k,fn()); return values.get(k); }; }
test('commute prunes and sorts cheaply, groups only verified numbers',()=> {
 const p=pruneCommute([...homes,{lat:40,lng:-97},{lat:null,lng:null}],c); assert.equal(p.within.length,21); assert.equal(p.excluded,1); assert.equal(p.missing.length,1);
 assert.equal(bounded(999,8,12),12); assert.equal(bounded(-1,30,50),1);
 assert.equal(groupCommutes([{commute:{minutes:20}},{commute:{minutes:40}},{commute:{error:'no'}}],30).unchecked.length,1);
});
test('one batch, label mapping, rounded route cache, capped provider and fixture mode',async()=> {
 let calls=0; const runner=async (_id,input)=>{ calls++; assert.equal(input.routes.length,8); assert.equal(input.maxConcurrency,2); return input.routes.map((r,i)=>({label:r.label,status:'OK',durationInTrafficSeconds:(20+i)*60})).reverse(); };
 const provider=createDirectionsBatch({runner,cache:memory(),fixtureMode:()=>false,enabled:()=>true});
 const params=homes.slice(0,8).map(p=>({...p,workLat:c.work.lat,workLng:c.work.lng,departAt:'08:00'}));
 const result=await provider(params); assert.equal(calls,1); assert.equal(result[0].minutes,20); await provider(params); assert.equal(calls,1);
 assert.deepEqual(routeKey({...params[0],lat:30.26721}),routeKey(params[0]));
 await assert.rejects(provider([...params,...params]),/limit/);
 const fail=createDirectionsBatch({runner:async()=>{throw Error('cap');},cache:memory(),fixtureMode:()=>false,enabled:()=>true});
 assert.match((await fail(params))[0].error,/cap/);
 const offline=createDirectionsBatch({runner:()=>{throw Error('no network');},fixtureMode:()=>true});
 assert.equal((await offline(params))[0].usingFixtures,true);
 const fixture=await offline([{lat:30.401,lng:-97.725,workLat:30.2672,workLng:-97.7431,departAt:'08:00'}]); assert.equal(fixture[0].minutes,35);
});
test('bounded sessions verify next batch, isolate clients, prevent parallel batches, retain unchecked on failure',async()=> {
 let calls=0; const service=createCommuteSearch({batch:async ps=>{calls++;assert.ok(ps.length<=8);return ps.map((_,i)=>i===0?{minutes:40}:{minutes:20});}});
 const first=await service.start(homes,c,'a'); assert.equal(first.commute.checked,8); assert.equal(first.commute.under,7); assert.equal(first.commute.remaining,13);
 await assert.rejects(service.more(first.commute.token,'b'),/expired/);
 const second=await service.more(first.commute.token,'a'); assert.equal(second.commute.checked,16); assert.equal(calls,2);
 let release; const blocked=createCommuteSearch({batch:()=>new Promise(r=>{release=r;})}); const pending=blocked.start(homes,c,'x'); await assert.rejects(blocked.start(homes,c,'x'),/already/); release([]); await pending;
 const fail=createCommuteSearch({batch:async()=>{throw Error('cap');}}); const p=await fail.start(homes,c,'x'); assert.equal(p.commute.checked,0); assert.equal(p.commute.unchecked,21); assert.match(p.commute.error,/cap/);
});
test('Actor batches separate departure times and send root-level date and time', async () => {
 const inputs=[];
 const provider=createDirectionsBatch({cache:memory(),fixtureMode:()=>false,enabled:()=>true,runner:async(_id,input)=>{
  inputs.push(input);
  assert.match(input.travelDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.equal(input.timeMode,'depart_at');
  assert.ok(input.routes.every(route=>!('departureTime' in route)));
  return input.routes.map(route=>({label:route.label,status:'OK',durationSeconds:600}));
 }});
 const p={lat:37.77,lng:-122.42,workLat:37.79,workLng:-122.4};
 const results=await provider(['08:00','17:30','03:00'].map(departAt=>({...p,departAt})));
 assert.deepEqual(inputs.map(input=>input.travelTime),['08:00','17:30','03:00']);
 assert.ok(results.every(result=>result.minutes===10));
});
test('described search expands source limits only for commute and preserves old criteria',async()=> {
 let input; const search=createDescribedSearch({searchProvider:async c=>{input=c;return {listings:homes,notes:[],usingFixtures:false};},commute:createCommuteSearch({batch:async ps=>ps.map(()=>({minutes:20}))})});
 await search({criteria:{location:'Austin',limit:12},extras:{}},'a'); assert.equal(input.limit,12);
 await search({criteria:{location:'Austin',limit:12},extras:{commute:c}},'a'); assert.equal(input.limit,30);
});
