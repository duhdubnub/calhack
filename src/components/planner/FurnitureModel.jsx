import React, { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { Box } from "./Scene";
import { clampPlacement } from "../../lib/planner/collisions";
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
export default function FurnitureModel({
  item,
  selected,
  warning,
  onSelect,
  onMove,
  floor,
  snap,
  flush,
}) {
  const group = useRef(),
    drag = useRef(null),
    { controls } = useThree();
  const w = item.widthIn / 12,
    d = item.depthIn / 12,
    h = item.heightIn / 12,
    color = warning ? "#cf5550" : item.colorOverride || item.color;
  useEffect(() => () => { if (drag.current && controls) controls.enabled = true; }, [controls]);
  const outline = useMemo(() => {
    const box = new THREE.BoxGeometry(w + 0.12, h + 0.12, d + 0.12);
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [w, h, d]);
  useEffect(() => () => outline.dispose(), [outline]);
  const box = (x, y, z, a, b, c, tint = color) => (
    <Box
      position={[x, y, z]}
      size={[a, b, c]}
      color={tint}
      castShadow
      receiveShadow
    />
  );
  const legs = () =>
    [-1, 1].flatMap((x) =>
      [-1, 1].map((z) => (
        <React.Fragment key={x + "," + z}>
          {box(
            x * (w / 2 - 0.15),
            h / 2,
            z * (d / 2 - 0.15),
            0.15,
            h,
            0.15,
            "#6b5744",
          )}
        </React.Fragment>
      )),
    );
  function stop(e) {
    e.stopPropagation();
    if (!drag.current) return;
    const p = {
      ...item,
      xIn: group.current.position.x * 12,
      zIn: group.current.position.z * 12,
    };
    drag.current = null;
    if (controls) controls.enabled = true;
    e.target.releasePointerCapture?.(e.pointerId);
    if (Math.abs(p.xIn-item.xIn)>0.01 || Math.abs(p.zIn-item.zIn)>0.01) onMove(p);
  }
  return (
    <group
      ref={group}
      position={[item.xIn / 12, 0, item.zIn / 12]}
      rotation={[0, (-(item.rotationDeg || 0) * Math.PI) / 180, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        onSelect(item.id);
        if (e.pointerType === "touch" && !selected) return;
        const p = e.ray.intersectPlane(plane, new THREE.Vector3());
        if (!p) return;
        drag.current = { x: p.x - item.xIn / 12, z: p.z - item.zIn / 12 };
        e.target.setPointerCapture(e.pointerId);
        if (controls) controls.enabled = false;
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        const p = e.ray.intersectPlane(plane, new THREE.Vector3());
        if (!p) return;
        const next = clampPlacement(
          {
            ...item,
            xIn: (p.x - drag.current.x) * 12,
            zIn: (p.z - drag.current.z) * 12,
          },
          item,
          floor,
          snap,
          flush,
        );
        group.current.position.set(next.xIn / 12, 0, next.zIn / 12);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      {item.category === "bed" ? (
        <>
          {box(0, 0.6, 0, w, 1.2, d)}
          {box(0, 1.35, 0, w * 0.95, 0.3, d * 0.94, "#eee5d8")}
          {box(0, h / 2, -d / 2 + 0.1, w, h, 0.2)}
          {box(0, 1.6, -d * 0.3, w * 0.75, 0.2, d * 0.2, "#fffaf1")}
        </>
      ) : item.category === "table" || item.category === "desk" ? (
        <>
          {legs()}
          {box(0, h - 0.1, 0, w, 0.2, d)}
        </>
      ) : item.category === "seating" ? (
        <>
          {box(0, h * 0.25, 0, w, h * 0.5, d)}
          {box(0, h * 0.75, -d / 2 + 0.15, w, h * 0.5, 0.3)}
          {!item.name.toLowerCase().includes("chair") && (
            <>
              {box(-w / 2 + 0.15, h * 0.5, 0, 0.3, h * 0.4, d)}
              {box(w / 2 - 0.15, h * 0.5, 0, 0.3, h * 0.4, d)}
            </>
          )}
        </>
      ) : item.category === "rug" ? (
        box(0, 0.025, 0, w, 0.05, d)
      ) : item.category === "decor" ? (
        <>
          {box(0, 0.1, 0, w, 0.2, d)}
          {box(0, h / 2, 0, w * 0.25, h, d * 0.25)}
          {box(0, h * 0.8, 0, w, h * 0.3, d)}
        </>
      ) : (
        <>
          {box(0, h / 2, 0, w, h, d)}
          {[0.3, 0.65].map((y) => (
            <React.Fragment key={y}>
              {box(0, h * y, d / 2 + 0.01, w * 0.9, 0.04, 0.03, "#65523f")}
            </React.Fragment>
          ))}
        </>
      )}
      {selected && (
        <lineSegments position={[0, h/2, 0]} geometry={outline} raycast={()=>null}>
          <lineBasicMaterial color="#246653" depthTest={false} transparent opacity={0.85} />
        </lineSegments>
      )}
    </group>
  );
}
