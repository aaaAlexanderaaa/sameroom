import * as THREE from "three";
import type { GuestAsset } from "../shared/guest.js";
import type { SceneDesign } from "./scene-design.js";

type Point = [number, number, number];
type Surface = Parameters<SceneDesign["material"]>[1];
const detailedKinds = new Set([
  "wardrobe",
  "cabinet",
  "chair",
  "fridge",
  "screen",
  "gaming-chair",
  "metal-shelf",
  "drawer-cabinet",
  "bedside-cabinet",
  "display-cabinet",
  "glass-cabinet",
  "mini-fridge",
  "kitchen-counter",
  "keyboard",
  "mouse",
  "microphone",
  "mug",
  "headphones",
  "fan",
  "beanbag",
  "bench",
  "sliding-door",
  "litter-tray",
  "pegboard",
  "round-storage-table",
  "armchair",
  "wall-display",
  "window-marker",
  "door-marker",
  "wall-return",
]);

/** Reusable authored shapes; household placement and identity remain in domain records. */
export function detailedFurniture(asset: GuestAsset, paint: SceneDesign) {
  if (!detailedKinds.has(asset.kind)) return;
  const { width: w, height: h, depth: d, kind, color } = asset;
  const g = new THREE.Group();
  const dark = "#282e30",
    metal = "#515c5e",
    cream = "#e8e4d8";
  const tint = (amount: number) =>
    new THREE.Color(color)
      .lerp(
        new THREE.Color(amount > 0 ? "#ffffff" : "#202627"),
        Math.abs(amount),
      )
      .getStyle();
  const mesh = (
    geometry: THREE.BufferGeometry,
    c: string,
    p: Point,
    surface: Surface = "paint",
  ) => {
    const item = new THREE.Mesh(geometry, paint.material(c, surface));
    item.position.set(...p);
    item.castShadow = item.receiveShadow =
      surface !== "glass" && surface !== "screen";
    g.add(item);
    return item;
  };
  const box = (
    size: Point,
    c: string,
    p: Point,
    surface: Surface = "paint",
    radius = 0,
  ) => {
    if (!radius) return mesh(new THREE.BoxGeometry(...size), c, p, surface);
    const item = paint.box(size, c, p, radius, surface);
    g.add(item);
    return item;
  };
  const rod = (a: Point, b: Point, r = 0.012, c = metal) => {
    const item = paint.rod(a, b, r, c);
    g.add(item);
    return item;
  };
  const cylinder = (
    r: number,
    height: number,
    c: string,
    p: Point,
    surface: Surface = "paint",
  ) => mesh(new THREE.CylinderGeometry(r, r, height, 16), c, p, surface);
  const sphere = (
    size: Point,
    c: string,
    p: Point,
    surface: "paint" | "fabric" = "paint",
  ) => {
    const item = paint.sphere(size, c, p, surface);
    g.add(item);
    return item;
  };
  const ring = (
    radius: number,
    tube: number,
    c: string,
    p: Point,
    arc = Math.PI * 2,
  ) => mesh(new THREE.TorusGeometry(radius, tube, 5, 32, arc), c, p, "metal");
  const handle = (
    x: number,
    y: number,
    z: number,
    length: number,
    vertical = false,
  ) => {
    const a: Point = vertical ? [x, y - length / 2, z] : [x - length / 2, y, z];
    const b: Point = vertical ? [x, y + length / 2, z] : [x + length / 2, y, z];
    rod(a, b, 0.008, metal);
    for (const p of [a, b]) rod([p[0], p[1], z - 0.018], p, 0.006, metal);
  };
  const drawers = (count: number) => {
    box(
      [w * 0.96, h * 0.91, d * 0.94],
      tint(-0.12),
      [0, h * 0.48, -d * 0.02],
      "wood",
    );
    box([w, h * 0.045, d], tint(0.1), [0, h * 0.976, 0], "wood", 0.009);
    for (let i = 0; i < count; i++) {
      const y = h * (0.08 + ((i + 0.5) * 0.85) / count),
        dh = (h * 0.85) / count - 0.014;
      box([w * 0.91, dh, 0.022], color, [0, y, d * 0.47], "paint", 0.005);
      box([w * 0.79, dh * 0.65, 0.008], tint(0.05), [0, y, d * 0.486]);
      handle(0, y, d * 0.52, Math.min(w * 0.25, 0.18));
    }
    for (const x of [-w * 0.4, w * 0.4])
      for (const z of [-d * 0.36, d * 0.36])
        box([0.035, h * 0.055, 0.035], metal, [x, h * 0.0275, z]);
  };
  const bottle = (
    x: number,
    y: number,
    z: number,
    height: number,
    c: string,
  ) => {
    const r = Math.min(height * 0.16, 0.035);
    cylinder(r, height * 0.74, c, [x, y + height * 0.37, z]);
    cylinder(r * 0.52, height * 0.2, c, [x, y + height * 0.84, z]);
    cylinder(r * 0.6, height * 0.08, cream, [x, y + height * 0.96, z]);
  };
  const books = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
  ) => {
    for (let i = 0; i < 4; i++) {
      const bw = (width / 4) * 0.84,
        bh = height * (0.8 + (i % 3) * 0.1),
        px = x - width / 2 + ((i + 0.5) * width) / 4;
      box(
        [bw, bh, d * 0.32],
        ["#667e8a", "#d6cbb6", "#8a967e", "#937258"][i],
        [px, y + bh / 2, z],
        "paint",
      );
      box([bw * 0.6, 0.008, 0.004], cream, [px, y + bh * 0.7, z + d * 0.163]);
    }
  };

  if (kind === "round-storage-table") {
    cylinder(w * 0.5, h * 0.045, color, [0, h * 0.9775, 0], "wood");
    for (const y of [h * 0.04, h * 0.48, h * 0.91])
      ring(w * (0.35 + (y / h) * 0.12), 0.006, cream, [0, y, 0]).rotation.x =
        Math.PI / 2;
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16;
      rod(
        [Math.cos(a) * w * 0.355, h * 0.03, Math.sin(a) * d * 0.355],
        [Math.cos(a) * w * 0.47, h * 0.94, Math.sin(a) * d * 0.47],
        0.0035,
        cream,
      );
    }
    cylinder(w * 0.35, 0.012, cream, [0, 0.012, 0], "metal");
  } else if (kind === "armchair") {
    for (const x of [-w * 0.35, w * 0.35])
      for (const z of [-d * 0.34, d * 0.34])
        box([0.045, h * 0.12, 0.045], dark, [x, h * 0.06, z], "wood");
    box(
      [w * 0.95, h * 0.24, d * 0.91],
      tint(-0.08),
      [0, h * 0.24, 0],
      "fabric",
      0.04,
    );
    box(
      [w * 0.73, h * 0.15, d * 0.75],
      color,
      [0, h * 0.43, d * 0.06],
      "fabric",
      0.045,
    );
    box(
      [w * 0.9, h * 0.57, d * 0.22],
      color,
      [0, h * 0.715, -d * 0.39],
      "fabric",
      0.055,
    );
    box(
      [w * 0.67, h * 0.43, d * 0.16],
      tint(0.07),
      [0, h * 0.71, -d * 0.24],
      "fabric",
      0.045,
    );
    for (const x of [-w * 0.425, w * 0.425])
      box(
        [w * 0.15, h * 0.5, d * 0.91],
        color,
        [x, h * 0.47, 0],
        "fabric",
        0.035,
      );
  } else if (kind === "pegboard") {
    box([w, h, d * 0.8], color, [0, h / 2, 0], "metal", 0.008);
    const cols = Math.max(2, Math.floor(w / 0.045)),
      rows = Math.max(2, Math.floor(h / 0.045));
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const hole = cylinder(0.004, d, dark, [
          w * ((i + 0.5) / cols - 0.5),
          (h * (j + 0.5)) / rows,
          0,
        ]);
        hole.rotation.x = Math.PI / 2;
      }
  } else if (kind === "wall-display") {
    box([w, h, d * 0.6], dark, [0, h / 2, d * 0.2], "paint", 0.009);
    const display = box(
      [w * 0.97, h * 0.95, 0.003],
      "#ffffff",
      [0, h / 2, d * 0.501],
      "screen",
    );
    display.castShadow = false;
    box([w * 0.35, h * 0.35, d * 0.4], metal, [0, h / 2, -d * 0.3], "metal");
  } else if (kind === "wall-return") {
    box([w, h, d], color, [0, h / 2, 0], "veil");
    for (const x of [-w / 2, w / 2])
      for (const z of [-d / 2, d / 2]) rod([x, 0, z], [x, h, z], 0.004, metal);
  } else if (kind === "window-marker" || kind === "door-marker") {
    const t = Math.min(w * 0.03, 0.025),
      window = kind === "window-marker";
    for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
      box([t, h, d], color, [x, h / 2, 0], "metal");
    for (const y of window ? [t / 2, h - t / 2] : [h - t / 2])
      box([w, t, d], color, [0, y, 0], "metal");
    if (window) {
      box([w - t * 2, h - t * 2, d * 0.1], "#c3d9d7", [0, h / 2, 0], "glass");
      for (let i = 1; i < Math.ceil(w / 0.8); i++)
        box(
          [t * 0.6, h, d],
          color,
          [-w / 2 + (i * w) / Math.ceil(w / 0.8), h / 2, 0],
          "metal",
        );
    }
  } else if (kind === "wardrobe") {
    box(
      [w * 0.97, h * 0.96, d * 0.94],
      tint(-0.1),
      [0, h * 0.48, -d * 0.015],
      "wood",
    );
    box([w, h * 0.035, d], tint(0.13), [0, h * 0.982, 0], "wood", 0.006);
    box([w * 0.99, h * 0.045, d * 0.98], tint(0.04), [0, h * 0.025, 0], "wood");
    // Nominal 40 cm leaves: the owner's 2 m wardrobe has five doors.
    const doors = Math.max(2, Math.round(w / 0.4));
    for (let i = 0; i < doors; i++) {
      const dw = (w * 0.965) / doors,
        x = -w * 0.4825 + dw * (i + 0.5);
      box(
        [dw - 0.01, h * 0.89, 0.025],
        color,
        [x, h * 0.49, d * 0.475],
        "wood",
        0.004,
      );
      // Raised rails around a recessed panel read clearly in both close and overview views.
      box(
        [dw * 0.75, h * 0.78, 0.008],
        tint(-0.045),
        [x, h * 0.5, d * 0.49],
        "wood",
      );
      for (const xx of [x - dw * 0.39, x + dw * 0.39])
        box([0.015, h * 0.81, 0.012], tint(0.12), [xx, h * 0.5, d * 0.503]);
      for (const y of [h * 0.095, h * 0.905])
        box([dw * 0.8, 0.018, 0.012], tint(0.12), [x, y, d * 0.503]);
      handle(
        x + dw * (i % 2 ? -0.31 : 0.31),
        h * 0.47,
        d * 0.53,
        Math.min(0.19, h * 0.1),
        true,
      );
    }
  } else if (kind === "drawer-cabinet" || kind === "bedside-cabinet") {
    drawers(kind === "bedside-cabinet" ? 2 : h > 0.85 ? 4 : 3);
  } else if (kind === "cabinet") {
    box([w, h * 0.86, d * 0.92], tint(-0.1), [0, h * 0.49, -d * 0.03], "wood");
    box([w, h * 0.045, d], tint(0.1), [0, h * 0.956, 0], "wood", 0.006);
    const doors = Math.max(2, Math.round(w / 0.48));
    for (let i = 0; i < doors; i++) {
      const dw = w / doors,
        x = -w / 2 + (i + 0.5) * dw;
      box(
        [dw - 0.014, h * 0.75, 0.025],
        color,
        [x, h * 0.49, d * 0.45],
        "wood",
        0.004,
      );
      box([dw * 0.8, h * 0.53, 0.009], tint(0.055), [x, h * 0.48, d * 0.468]);
      handle(x, h * 0.7, d * 0.5, Math.min(dw * 0.27, 0.14));
    }
    for (const x of [-w * 0.42, w * 0.42])
      for (const z of [-d * 0.35, d * 0.35])
        box([0.04, h * 0.08, 0.04], metal, [x, h * 0.04, z]);
  } else if (kind === "metal-shelf") {
    for (const x of [-w * 0.46, w * 0.46])
      for (const z of [-d * 0.44, d * 0.44]) {
        box([0.018, h, 0.018], color, [x, h / 2, z], "metal");
        box([0.028, 0.035, 0.028], dark, [x, 0.0175, z]);
      }
    for (let i = 0; i < 5; i++)
      box(
        [w, 0.022, d],
        tint(0.08),
        [0, 0.04 + (i * (h - 0.08)) / 4, 0],
        "metal",
      );
    rod(
      [-w * 0.46, 0.12, -d * 0.44],
      [w * 0.46, h - 0.05, -d * 0.44],
      0.0045,
      metal,
    );
    rod(
      [w * 0.46, 0.12, -d * 0.44],
      [-w * 0.46, h - 0.05, -d * 0.44],
      0.0045,
      metal,
    );
    for (let i = 0; i < 3; i++) {
      const y = 0.06 + (i * (h - 0.08)) / 4;
      box(
        [w * 0.6, h * 0.12, d * 0.6],
        ["#414b53", "#a9ac9d", "#d2c8b7"][i],
        [0, y + h * 0.06, 0],
        "paint",
        0.008,
      );
      box([w * 0.17, 0.018, 0.008], metal, [0, y + h * 0.09, d * 0.304]);
    }
  } else if (kind === "display-cabinet" || kind === "glass-cabinet") {
    const glass = kind === "glass-cabinet",
      t = Math.min(w * 0.05, 0.025),
      base = glass ? h * 0.05 : h * 0.4,
      rows = glass ? 4 : 3,
      columns = glass ? [1] : [0.25, 0.5, 0.25];
    box([w, h, 0.025], tint(-0.08), [0, h / 2, -d / 2 + 0.0125], "wood");
    for (const x of [-w / 2 + t / 2, w / 2 - t / 2])
      box([t, h, d], color, [x, h / 2, 0], "wood");
    for (const y of [t / 2, h - t / 2])
      box([w, t, d], color, [0, y, 0], "wood");
    if (!glass) {
      box([w, base, d * 0.94], color, [0, base / 2, 0], "wood");
      for (let i = 0; i < 3; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / 3;
        box(
          [w / 3 - 0.015, base * 0.88, 0.023],
          tint(0.04),
          [x, base * 0.5, d / 2],
          "paint",
          0.004,
        );
        handle(x, base * 0.8, d / 2 + 0.025, Math.min(0.12, w * 0.08));
      }
      for (const x of [-w / 4, w / 4])
        box([t, h - base, d * 0.94], color, [x, (h + base) / 2, 0]);
    }
    for (let row = 0; row < rows; row++) {
      const y = base + (row * (h - base)) / rows;
      box(
        [w - t * 2, 0.018, d * 0.92],
        color,
        [0, y, 0],
        glass ? "glass" : "paint",
      );
      let left = -w / 2;
      for (let col = 0; col < columns.length; col++) {
        const cellW = w * columns[col],
          x = left + cellW / 2,
          ph = Math.min(((h - base) / rows) * 0.65, 0.25);
        left += cellW;
        if ((row + col) % 2 === 0) books(x, y + 0.015, 0, cellW * 0.65, ph);
        else
          for (const dx of [-0.17, 0.17])
            bottle(
              x + cellW * dx,
              y + 0.02,
              0,
              ph,
              dx < 0 ? "#a8b9aa" : "#c4b7a0",
            );
      }
    }
    if (glass) {
      box(
        [w * 0.83, h * 0.91, 0.008],
        "#cad8d3",
        [0, h / 2, d / 2 + 0.004],
        "glass",
      );
      for (const x of [-w * 0.46, w * 0.46])
        box([0.018, h * 0.93, 0.025], color, [x, h / 2, d / 2 + 0.016], "wood");
      handle(w * 0.33, h * 0.48, d / 2 + 0.04, 0.12, true);
    }
  } else if (kind === "chair" || kind === "gaming-chair") {
    const gaming = kind === "gaming-chair",
      seat = h * (gaming ? 0.37 : 0.47);
    if (gaming) {
      cylinder(w * 0.045, seat * 0.72, metal, [0, seat * 0.42, 0], "metal");
      for (let i = 0; i < 5; i++) {
        const angle = (i * Math.PI * 2) / 5,
          x = Math.cos(angle) * w * 0.43,
          z = Math.sin(angle) * d * 0.42;
        rod([0, seat * 0.16, 0], [x, seat * 0.08, z], 0.022, dark);
        const wheel = cylinder(0.04, 0.035, dark, [x, 0.045, z]);
        wheel.rotation.z = Math.PI / 2;
      }
    } else
      for (const x of [-w * 0.38, w * 0.38])
        for (const z of [-d * 0.34, d * 0.34])
          rod([x, 0, z], [x, seat, z], 0.017, dark);
    box([w * 0.8, h * 0.075, d * 0.77], color, [0, seat, 0], "fabric", 0.04);
    const back = box(
      [w * (gaming ? 0.75 : 0.78), h * (gaming ? 0.57 : 0.45), d * 0.13],
      color,
      [0, h * (gaming ? 0.7 : 0.74), -d * 0.34],
      "fabric",
      0.045,
    );
    back.rotation.x = -0.08;
    if (gaming) {
      for (const x of [-w * 0.36, w * 0.36]) {
        const wing = box(
          [w * 0.15, h * 0.32, d * 0.2],
          tint(-0.1),
          [x, h * 0.71, -d * 0.27],
          "fabric",
          0.03,
        );
        wing.rotation.z = x > 0 ? 0.12 : -0.12;
        box(
          [w * 0.13, h * 0.04, d * 0.55],
          dark,
          [x, h * 0.53, d * 0.02],
          "paint",
          0.012,
        );
        rod([x, seat, -d * 0.07], [x, h * 0.53, -d * 0.07], 0.014, dark);
      }
      box(
        [w * 0.49, h * 0.12, d * 0.16],
        tint(0.09),
        [0, h * 0.9, -d * 0.24],
        "fabric",
        0.025,
      );
      box(
        [w * 0.52, h * 0.11, d * 0.16],
        tint(0.05),
        [0, h * 0.53, -d * 0.22],
        "fabric",
        0.022,
      );
      for (const x of [-w * 0.14, w * 0.14])
        box(
          [w * 0.1, h * 0.035, 0.015],
          dark,
          [x, h * 0.81, -d * 0.258],
          "paint",
          0.008,
        );
      for (const x of [-w * 0.255, w * 0.255])
        rod(
          [x, h * 0.6, -d * 0.252],
          [x, h * 0.79, -d * 0.275],
          0.003,
          "#78827b",
        );
    }
  } else if (kind === "mini-fridge" || kind === "fridge") {
    const mini = kind === "mini-fridge";
    box([w, h, d * 0.92], color, [0, h / 2, -d * 0.025], "metal", 0.015);
    const parts = mini
      ? [[h * 0.51, h * 0.9]]
      : [
          [h * 0.27, h * 0.45],
          [h * 0.75, h * 0.47],
        ];
    for (const [y, dh] of parts) {
      box([w * 0.94, dh, 0.035], tint(0.06), [0, y, d * 0.45], "paint", 0.008);
      handle(w * 0.34, y + dh * 0.17, d * 0.5, Math.min(dh * 0.45, 0.22), true);
    }
    box([w * 0.25, 0.018, 0.004], metal, [-w * 0.22, h * 0.9, d * 0.472]);
    for (let i = 0; i < 6; i++)
      box([w * 0.085, 0.012, 0.004], dark, [
        -w * 0.31 + i * w * 0.125,
        h * 0.045,
        d * 0.47,
      ]);
  } else if (kind === "screen" && asset.stand === "arm") {
    box([w, h, d * 0.8], dark, [0, h / 2, 0], "paint", 0.008);
    box(
      [w * 0.965, h * 0.94, 0.002],
      "#ffffff",
      [0, h / 2, d * 0.41],
      "screen",
    );
    box(
      [Math.min(w * 0.18, 0.09), Math.min(h * 0.25, 0.09), d * 0.2],
      metal,
      [0, h / 2, -d * 0.45],
      "metal",
    );
    for (let i = 0; i < 8; i++)
      box([w * 0.07, 0.004, 0.002], metal, [
        -w * 0.3 + i * w * 0.086,
        h * 0.8,
        -d * 0.405,
      ]);
  } else if (kind === "screen") {
    box([w, h * 0.8, d * 0.26], dark, [0, h * 0.6, -d * 0.08], "paint", 0.009);
    const display = box(
      [w * 0.955, h * 0.74, 0.003],
      "#ffffff",
      [0, h * 0.6, d * 0.053],
      "screen",
    );
    display.castShadow = false;
    box([w * 0.28, h * 0.025, d], metal, [0, h * 0.018, 0], "metal", 0.006);
    rod(
      [0, h * 0.03, 0],
      [0, h * 0.34, -d * 0.1],
      Math.min(w * 0.022, 0.022),
      metal,
    );
    box(
      [w * 0.18, h * 0.18, d * 0.08],
      metal,
      [0, h * 0.49, -d * 0.23],
      "paint",
      0.006,
    );
    for (let i = 0; i < 6; i++)
      box([w * 0.12, 0.007, 0.004], metal, [
        -w * 0.3 + i * w * 0.12,
        h * 0.74,
        -d * 0.215,
      ]);
    sphere([0.004, 0.004, 0.002], "#b5c9b5", [w * 0.44, h * 0.22, d * 0.06]);
  } else if (kind === "kitchen-counter") {
    const run = Math.min(0.6, d / 2, w / 2),
      y = h * 0.94;
    // One L-shaped cabinet. The rear run keeps the sink; the east return holds the hob.
    box([w, h * 0.9, run], color, [0, h * 0.46, -d / 2 + run / 2], "wood");
    box(
      [run, h * 0.9, d - run],
      color,
      [w / 2 - run / 2, h * 0.46, run / 2],
      "wood",
    );
    box([w, h * 0.05, run], cream, [0, y, -d / 2 + run / 2], "paint", 0.006);
    box(
      [run, h * 0.05, d - run],
      cream,
      [w / 2 - run / 2, y, run / 2],
      "paint",
      0.006,
    );
    const sx = -w * 0.12,
      sz = -d / 2 + run * 0.52;
    box(
      [w * 0.37, 0.012, run * 0.65],
      "#9eaeae",
      [sx, y + 0.03, sz],
      "metal",
      0.012,
    );
    box(
      [w * 0.31, 0.014, run * 0.53],
      "#61777a",
      [sx, y + 0.031, sz],
      "metal",
      0.014,
    );
    rod(
      [sx, y, sz - run * 0.35],
      [sx, y + 0.19, sz - run * 0.35],
      0.012,
      metal,
    );
    rod([sx, y + 0.19, sz - run * 0.35], [sx, y + 0.19, sz], 0.012, metal);
    const hx = w / 2 - run / 2,
      hz = run / 2,
      hobLength = Math.min(0.6, (d - run) * 0.85);
    box(
      [run * 0.82, 0.018, hobLength],
      dark,
      [hx, y + 0.035, hz],
      "paint",
      0.012,
    );
    for (const z of [hz - hobLength * 0.27, hz + hobLength * 0.27]) {
      const burner = cylinder(
        run * 0.14,
        0.018,
        "#525b5d",
        [hx, y + 0.055, z],
        "metal",
      );
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        rod(
          [
            hx + Math.cos(a) * run * 0.07,
            y + 0.075,
            z + Math.sin(a) * run * 0.07,
          ],
          [
            hx + Math.cos(a) * run * 0.2,
            y + 0.075,
            z + Math.sin(a) * run * 0.2,
          ],
          0.006,
          metal,
        );
      }
      burner.receiveShadow = true;
    }
    for (const z of [hz - 0.08, hz + 0.08])
      cylinder(0.022, 0.024, metal, [hx - run * 0.32, y + 0.06, z], "metal");
    for (let i = 0; i < 3; i++) {
      const x = -w / 2 + (w * (i + 0.5)) / 3;
      box([w / 3 - 0.012, h * 0.78, 0.02], tint(0.06), [
        x,
        h * 0.47,
        -d / 2 + run + 0.01,
      ]);
      handle(x, h * 0.75, -d / 2 + run + 0.04, 0.11);
    }
  } else if (kind === "keyboard") {
    box([w, h * 0.45, d], color, [0, h * 0.225, 0], "paint", 0.005);
    for (let row = 0; row < 5; row++)
      for (let col = 0; col < 14; col++) {
        if (row === 4 && col > 3 && col < 10) continue;
        box(
          [w * 0.061, h * 0.4, d * 0.15],
          row === 0 ? "#89918b" : "#c3c7bd",
          [-w * 0.455 + col * w * 0.07, h * 0.62, -d * 0.39 + row * d * 0.19],
          "paint",
          0.001,
        );
      }
    box(
      [w * 0.42, h * 0.4, d * 0.15],
      "#c3c7bd",
      [0, h * 0.62, d * 0.37],
      "paint",
      0.002,
    );
  } else if (kind === "mouse") {
    box([w, 0.004, d], color, [0, 0.002, 0], "fabric", 0.012);
    sphere([w * 0.17, h * 0.48, d * 0.23], dark, [0, h * 0.49, 0]);
    box([0.002, h * 0.12, d * 0.19], "#78817e", [0, h * 0.93, -d * 0.08]);
    box(
      [w * 0.025, h * 0.13, d * 0.05],
      "#959e92",
      [0, h * 0.95, -d * 0.03],
      "paint",
      0.002,
    );
  } else if (kind === "microphone") {
    box([w * 0.13, 0.035, d * 0.2], dark, [-w * 0.4, 0.02, -d * 0.35]);
    const a: Point = [-w * 0.4, 0.03, -d * 0.35],
      b: Point = [-w * 0.39, h * 0.73, -d * 0.25],
      c: Point = [w * 0.3, h * 0.9, d * 0.23];
    rod(a, b, 0.009, dark);
    rod(b, c, 0.01, dark);
    rod([a[0] + 0.025, a[1], a[2]], [b[0] + 0.025, b[1], b[2]], 0.004, metal);
    const mic = cylinder(w * 0.055, h * 0.22, dark, [
      w * 0.31,
      h * 0.77,
      d * 0.25,
    ]);
    mic.rotation.z = -0.23;
    ring(w * 0.085, 0.004, metal, [w * 0.31, h * 0.74, d * 0.25]).rotation.x =
      Math.PI / 2;
    for (let i = 0; i < 5; i++)
      ring(w * 0.055, 0.0015, "#778486", [
        w * 0.31,
        h * (0.72 + i * 0.025),
        d * 0.25,
      ]).rotation.x = Math.PI / 2;
  } else if (kind === "mug") {
    cylinder(w * 0.35, h * 0.9, color, [-w * 0.08, h * 0.45, 0]);
    ring(w * 0.35, 0.003, cream, [-w * 0.08, h * 0.91, 0]).rotation.x =
      Math.PI / 2;
    cylinder(w * 0.3, 0.002, "#6a5140", [-w * 0.08, h * 0.903, 0]);
    ring(w * 0.2, w * 0.035, color, [w * 0.31, h * 0.48, 0]);
  } else if (kind === "headphones") {
    box([w * 0.65, 0.015, d], color, [0, 0.008, 0], "paint", 0.007);
    rod([0, 0.02, 0], [0, h * 0.88, 0], 0.009, metal);
    ring(w * 0.39, 0.013, dark, [0, h * 0.62, 0], Math.PI);
    for (const x of [-w * 0.39, w * 0.39])
      box(
        [w * 0.18, h * 0.29, d * 0.6],
        dark,
        [x, h * 0.51, 0],
        "fabric",
        0.015,
      );
  } else if (kind === "fan") {
    cylinder(w * 0.42, 0.035, color, [0, 0.018, 0]);
    rod([0, 0.03, 0], [0, h * 0.77, 0], 0.018, metal);
    const cy = h - w * 0.49;
    const motor = cylinder(w * 0.13, d * 0.35, dark, [0, cy, -d * 0.16]);
    motor.rotation.x = Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      const blade = sphere([w * 0.14, w * 0.25, 0.018], tint(0.2), [
        Math.sin(a) * w * 0.14,
        cy + Math.cos(a) * w * 0.14,
        0,
      ]);
      blade.rotation.z = -a + 0.3;
    }
    for (const r of [w * 0.18, w * 0.32, w * 0.47])
      ring(r, 0.0025, metal, [0, cy, d * 0.12]);
    for (let i = 0; i < 20; i++) {
      const a = (i * Math.PI) / 10;
      rod(
        [Math.sin(a) * w * 0.08, cy + Math.cos(a) * w * 0.08, d * 0.15],
        [Math.sin(a) * w * 0.47, cy + Math.cos(a) * w * 0.47, d * 0.1],
        0.0018,
        metal,
      );
    }
    sphere([w * 0.08, w * 0.08, 0.025], color, [0, cy, d * 0.16]);
  } else if (kind === "beanbag") {
    sphere([w * 0.5, h * 0.35, d * 0.49], color, [0, h * 0.35, 0], "fabric");
    const back = sphere(
      [w * 0.42, h * 0.38, d * 0.28],
      tint(0.1),
      [0, h * 0.63, -d * 0.2],
      "fabric",
    );
    back.rotation.x = -0.18;
    sphere(
      [w * 0.34, h * 0.1, d * 0.3],
      tint(-0.06),
      [0, h * 0.49, d * 0.16],
      "fabric",
    );
    for (let i = 0; i < 12; i++) {
      const a = i * 2.4;
      const x = Math.sin(a) * w * 0.3,
        z = Math.cos(a) * d * 0.25;
      sphere(
        [w * 0.045, 0.003, d * 0.06],
        ["#a48e66", "#78897f", "#b2917f"][i % 3],
        [x, h * 0.61 - Math.abs(x) * 0.22, z],
        "fabric",
      );
    }
  } else if (kind === "bench") {
    box([w, h * 0.14, d], color, [0, h * 0.92, 0], "fabric", 0.015);
    for (const x of [-w * 0.42, w * 0.42])
      for (const z of [-d * 0.36, d * 0.36])
        rod([x, 0, z], [x, h * 0.85, z], 0.018, dark);
  } else if (kind === "sliding-door") {
    for (const y of [0.02, h - 0.02])
      box([w, 0.035, d], color, [0, y, 0], "metal");
    // Overlapped panes leave an open passage, with translucent glass and slim frames.
    for (const offset of [0, w * 0.24]) {
      const pw = w * 0.52,
        x = w * 0.15 - offset,
        z = offset ? d * 0.2 : -d * 0.2;
      box([pw, h - 0.08, 0.006], "#d4dfd8", [x, h / 2, z], "glass");
      for (const xx of [x - pw / 2, x + pw / 2])
        box([0.018, h - 0.04, 0.018], color, [xx, h / 2, z], "metal");
      for (const yy of [0.04, h * 0.32, h * 0.68, h - 0.04])
        box([pw, 0.018, 0.018], color, [x, yy, z], "metal");
    }
    handle(w * 0.4, h * 0.46, d * 0.38, 0.16, true);
  } else if (kind === "litter-tray") {
    box([w, 0.03, d], color, [0, 0.015, 0], "paint", 0.015);
    for (const x of [-w / 2 + 0.012, w / 2 - 0.012])
      box([0.024, h, d], color, [x, h / 2, 0], "paint", 0.01);
    for (const z of [-d / 2 + 0.012, d / 2 - 0.012])
      box([w, h, 0.024], color, [0, h / 2, z], "paint", 0.01);
    box([w - 0.05, 0.016, d - 0.05], "#b8b09a", [0, 0.043, 0], "fabric", 0.008);
  }
  // Existing chair placements use local -Z as the sitting direction.
  if (kind === "chair" || kind === "gaming-chair" || kind === "armchair")
    g.rotation.y = Math.PI;
  // Cabinet trim, arms and handles remain inside the recorded editable bounds.
  const bounds = new THREE.Box3().setFromObject(g),
    size = bounds.getSize(new THREE.Vector3()),
    center = bounds.getCenter(new THREE.Vector3());
  g.position.set(-center.x, -bounds.min.y, -center.z);
  const fitted = new THREE.Group();
  fitted.add(g);
  fitted.scale.set(w / size.x, h / size.y, d / size.z);
  return paint.batch(fitted);
}
