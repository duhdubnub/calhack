import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { EventEmitter } from "node:events";
import express from "express";
import { importFloorPlan } from "../../src/lib/planner/importFloorPlan.js";
import { wallSections } from "../../src/lib/planner/detectedWalls.js";
import { wallSegments, warningsFor } from "../../src/lib/planner/collisions.js";
import { validateFloorPlan } from "../../src/lib/planner/calibration.js";
import { resolvePlannerHouse } from "../../src/lib/planner/planHouse.js";
import { createCubicasaConverter, cubicasaSettings, runWorker, ConversionError } from "../floorplan/converters/cubicasa.js";
import { createConverterRegistry } from "../floorplan/converters/index.js";
import { createFloorPlanRouter } from "../floorplan/routes.js";

const sample = JSON.parse(await fs.readFile(new URL("../../src/lib/planner/sampleFloorPlan.json",import.meta.url),"utf8"));
test("CubiCasa uses bundled source and never treats the pose backbone as trained floor-plan weights", () => {
  const settings = cubicasaSettings({});
  assert.match(settings.dir.replaceAll("\\", "/"), /floorplan\/cubicasa5k\/?$/);
  assert.ok(!settings.weights || settings.weights.endsWith("model_best_val_loss_var.pkl"));
  const explicit = cubicasaSettings({ CUBICASA_DIR: "missing-model-source", CUBICASA_WEIGHTS: "missing-checkpoint", CUBICASA_PYTHON: "custom-python" });
  assert.equal(explicit.dir, "missing-model-source");
  assert.equal(explicit.weights, "missing-checkpoint");
  assert.equal(explicit.python, "custom-python");
  assert.equal(explicit.configured, false);
});
test("notebook feet import preserves real wall geometry, door clearance, window sill and reload", () => {
  const model = importFloorPlan(sample), f = model.floors[0];
  assert.equal(f.walls.length,5);
  assert.equal(f.doors.length,2);
  assert.equal(f.windows.length,2);
  assert.equal(f.walls[0].x2-f.walls[0].x1,240);
  assert.equal(model.ceilingHeightIn,96);
  assert.equal(f.walls[0].thicknessIn,6);
  const saved = validateFloorPlan({mode:"plan",plans:[],convertedHouseModel:model});
  assert.equal(saved.mode,"plan");
  assert.deepEqual(resolvePlannerHouse(null,saved,[]),model);
  const chair = { id:"chair",name:"Chair",widthIn:12,depthIn:12,category:"seating",xIn:123,zIn:40 };
  assert.ok(warningsFor([chair],f).some(w=>w.type === "wall"));
  assert.ok(!warningsFor([{...chair,zIn:99}],f).some(w=>w.type === "wall"));
  assert.ok(warningsFor([{...chair,zIn:99}],f).some(w=>w.type === "door"));
  assert.ok(warningsFor([{...chair,xIn:63,zIn:3}],f).some(w=>w.type === "wall"));
});

test("pixel conversion handles all rotations without rescaling furniture or moving opening along wall", () => {
  const data = { units:"pixels",walls:[{id:7,x1:10,y1:20,x2:210,y2:20,thickness:4}],openings:[{wall:7,type:"door",position:100,width:30}] };
  const expected = [[5,10,105,10],[140,5,140,105],[195,140,95,140],[10,195,10,95]];
  for (let i=0;i<4;i++) {
    const f = importFloorPlan(data,{pixelsPerInch:2,widthPx:400,heightPx:300,rotationDeg:i*90}).floors[0];
    assert.deepEqual([f.walls[0].x1,f.walls[0].z1,f.walls[0].x2,f.walls[0].z2],expected[i]);
    assert.equal(f.walls[0].openings[0].positionIn,50);
    assert.equal(f.walls[0].openings[0].widthIn,15);
    assert.ok(wallSegments(f).length === 2);
  }
});

test("angled walls retain orientation in furniture collision checks", () => {
  const f = importFloorPlan({ units:"inches", walls:[{id:0,x1:10,y1:10,x2:110,y2:110,thickness:4}],openings:[] }).floors[0];
  assert.equal(wallSegments(f)[0].rotationDeg,45);
  assert.ok(warningsFor([{id:"a",name:"Desk",widthIn:10,depthIn:10,xIn:60,zIn:60}],f).some(w=>w.type === "wall"));
  assert.ok(!warningsFor([{id:"a",name:"Desk",widthIn:10,depthIn:10,xIn:20,zIn:90}],f).some(w=>w.type === "wall"));
});

