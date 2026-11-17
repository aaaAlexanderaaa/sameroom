import * as THREE from "three";
import type { GuestAsset } from "../shared/guest.js";
import type { SceneDesign } from "./scene-design.js";

type Point = [number, number, number];
type Surface = Parameters<SceneDesign["material"]>[1];

/** Product-neutral authored equipment. No screen, lamp or fan implies live state. */
export function detailedWorkstation(asset: GuestAsset, paint: SceneDesign) {
  const { kind, width: w, height: h, depth: d, color } = asset;
  if (
    ![
      "laptop",
      "desktop-speaker",
      "desk-lamp",
      "monitor-arm",
      "dual-monitor-arm",
    ].includes(kind)
  )
    return;
  const group = new THREE.Group();
  const dark = "#242b2f",
    metal = "#4a555b";
  const box = (
    size: Point,
    p: Point,
    c = color,
    surface: Surface = "metal",
  ) => {
    const mesh = paint.box(size, c, p, Math.min(...size) * 0.12, surface);
    group.add(mesh);
    return mesh;
  };
  const rod = (a: Point, b: Point, r = 0.012, c = metal) => {
    const mesh = paint.rod(a, b, r, c);
    group.add(mesh);
    return mesh;
  };
  const disc = (
    radius: number,
    length: number,
    p: Point,
    c = color,
    surface: Surface = "metal",
  ) => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 32),
      paint.material(c, surface),
    );
    mesh.position.set(...p);
    group.add(mesh);
    return mesh;
  };
  if (kind === "laptop") {
    box([w, h * 0.065, d], [0, h * 0.035, 0]);
    box([w * 0.91, h * 0.77, d * 0.045], [0, h * 0.615, -d * 0.43]);
    box(
      [w * 0.86, h * 0.69, 0.002],
      [0, h * 0.615, -d * 0.404],
      "#ffffff",
      "screen",
    );
    for (let row = 0; row < 5; row++)
      for (let key = 0; key < 13; key++)
        box(
          [w * 0.052, 0.001, d * 0.056],
          [-w * 0.36 + key * w * 0.06, h * 0.071, -d * 0.22 + row * d * 0.065],
          dark,
          "paint",
        );
    box(
      [w * 0.31, 0.001, d * 0.19],
      [0, h * 0.072, d * 0.26],
      "#737d83",
      "paint",
    );
    rod(
      [-w * 0.42, h * 0.12, -d * 0.43],
      [w * 0.42, h * 0.12, -d * 0.43],
      h * 0.035,
    );
  } else if (kind === "desktop-speaker") {
    box([w, h, d], [0, h / 2, 0], color, "paint");
    box([w * 0.95, h * 0.83, 0.004], [0, h * 0.52, d / 2], dark, "fabric");
    for (const x of [-w * 0.29, w * 0.29]) {
      const speaker = disc(
        Math.min(h * 0.32, w * 0.15),
        0.006,
        [x, h * 0.52, d * 0.52],
        "#536269",
        "paint",
      );
      speaker.rotation.x = Math.PI / 2;
      const hub = disc(h * 0.12, 0.008, [x, h * 0.52, d * 0.55], dark);
      hub.rotation.x = Math.PI / 2;
    }
    box(
      [w * 0.16, h * 0.12, 0.003],
      [0, h * 0.26, d * 0.52],
      "#161d21",
      "paint",
    );
    for (const x of [-w * 0.12, 0, w * 0.12])
      disc(h * 0.04, 0.002, [x, h * 1.01, 0], dark);
  } else if (kind === "desk-lamp") {
    disc(w * 0.43, h * 0.06, [0, h * 0.03, 0], color);
    rod([0, h * 0.06, 0], [0, h * 0.65, -d * 0.1], w * 0.035, color);
    rod([0, h * 0.65, -d * 0.1], [0, h * 0.8, 0], w * 0.035, color);
    const head = new THREE.Group();
    head.position.set(0, h * 0.8, 0);
    head.rotation.x = -(asset.lightTilt ?? -Math.PI / 5);
    group.add(head);
    const housing = new THREE.Mesh(
      new THREE.CylinderGeometry(w * 0.3, w * 0.36, d * 0.45, 32),
      paint.material(color, "metal"),
    );
    housing.rotation.x = Math.PI / 2;
    head.add(housing);
    const lens = new THREE.Mesh(
      new THREE.CircleGeometry(w * 0.295, 32),
      paint.material("#f4e5bc", "paint"),
    );
    lens.position.z = d * 0.23;
    head.add(lens);
  } else {
    const dual = kind === "dual-monitor-arm",
      poleX = dual ? -w * 0.18 : 0;
    box(
      [w * (dual ? 0.13 : 0.25), h * 0.07, d * 0.42],
      [poleX, h * 0.04, -d * 0.29],
      dark,
    );
    rod(
      [poleX, h * 0.06, -d * 0.28],
      [poleX, h * 0.97, -d * 0.28],
      0.018,
      dark,
    );
    for (const branch of dual ? [1, -1] : [1]) {
      const y = branch === 1 ? h * 0.78 : h * 0.43,
        endX = dual ? branch * w * 0.46 : w * 0.32;
      rod(
        [poleX, y, -d * 0.28],
        [endX * 0.5, y + h * 0.12, -d * 0.45],
        0.023,
        dark,
      );
      rod(
        [endX * 0.5, y + h * 0.12, -d * 0.45],
        [endX, y, d * (dual && branch === -1 ? 0.13 : 0.43)],
        0.02,
        dark,
      );
      box(
        [Math.min(w * 0.19, 0.09), h * 0.14, 0.018],
        [endX, y, d * (dual && branch === -1 ? 0.16 : 0.46)],
        metal,
      );
      const joint = disc(
        0.027,
        0.036,
        [endX * 0.5, y + h * 0.12, -d * 0.45],
        metal,
      );
      joint.rotation.x = Math.PI / 2;
    }
  }
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  group.position.set(-center.x, -bounds.min.y, -center.z);
  const fitted = new THREE.Group();
  fitted.add(group);
  fitted.scale.set(w / size.x, h / size.y, d / size.z);
  return paint.batch(fitted);
}
