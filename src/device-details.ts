import * as THREE from "three";
import { deviceKinds } from "../shared/domain.js";
import type { GuestAsset } from "../shared/guest.js";
import type { SceneDesign } from "./scene-design.js";

type Point = [number, number, number];
type Surface = Parameters<SceneDesign["material"]>[1];

/** Authored device bodies only: no displayed LED, screen or geometry implies live state. */
export function detailedDevice(asset: GuestAsset, paint: SceneDesign) {
  if (
    !([...deviceKinds, "privacy-screen", "plug"] as readonly string[]).includes(
      asset.kind,
    )
  )
    return;
  const { width: w, height: h, depth: d, kind, color } = asset;
  const group = new THREE.Group();
  const dark = "#343b3e",
    silver = "#aeb6b4";
  const box = (
    size: Point,
    c: string,
    p: Point,
    surface: Surface = "paint",
    radius = 0,
  ) => {
    const item = radius
      ? paint.box(size, c, p, radius, surface)
      : new THREE.Mesh(
          new THREE.BoxGeometry(...size),
          paint.material(c, surface),
        );
    item.position.set(...p);
    item.castShadow = item.receiveShadow =
      surface !== "glass" && surface !== "veil";
    group.add(item);
    return item;
  };
  const cylinder = (
    r: number,
    height: number,
    c: string,
    p: Point,
    surface: Surface = "paint",
  ) => {
    const item = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, height, 24),
      paint.material(c, surface),
    );
    item.position.set(...p);
    item.castShadow = item.receiveShadow = true;
    group.add(item);
    return item;
  };
  const socket = (
    x: number,
    y: number,
    z: number,
    size: number,
    horizontal = false,
  ) => {
    for (const dx of [-size * 0.17, size * 0.17]) {
      const hole = box([size * 0.055, size * 0.23, 0.0015], dark, [
        x + dx,
        y,
        z,
      ]);
      hole.rotation.z = dx < 0 ? -0.3 : 0.3;
      if (horizontal) {
        hole.rotation.x = -Math.PI / 2;
        hole.position.set(x + dx, y, z + size * 0.08);
      }
    }
    const earth = box([size * 0.055, size * 0.16, 0.0015], dark, [
      x,
      y + size * 0.2,
      z,
    ]);
    if (horizontal) {
      earth.rotation.x = -Math.PI / 2;
      earth.position.set(x, y, z - size * 0.18);
    }
  };
  if (kind === "mac-mini" || kind === "mini-pc" || kind === "single-board") {
    const mac = kind === "mac-mini",
      board = kind === "single-board";
    box([w * 0.9, h * 0.12, d * 0.9], dark, [0, h * 0.06, 0], "paint", 0.003);
    box(
      [w, h * 0.87, d],
      color,
      [0, h * 0.55, 0],
      mac ? "metal" : "paint",
      Math.min(h * 0.16, 0.009),
    );
    if (mac) {
      // Subtle top badge without a copied brand texture; M1/M4 differ by actual proportions.
      cylinder(w * 0.07, 0.0005, "#7c8586", [0, h * 0.991, 0], "metal");
      if (h / w > 0.2)
        for (const x of [-w * 0.2, w * 0.05])
          box([0.009, 0.004, 0.002], dark, [x, h * 0.38, d * 0.501]);
    } else {
      for (let i = 0; i < 7; i++)
        box([w * 0.65, 0.001, d * 0.019], dark, [
          0,
          h * 0.989,
          -d * 0.3 + i * d * 0.1,
        ]);
      if (board)
        for (let i = 0; i < 10; i++)
          box(
            [w * 0.018, h * 0.07, d * 0.045],
            silver,
            [-w * 0.35 + i * w * 0.075, h, -d * 0.32],
            "metal",
          );
      for (const x of [-w * 0.27, w * 0.06])
        box([w * 0.18, h * 0.17, 0.002], dark, [x, h * 0.38, d * 0.501]);
    }
    for (let i = 0; i < 4; i++)
      box([w * 0.12, h * 0.2, 0.002], dark, [
        -w * 0.29 + i * w * 0.19,
        h * 0.43,
        -d * 0.501,
      ]);
  } else if (kind === "desktop-pc" && asset.glassPanels?.length) {
    // Hollow chassis: local +Z is front and local +X is right.
    for (const y of [h * 0.04, h * 0.97])
      box([w, h * 0.06, d], color, [0, y, 0], "metal");
    box([w, h * 0.9, 0.012], color, [0, h * 0.51, -d * 0.48], "metal");
    for (const x of [-w * 0.48, w * 0.48])
      for (const z of [-d * 0.48, d * 0.48])
        box([0.012, h * 0.9, 0.012], color, [x, h * 0.51, z], "metal");
    box(
      [w * 0.96, h * 0.9, 0.006],
      color,
      [0, h * 0.51, d * 0.48],
      asset.glassPanels.includes("front") ? "glass" : "metal",
    );
    for (const side of [-1, 1])
      box(
        [0.006, h * 0.9, d * 0.96],
        color,
        [side * w * 0.48, h * 0.51, 0],
        asset.glassPanels.includes(side < 0 ? "left" : "right")
          ? "glass"
          : "metal",
      );
    box([w * 0.7, h * 0.14, d * 0.78], dark, [0, h * 0.13, 0], "metal");
    box(
      [0.009, h * 0.6, d * 0.67],
      "#455455",
      [-w * 0.39, h * 0.57, 0],
      "paint",
    );
    box([w * 0.65, h * 0.09, d * 0.65], "#687478", [0, h * 0.43, 0], "metal");
    for (const y of [h * 0.36, h * 0.73]) {
      const fan = cylinder(
        w * 0.31,
        0.015,
        "#64737a",
        [0, y, -d * 0.38],
        "metal",
      );
      fan.rotation.x = Math.PI / 2;
      const hub = cylinder(w * 0.08, 0.02, dark, [0, y, -d * 0.35]);
      hub.rotation.x = Math.PI / 2;
    }
  } else if (kind === "desktop-pc") {
    box([w, h * 0.95, d], color, [0, h * 0.525, 0], "metal", 0.012);
    for (const x of [-w * 0.35, w * 0.35])
      for (const z of [-d * 0.34, d * 0.34])
        box([w * 0.16, h * 0.05, d * 0.1], dark, [x, h * 0.025, z]);
    box([w * 0.88, h * 0.88, 0.006], dark, [0, h * 0.52, d * 0.505], "fabric");
    for (const y of [h * 0.29, h * 0.65]) {
      const fan = cylinder(
        w * 0.31,
        0.003,
        "#535d60",
        [0, y, d * 0.52],
        "metal",
      );
      fan.rotation.x = Math.PI / 2;
      const hub = cylinder(w * 0.09, 0.005, dark, [0, y, d * 0.53]);
      hub.rotation.x = Math.PI / 2;
    }
    box(
      [0.005, h * 0.8, d * 0.78],
      "#424d50",
      [w * 0.502, h * 0.53, 0],
      "metal",
    );
    for (let i = 0; i < 6; i++)
      box([w * 0.65, h * 0.025, 0.002], "#1d2529", [
        0,
        h * (0.2 + i * 0.08),
        -d * 0.501,
      ]);
  } else if (kind === "privacy-screen") {
    const panels = Math.max(1, Math.round(w / 0.4)),
      panelW = w / panels;
    for (let i = 0; i < panels; i++) {
      const x = -w / 2 + panelW * (i + 0.5),
        z = i % 2 ? d * 0.12 : -d * 0.12;
      box(
        [panelW - 0.014, h * 0.93, 0.024],
        color,
        [x, h * 0.53, z],
        "veil",
        0.004,
      );
      for (const xx of [x - panelW / 2 + 0.008, x + panelW / 2 - 0.008])
        box([0.014, h, 0.035], "#717b74", [xx, h / 2, z], "metal");
      for (const y of [h * 0.07, h * 0.99])
        box([panelW, 0.014, 0.035], "#717b74", [x, y, z], "metal");
      box(
        [Math.min(0.12, panelW * 0.8), 0.015, d],
        dark,
        [x, 0.0075, 0],
        "metal",
      );
    }
  } else if (kind === "air-conditioner") {
    box([w, h, d], color, [0, h / 2, 0], "paint", 0.035);
    box(
      [w * 0.91, h * 0.12, 0.008],
      dark,
      [0, h * 0.16, d * 0.49],
      "paint",
      0.005,
    );
    for (let i = 0; i < 3; i++)
      box([w * 0.88, 0.004, 0.02], silver, [
        0,
        h * (0.11 + i * 0.035),
        d * 0.49,
      ]);
    box([w * 0.91, 0.004, 0.003], "#c8cfca", [0, h * 0.65, d * 0.501]);
    box([w * 0.09, h * 0.07, 0.002], "#7e8c8d", [w * 0.35, h * 0.4, d * 0.501]);
  } else if (kind === "homepod-mini") {
    const body = paint.sphere(
      [w / 2, h * 0.49, d / 2],
      color,
      [0, h * 0.49, 0],
      "fabric",
    );
    group.add(body);
    cylinder(w * 0.32, h * 0.02, "#b5bdbb", [0, h * 0.95, 0]);
    cylinder(w * 0.29, h * 0.04, dark, [0, h * 0.02, 0]);
    for (const x of [-w * 0.12, w * 0.12])
      box([0.008, 0.0007, 0.001], "#dde1db", [x, h * 0.963, 0]);
    box([0.001, 0.0007, 0.008], "#dde1db", [w * 0.12, h * 0.963, 0]);
  } else if (kind === "smart-speaker") {
    box([w, h, d], color, [0, h / 2, 0], "fabric", 0.015);
    box(
      [w * 0.85, h * 0.08, d * 0.83],
      "#d4d9d5",
      [0, h * 0.94, 0],
      "paint",
      0.006,
    );
    for (const x of [-w * 0.22, 0, w * 0.22])
      cylinder(w * 0.025, 0.001, "#8b9999", [x, h * 0.99, 0]);
  } else if (kind === "smart-strip") {
    box([w, h, d], color, [0, h / 2, 0], "paint", 0.008);
    for (let i = 0; i < 3; i++) {
      const x = -w * 0.3 + i * w * 0.3;
      box(
        [w * 0.25, 0.001, d * 0.83],
        "#d9dfd8",
        [x, h * 1.001, 0],
        "paint",
        0.004,
      );
      socket(x, h + 0.002, 0, d * 0.65, true);
    }
    box(
      [w * 0.08, 0.003, d * 0.3],
      "#b1bbb7",
      [w * 0.43, h + 0.001, 0],
      "paint",
      0.004,
    );
  } else if (kind === "smart-switch" || kind === "plug") {
    box([w, h, d], color, [0, h / 2, 0], "paint", 0.006);
    if (kind === "plug") {
      box(
        [w * 0.82, h * 0.8, 0.004],
        "#e8ece5",
        [0, h * 0.48, d * 0.5],
        "paint",
        0.005,
      );
      socket(0, h * 0.47, d * 0.55, w * 0.8);
    } else {
      box(
        [w * 0.8, h * 0.82, 0.004],
        "#e4e9e3",
        [0, h * 0.51, d * 0.5],
        "paint",
        0.004,
      );
      box([w * 0.17, 0.002, 0.001], "#899d9c", [0, h * 0.14, d * 0.63]);
    }
  } else if (kind === "ceiling-light") {
    cylinder(w * 0.5, h * 0.32, silver, [0, h * 0.84, 0]);
    cylinder(w * 0.48, h * 0.68, color, [0, h * 0.34, 0]);
  }
  const bounds = new THREE.Box3().setFromObject(group),
    size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  group.position.set(-centre.x, -bounds.min.y, -centre.z);
  const fitted = new THREE.Group();
  fitted.add(group);
  fitted.scale.set(w / size.x, h / size.y, d / size.z);
  return paint.batch(fitted);
}
