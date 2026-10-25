import { catalog } from "./catalog.js";
import { warningsFor } from "./collisions.js";
export function demoPlacements(house, existing = []) {
  const floor = house.floors[0], rooms = floor.rooms, placed = [];
  for (const [i, [index, type, x, z]] of [
    [1, "living", 0.28, 0.28],
    [4, "living", 0.6, 0.55],
    [12, "bedroom", 0.5, 0.4],
    [9, "bedroom", 0.85, 0.25],
    [14, "kitchen", 0.3, 0.3],
    [16, "dining", 0.5, 0.4],
    [24, "living", 0.85, 0.2],
  ].entries()) {
    const def = catalog[index];
    const candidates = [];
    for (const r of [...rooms].sort((a,b) => Number(b.type === type) - Number(a.type === type))) {
      for (const rotationDeg of [0, 90]) {
        const width = rotationDeg ? def.depthIn : def.widthIn;
        const depth = rotationDeg ? def.widthIn : def.depthIn;
        for (let px = r.x + width/2 + 8; px <= r.x + r.widthIn - width/2 - 8; px += 12)
          for (let pz = r.z + depth/2 + 8; pz <= r.z + r.depthIn - depth/2 - 8; pz += 12)
            candidates.push({ xIn: px, zIn: pz, rotationDeg, score: (r.type === type ? 0 : 1000000) + Math.hypot(px-r.x-r.widthIn*x,pz-r.z-r.depthIn*z) });
      }
    }
    const item = {
      ...def,
      id: "demo-item-" + i,
      furnitureId: def.id,
      level: floor.level,
    };
    const position = candidates.sort((a,b)=>a.score-b.score).find(position => {
      const candidate = { ...item, ...position };
      return !warningsFor([...existing.filter(p=>p.level===floor.level), ...placed, candidate], floor).some(w=>w.ids.includes(item.id));
    });
    if (position) { const { score, ...geometry } = position; placed.push({...item,...geometry}); }
  }
  return placed;
}
