import PlanFloor from "./PlanFloor";
import DetectedWalls from "./DetectedWalls";
import SurfaceMaterial, { floorMaterial } from "./SurfaceMaterial";
import React, { useEffect, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import {
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  Html,
} from "@react-three/drei";
import * as THREE from "three";
const roomColors = {
  living: "#e8ddc7",
  kitchen: "#d9e5dc",
  bedroom: "#e4dce8",
  bathroom: "#d5e5ed",
  hallway: "#eee9df",
  dining: "#eaddce",
};
export function Box({ position, size, color, materialId, ...props }) {
  return (
    <mesh position={position} {...props}>
      <boxGeometry args={size} />
      {materialId ? <SurfaceMaterial materialId={materialId} size={size} fallback={color} /> : <meshStandardMaterial
        color={color}
        transparent={color === "#a9d5e3"}
        opacity={color === "#a9d5e3" ? 0.5 : 1}
      />}
    </mesh>
  );
}
function Camera({ floor, view, focus, onCameraControls }) {
  const controls = useRef(),
    { camera, size } = useThree();
  useEffect(() => {
    onCameraControls?.((action) => {
      const orbit = controls.current;
      if (!orbit) return;
      if (action === "in" || action === "out") {
        const factor = action === "in" ? 0.8 : 1.25;
        if (camera.isOrthographicCamera) {
          camera.zoom = Math.max(1, Math.min(100, camera.zoom / factor));
          camera.updateProjectionMatrix();
        } else
          camera.position
            .sub(orbit.target)
            .multiplyScalar(factor)
            .add(orbit.target);
      } else {
        const delta = new THREE.Vector3(
          action === "left" ? -2 : action === "right" ? 2 : 0,
          0,
          action === "up" ? -2 : action === "down" ? 2 : 0,
        );
        camera.position.add(delta);
        orbit.target.add(delta);
      }
      orbit.update();
    });
  }, [camera, onCameraControls]);
  useEffect(() => {
    const x = (focus ? focus.x + focus.widthIn / 2 : floor.widthIn / 2) / 12,
      z = (focus ? focus.z + focus.depthIn / 2 : floor.depthIn / 2) / 12;
    camera.position.set(
      x + (view === "3D" ? Math.max(floor.widthIn,floor.depthIn)/12*.85 : 0),
      view === "3D" ? Math.max(floor.widthIn,floor.depthIn)/12*1.1 : 70,
      z + (view === "3D" ? Math.max(floor.widthIn,floor.depthIn)/12 : 0.01),
    );
    if (view === "2D") {
      camera.zoom = Math.min(
        size.width / (floor.widthIn / 12 + 6),
        size.height / (floor.depthIn / 12 + 6),
      );
      camera.updateProjectionMatrix();
    }
    camera.lookAt(x, 0, z);
    controls.current?.target.set(x, 0, z);
    controls.current?.update();
  }, [
    camera,
    floor.widthIn,
    floor.depthIn,
    focus,
    view,
    size.width,
    size.height,
  ]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={view === "3D"}
      minDistance={5}
      maxDistance={Math.max(180,Math.max(floor.widthIn,floor.depthIn)/3)}
      maxPolarAngle={Math.PI / 2 - 0.03}
    />
  );
}
function Wall({ room, edge, floor, height }) {
  const horizontal = edge === "north" || edge === "south",
    fixed = horizontal
      ? edge === "north"
        ? room.z
        : room.z + room.depthIn
      : edge === "west"
        ? room.x
        : room.x + room.widthIn,
    start = horizontal ? room.x : room.z,
    end = start + (horizontal ? room.widthIn : room.depthIn);
  const openings = [...floor.doors, ...floor.windows]
    .filter(
      (d) =>
        d.axis === (horizontal ? "x" : "z") &&
        Math.abs((horizontal ? d.z : d.x) - fixed) < 0.01,
    )
    .map((d) => ({
      a: Math.max(start, (horizontal ? d.x : d.z) - d.widthIn / 2),
      b: Math.min(end, (horizontal ? d.x : d.z) + d.widthIn / 2),
      window: !!d.roomId,
    }))
    .filter((d) => d.b > d.a)
    .sort((a, b) => a.a - b.a);
  const parts = [];
  let cursor = start;
  const part = (a, b, y, h, color = "#f6f2e9") => {
    if (b - a > 0)
      parts.push(
        <Box
          key={parts.length}
          position={
            horizontal
              ? [(a + b) / 24, y, fixed / 12]
              : [fixed / 12, y, (a + b) / 24]
          }
          size={horizontal ? [(b - a) / 12, h, 0.12] : [0.12, h, (b - a) / 12]}
          color={color}
          materialId={color === "#a9d5e3" ? undefined : "plaster_beige"}
        />,
      );
  };
  for (const o of openings) {
    part(cursor, o.a, height / 2, height);
    if (o.window) {
      part(o.a, o.b, Math.min(height, 2) / 2, Math.min(height, 2));
      if (height > 2) part(o.a, o.b, 3, 2, "#a9d5e3");
      if (height > 4) part(o.a, o.b, (height + 4) / 2, height - 4);
    } else if (height > 6.8) part(o.a, o.b, (height + 6.8) / 2, height - 6.8);
    cursor = Math.max(cursor, o.b);
  }
  part(cursor, end, height / 2, height);
  return <group>{parts}</group>;
}
function Content({
  floor,
  ceilingHeightIn=96,planUrl,planRotation,planOpacity,
  view,
  fullWalls,
  quality,
  focus,
  children,
  onEmpty,
  onProject,
  onCameraControls,
}) {
  const { camera, gl, raycaster } = useThree();
  useEffect(() => {
    onProject?.((clientX, clientY) => {
      const rect = gl.domElement.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((clientX - rect.left) / rect.width) * 2 - 1,
          (-(clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      return raycaster.ray.intersectPlane(
        new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
        new THREE.Vector3(),
      );
    });
  }, [camera, gl, raycaster, onProject]);
  return (
    <>
      <color attach="background" args={["#f0eee8"]} />
      {view === "2D" ? (
        <OrthographicCamera
          makeDefault
          position={[0, 70, 0.01]}
          zoom={12}
          near={0.1}
          far={500}
        />
      ) : (
        <PerspectiveCamera makeDefault position={[35, 40, 40]} fov={48} far={100000} />
      )}
      <Camera
        floor={floor}
        view={view}
        focus={focus}
        onCameraControls={onCameraControls}
      />
      <ambientLight intensity={1.5} />
      <directionalLight
        position={[15, 35, 20]}
        intensity={2}
        castShadow={quality === "high"}
      />
      <gridHelper
        args={[200, 200, "#c2c9c2", "#e1e3dc"]}
        position={[0, -0.1, 0]}
      />
      {floor.rooms.map((room) => (
        <group key={room.id}>
          <Box
            position={[
              (room.x + room.widthIn / 2) / 12,
              -0.04,
              (room.z + room.depthIn / 2) / 12,
            ]}
            size={[room.widthIn / 12, 0.08, room.depthIn / 12]}
            color={roomColors[room.type]}
            materialId={view === "3D" ? floorMaterial(room) : undefined}
            onClick={onEmpty}
            receiveShadow
          />
          {!floor.openPlan && !floor.walls && ["north", "south", "east", "west"].map((edge) => (
            <Wall
              key={edge}
              room={room}
              edge={edge}
              floor={floor}
              height={view === "2D" ? 0.15 : fullWalls ? ceilingHeightIn/12 : 1.2}
            />
          ))}
          {!floor.openPlan&&!floor.walls&&<Html
            position={[
              (room.x + room.widthIn / 2) / 12,
              0.05,
              (room.z + room.depthIn / 2) / 12,
            ]}
            center
            style={{ pointerEvents: "none" }}
          >
            <span className="room-label">{room.name}</span>
          </Html>}
        </group>
      ))}
      {floor.walls && <DetectedWalls walls={floor.walls} heightIn={view === "2D" ? 1.8 : fullWalls ? ceilingHeightIn : 14.4} />}
      {planUrl&&view === "2D"&&<PlanFloor url={planUrl} floor={floor} rotationDeg={planRotation} opacity={planOpacity}/> }
      {children}
    </>
  );
}
export default function Scene(props) {
  return (
    <Canvas
      aria-label="House layout. Use the Rooms and furniture panels for keyboard controls."
      dpr={[1, 2]}
      shadows={props.quality === "high"}
      gl={{ preserveDrawingBuffer: true }}
      onCreated={({ gl }) => props.onCanvas?.(gl.domElement)}
    >
      <Content {...props} />
    </Canvas>
  );
}
