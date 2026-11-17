import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { SceneDesign } from "../src/scene-design.js";
import { furnitureSizes } from "../shared/layout.js";
import { type SceneAsset } from "../shared/domain.js";
import { frontAngle } from "../shared/spatial.js";
import { localVolumes } from "../shared/volumes.js";
// Only canvas-backed material creation needs a DOM; geometry checks use real Three.js.
const context = new Proxy(
  { createLinearGradient: () => ({ addColorStop: () => {} }) },
  {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : () => {},
  },
);
Object.assign(globalThis, {
  document: {
    createElement: () => ({
      width: 256,
      height: 256,
      getContext: () => context,
    }),
  },
});
function asset(kind: SceneAsset["kind"]): SceneAsset {
  const [width, height, depth] = furnitureSizes[kind] ?? [0.3, 0.4, 0.2];
  return {
    id: kind,
    name: kind,
    kind,
    width,
    height,
    depth,
    color: "#aabbaa",
    provenance: "Synthetic shape regression",
  };
}
function rayY(group: THREE.Object3D, x: number, z: number) {
  group.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, 5, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(group, true)[0]?.point.y;
}
test("overview retains round basket, upholstered arms and toilet silhouette rather than bounding boxes", () => {
  const design = new SceneDesign("natural");
  const round = design.overview(asset("round-storage-table"));
  assert.equal(rayY(round, 0.27, 0.27), undefined);
  assert.ok(rayY(round, 0, 0)! > 0.4);
  const chair = design.overview(asset("armchair"));
  assert.ok(rayY(chair, 0.34, 0)! > rayY(chair, 0, 0)! + 0.12);
  // The actual back must be behind the declared viewing direction and match diagnostics.
  for (const kind of ["chair", "gaming-chair", "armchair"] as const) {
    const a = asset(kind),
      model = design.overview(a);
    const frontZ = Math.cos(frontAngle(a)) * a.depth * 0.3;
    assert.ok(rayY(model, 0, -frontZ)! > rayY(model, 0, frontZ)! + 0.1, kind);
    assert.ok(localVolumes(a)[1].center[2] * frontZ < 0, kind);
  }
  const toilet = design.overview(asset("toilet"));
  assert.ok(rayY(toilet, 0, -0.25)! > rayY(toilet, 0, 0.2)! + 0.15);
  for (const kind of [
    "round-storage-table",
    "armchair",
    "sink",
    "toilet",
    "table",
    "laptop",
    "dual-monitor-arm",
    "computer",
    "server",
    "box",
    "plant",
    "plug",
  ] as const) {
    const a = asset(kind),
      size = new THREE.Box3()
        .setFromObject(design.overview(a))
        .getSize(new THREE.Vector3());
    for (const [actual, expected] of [
      [size.x, a.width],
      [size.y, a.height],
      [size.z, a.depth],
    ])
      assert.ok(
        actual <= expected + 0.001 && actual >= expected * 0.97,
        `${kind}: ${actual} vs ${expected}`,
      );
  }
});
