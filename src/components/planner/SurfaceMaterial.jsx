import React, { useEffect, useState } from "react";
import * as THREE from "three";
import { EXRLoader } from "three/addons/loaders/EXRLoader.js";
import library from "../../../library.json";

// Vite emits these assets with production-safe URLs as well as serving them in dev.
const assets = import.meta.glob("../../../textures/**/*.{jpg,png,exr}", {
  eager: true, query: "?url", import: "default",
});
const pending = new Map();
function loadMap(path, color) {
  if (!pending.has(path)) {
    const url = assets[`../../../${path}`];
    const loader = path.endsWith(".exr") ? new EXRLoader() : new THREE.TextureLoader();
    pending.set(path, url ? loader.loadAsync(url).then(texture => {
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return texture;
    }).catch(() => null) : Promise.resolve(null));
  }
  return pending.get(path);
}

export function floorMaterial(room) {
  return room.materialId || ({ kitchen: "tile_stone_beige", bathroom: "tile_stone_beige" }[room.type]) || "wood_oak_planks";
}

export default function SurfaceMaterial({ materialId, size, fallback = "#f6f2e9" }) {
  const [materials, setMaterials] = useState(null);
  const [x, y, z] = size;
  useEffect(() => {
    const entry = library.find(item => item.id === materialId);
    let cancelled = false;
    const owned = [];
    setMaterials(null);
    if (!entry) return;
    Promise.all(Object.entries(entry.maps).map(async ([name, path]) =>
      [name, await loadMap(path, name === "color")],
    )).then(maps => {
      if (cancelled) return;
      const faces = [[z, y], [z, y], [x, z], [x, z], [x, y], [x, y]];
      const result = faces.map(([width, height]) => {
        const material = new THREE.MeshStandardMaterial({ color: maps.some(([name, map]) => name === "color" && map) ? "white" : fallback, roughness: 0.85 });
        for (const [name, original] of maps) {
          if (!original) continue;
          const texture = original.clone();
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          texture.repeat.set(width / entry.tile_ft, height / entry.tile_ft);
          texture.anisotropy = 4;
          texture.needsUpdate = true;
          material[{ color: "map", normal: "normalMap", roughness: "roughnessMap" }[name]] = texture;
          owned.push(texture);
        }
        owned.push(material);
        return material;
      });
      setMaterials(result);
    });
    return () => { cancelled = true; owned.forEach(item => item.dispose()); };
  }, [materialId, x, y, z, fallback]);
  return materials
    ? materials.map((material, index) => <primitive key={index} object={material} attach={`material-${index}`} />)
    : <meshStandardMaterial color={fallback} />;
}