test("overlapping openings subtract their union and keep headers and sills within ceiling", () => {
  const w = {x1:0,z1:0,x2:200,z2:0,openings:[
    {type:"door",positionIn:60,widthIn:40,heightIn:81,sillIn:0},
    {type:"window",positionIn:80,widthIn:40,heightIn:48,sillIn:36},
  ]};
  const parts = wallSections(w,96);
  assert.ok(parts.every(p=>p.bottom>=0 && p.top<=96 && p.top>p.bottom));
  assert.equal(parts.filter(p=>p.a===60 && p.b===80).length,1);
  assert.equal(parts.find(p=>p.a===60 && p.b===80).bottom,84);
  assert.ok(!wallSections(w,14.4).some(p=>p.a===60 && p.b===80));
});

test("imports reject unscaled, invalid, duplicate, detached and out-of-bounds geometry", () => {
  for (const data of [
    {...sample,units:"pixels"},
    {...sample,walls:[{...sample.walls[0],x1:NaN}]},
    {...sample,walls:[sample.walls[0],sample.walls[0]]},
    {...sample,openings:[{wall:999,type:"door",position:1,width:3}]},
    {...sample,openings:[{wall:0,type:"door",position:1000,width:3}]},
    {...sample,walls:[{...sample.walls[0],x2:sample.walls[0].x1}]},
  ]) assert.throws(()=>importFloorPlan(data));
  assert.throws(()=>importFloorPlan(sample,{pixelsPerInch:1,widthPx:100,heightPx:100}));
});

const workerData = { units:"pixels",width_px:800,height_px:600,pixels_per_inch:2,scale_method:"ocr",
  walls:[{id:0,x1:20,y1:20,x2:600,y2:20,thickness:8}],openings:[{wall:0,type:"window",position:200,width:80}] };
const settings = {configured:true,python:"test-python",dir:"test-dir",weights:"test-weights"};
test("converter serializes CPU jobs and releases its slot after completion or errors", async () => {
  let release;
  const c = createCubicasaConverter({settings,run:()=>new Promise(r=>{release=r;})});
  const input = {asset:{pngPath:"asset.png",widthPx:800,heightPx:600},calibration:{pixelsPerInch:2},ceilingHeightIn:108};
  const job = c.convert(input);
  await assert.rejects(()=>c.convert(input),/Another plan/);
  release(workerData);
  const result = await job;
  assert.equal(result.houseModel.ceilingHeightIn,108);
  assert.equal(result.calibration.pixelsPerInch,2);
  const bad = createCubicasaConverter({settings,run:async()=>{throw new Error("failed");}});
  await assert.rejects(()=>bad.convert(input),/failed/);
  await assert.rejects(()=>bad.convert(input),/failed/);
});

test("worker has bounded output, a timeout and sanitized errors", async () => {
  function fakeSpawn(event) {
    return () => {
      const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = () => {};
      setTimeout(()=>event?.(c),1);
      return c;
    };
  }
  await assert.rejects(()=>runWorker([],{timeoutMs:5,spawnProcess:fakeSpawn()}),/timed out/);
  await assert.rejects(()=>runWorker([],{spawnProcess:fakeSpawn(c=>{c.stdout.emit("data",Buffer.alloc(2000001));})}),/too complex/);
  await assert.rejects(()=>runWorker([],{spawnProcess:fakeSpawn(c=>{c.stdout.emit("data",Buffer.from('{"error":"scale"}'));c.emit("close",1);})}),/Set the scale/);
  assert.deepEqual(await runWorker([],{spawnProcess:fakeSpawn(c=>{c.stdout.emit("data",Buffer.from('{"ok":true}'));c.emit("close",0);})}),{ok:true});
});

test("image API converts with OCR scale, protects ownership and preserves assigned floor", async () => {
  const id="c".repeat(32),client="12345678-1234-4234-8234-123456789abc";
  const registry = createConverterRegistry({ cubicasa:createCubicasaConverter({settings,run:async()=>workerData}) });
  const app = express(); app.use(express.json());
  app.use(createFloorPlanRouter({registry,assets:{get:async(assetId,owner)=>{
    if(assetId!==id || owner!==client) throw Error("owner");
    return {assetId,pngPath:"asset.png",widthPx:800,heightPx:600};
  }}}));
  const server=app.listen(0,"127.0.0.1"); await new Promise(r=>server.once("listening",r));
  try {
    const url=`http://127.0.0.1:${server.address().port}/${id}/convert`;
    const res = await fetch(url,{method:"POST",headers:{"X-Client-Id":client,"Content-Type":"application/json"},body:JSON.stringify({converter:"cubicasa",levelIndex:3,rotationDeg:90})});
    assert.equal(res.status,200);
    const result=await res.json();
    assert.equal(result.houseModel.floors[0].level,3);
    assert.equal(result.houseModel.floors[0].widthIn,300);
    assert.equal(result.calibration.pixelsPerInch,2);
    const bad=await fetch(url,{method:"POST",headers:{"X-Client-Id":"22345678-1234-4234-8234-123456789abc","Content-Type":"application/json"},body:JSON.stringify({converter:"cubicasa"})});
    assert.equal(bad.status,400);
  } finally { server.closeAllConnections(); await new Promise(r=>server.close(r)); }
});
