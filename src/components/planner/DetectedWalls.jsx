import React from "react";
import SurfaceMaterial from "./SurfaceMaterial";
import { wallFrame, wallSections } from "../../lib/planner/detectedWalls";

export default function DetectedWalls({ walls, heightIn }) {
  return walls.map(w => {
    const frame = wallFrame(w);
    return <group key={w.id} position={[w.x1/12,0,w.z1/12]} rotation={[0,-frame.angle*Math.PI/180,0]}>
      {wallSections(w,heightIn).map((p,i) => <mesh key={i} position={[(p.a+p.b)/24,(p.bottom+p.top)/24,0]} castShadow receiveShadow>
        <boxGeometry args={[(p.b-p.a)/12,(p.top-p.bottom)/12,w.thicknessIn/12]} />
        <SurfaceMaterial materialId={w.materialId || "plaster_beige"} size={[(p.b-p.a)/12,(p.top-p.bottom)/12,w.thicknessIn/12]} />
      </mesh>)}
      {w.openings.filter(o => o.type === "window" && o.sillIn < heightIn).map((o,i) => {
        const bottom = o.sillIn, top = Math.min(heightIn,bottom+o.heightIn);
        const a = Math.max(0,o.positionIn-o.widthIn/2), b = Math.min(frame.length,o.positionIn+o.widthIn/2);
        return b > a && <mesh key={`glass-${i}`} position={[(a+b)/24,(bottom+top)/24,0]}>
          <boxGeometry args={[(b-a)/12,(top-bottom)/12,0.04]} />
          <meshStandardMaterial color="#a9d5e3" transparent opacity={0.4} />
        </mesh>;
      })}
    </group>;
  });
}
