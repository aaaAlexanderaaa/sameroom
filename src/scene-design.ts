import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { detailedFurniture } from "./furniture-details.js";
import { detailedWorkstation } from "./workstation-details.js";
import { detailedDevice } from "./device-details.js";
import { furnitureKinds } from "../shared/domain.js";
import type { GuestAsset, GuestRoomLike } from "../shared/guest.js";

export type SceneStyle = "natural" | "soft";
type Point = [number, number, number];

/** Authored schematic scenery. Materials belong to this palette; geometry to its meshes. */
export class SceneDesign {
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private textures: THREE.Texture[] = [];
  private wood: THREE.CanvasTexture;
  private weave: THREE.CanvasTexture;
  private display?: THREE.CanvasTexture;
  readonly colors;

  constructor(readonly style: SceneStyle) {
    this.colors =
      style === "natural"
        ? {
            wall: "#e6e0d2",
            oak: "#a88b68",
            dark: "#514437",
            textile: "#a7afa0",
            paper: "#eee9dc",
            accent: "#a65f43",
            metal: "#3d4948",
          }
        : {
            wall: "#e9dccc",
            oak: "#bf9b74",
            dark: "#65786c",
            textile: "#8fa8a0",
            paper: "#f6e7ce",
            accent: "#d88c65",
            metal: "#586f73",
          };
    this.wood = this.texture("wood");
    this.weave = this.texture("weave");
  }

  private texture(kind: "wood" | "weave") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const c = canvas.getContext("2d")!;
    const n = canvas.width;
    let seed = 431;
    const random = () =>
      ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    c.fillStyle = kind === "weave" ? "#d6d2c8" : "#e3d8c4";
    c.fillRect(0, 0, n, n);
    if (kind === "weave") {
      for (let y = 0; y < n; y += 3) {
        c.strokeStyle = y % 2 ? "#ffffff36" : "#544c3c30";
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(n, y);
        c.stroke();
      }
      for (let x = 0; x < n; x += 3) {
        c.strokeStyle = "#70624d28";
        c.beginPath();
        c.moveTo(x, 0);
        c.lineTo(x, n);
        c.stroke();
      }
    } else {
      for (let i = 0; i < n * 2; i++) {
        const y = random() * n;
        c.strokeStyle = `rgba(74,57,40,${0.012 + random() * 0.035})`;
        c.lineWidth = 0.4 + random() * 1.2;
        c.beginPath();
        c.moveTo(0, y);
        c.bezierCurveTo(
          n * 0.35,
          y - random() * 9,
          n * 0.65,
          y + random() * 9,
          n,
          y,
        );
        c.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    this.textures.push(texture);
    return texture;
  }

  material(
    color: string,
    surface:
      | "paint"
      | "wood"
      | "fabric"
      | "metal"
      | "glass"
      | "veil"
      | "screen" = "paint",
  ) {
    const key = `${color}/${surface}`;
    let material = this.materials.get(key);
    if (!material) {
      if (surface === "screen" && !this.display) {
        const canvas = document.createElement("canvas");
        canvas.width = 384;
        canvas.height = 240;
        const c = canvas.getContext("2d")!;
        const sky = c.createLinearGradient(0, 0, 0, 240);
        sky.addColorStop(0, "#879eaf");
        sky.addColorStop(0.55, "#dfc7b4");
        sky.addColorStop(1, "#667c7f");
        c.fillStyle = sky;
        c.fillRect(0, 0, 384, 240);
        for (let layer = 0; layer < 3; layer++) {
          c.fillStyle = ["#88999b", "#677f83", "#465f66"][layer];
          c.beginPath();
          c.moveTo(0, 240);
          for (let x = 0; x <= 384; x += 16)
            c.lineTo(x, 145 + layer * 25 + Math.sin(x / 60 + layer * 2) * 16);
          c.lineTo(384, 240);
          c.fill();
        }
        c.fillStyle = "#e5e9e5bb";
        c.fillRect(0, 226, 384, 14);
        for (let i = 0; i < 7; i++) c.fillRect(145 + i * 14, 230, 7, 7);
        this.display = new THREE.CanvasTexture(canvas);
        this.display.colorSpace = THREE.SRGBColorSpace;
        this.textures.push(this.display);
      }
      const textured = this.style === "natural";
      material = new THREE.MeshStandardMaterial({
        color,
        roughness:
          surface === "metal"
            ? 0.32
            : surface === "fabric"
              ? 0.97
              : surface === "wood"
                ? 0.57
                : 0.76,
        metalness: surface === "metal" ? 0.72 : 0,
        transparent: surface === "glass" || surface === "veil",
        opacity: surface === "glass" ? 0.12 : surface === "veil" ? 0.22 : 1,
        depthWrite: surface !== "glass" && surface !== "veil",
        side:
          surface === "glass" || surface === "veil"
            ? THREE.DoubleSide
            : THREE.FrontSide,
        map:
          surface === "screen"
            ? this.display
            : textured
              ? surface === "wood"
                ? this.wood
                : surface === "fabric" || surface === "veil"
                  ? this.weave
                  : null
              : null,
        bumpMap: textured && surface === "fabric" ? this.weave : null,
        bumpScale: 0.005,
      });
      material.userData.managedByDesign = true;
      this.materials.set(key, material);
    }
    return material;
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    p: Point = [0, 0, 0],
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...p);
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }
  box(
    size: Point,
    color: string,
    p: Point,
    radius = 0.025,
    surface: Parameters<SceneDesign["material"]>[1] = "paint",
  ) {
    return this.mesh(
      new RoundedBoxGeometry(
        ...size,
        2,
        Math.min(radius, ...size.map((v) => v / 3)),
      ),
      this.material(color, surface),
      p,
    );
  }
  cylinder(
    top: number,
    bottom: number,
    height: number,
    color: string,
    p: Point,
    surface: Parameters<SceneDesign["material"]>[1] = "paint",
  ) {
    return this.mesh(
      new THREE.CylinderGeometry(top, bottom, height, 20),
      this.material(color, surface),
      p,
    );
  }
  rod(a: Point, b: Point, radius: number, color = this.colors.metal) {
    const start = new THREE.Vector3(...a),
      end = new THREE.Vector3(...b);
    const rod = this.cylinder(
      radius,
      radius,
      start.distanceTo(end),
      color,
      [0, 0, 0],
      "metal",
    );
    rod.position.copy(start).add(end).multiplyScalar(0.5);
    rod.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      end.sub(start).normalize(),
    );
    return rod;
  }
  sphere(
    scale: Point,
    color: string,
    p: Point,
    surface: Parameters<SceneDesign["material"]>[1] = "paint",
  ) {
    const mesh = this.mesh(
      new THREE.SphereGeometry(1, 20, 12),
      this.material(color, surface),
      p,
    );
    mesh.scale.set(...scale);
    return mesh;
  }
  private vessel(color: string, size = 1) {
    const points = [
      [0, 0],
      [0.12, 0],
      [0.17, 0.04],
      [0.19, 0.24],
      [0.13, 0.32],
      [0.09, 0.35],
      [0.09, 0.38],
      [0.075, 0.38],
      [0.075, 0.35],
    ];
    const mesh = this.mesh(
      new THREE.LatheGeometry(
        points.map(([x, y]) => new THREE.Vector2(x * size, y * size)),
        24,
      ),
      this.material(color),
    );
    return mesh;
  }
  private plant(size = 1) {
    const group = new THREE.Group();
    group.add(this.vessel("#b78564", 0.9));
    group.add(this.cylinder(0.15, 0.15, 0.015, "#493f30", [0, 0.24, 0]));
    for (let i = 0; i < 9; i++) {
      const angle = i * 2.399;
      const h = 0.55 + (i % 3) * 0.15;
      const x = Math.cos(angle) * 0.25,
        z = Math.sin(angle) * 0.25;
      group.add(this.rod([0, 0.25, 0], [x, h, z], 0.008, "#5b6e43"));
      const leaf = this.sphere(
        [0.11, 0.035, 0.24],
        i % 2 ? "#68794c" : "#405b40",
        [x, h, z],
      );
      leaf.rotation.set(0.35, -angle + Math.PI / 2, 0.2);
      group.add(leaf);
    }
    group.scale.setScalar(size);
    return group;
  }
  private books(width: number) {
    const group = new THREE.Group();
    const colors = ["#777b69", "#cbba99", "#a0745c", "#586872", "#ddd3ba"];
    for (let i = 0; i < 6; i++) {
      const h = 0.23 + ((i * 3) % 5) * 0.025;
      const book = this.box(
        [width / 7, h, 0.18],
        colors[i % colors.length],
        [((i - 2.5) * width) / 6.5, h / 2, 0],
        0.005,
      );
      if (i === 5) book.rotation.z = -0.15;
      group.add(book);
      group.add(
        this.box(
          [width / 9, 0.008, 0.004],
          "#ded8c6",
          [((i - 2.5) * width) / 6.5, h * 0.7, 0.092],
          0.001,
        ),
      );
    }
    return group;
  }
  private lamp() {
    const group = new THREE.Group();
    group.add(
      this.cylinder(0.1, 0.12, 0.025, this.colors.dark, [0, 0.015, 0], "metal"),
    );
    group.add(this.rod([0, 0.03, 0], [0.06, 0.42, 0], 0.014, "#a18d62"));
    group.add(
      this.cylinder(0.055, 0.16, 0.14, this.colors.paper, [0.06, 0.44, 0]),
    );
    group.add(this.cylinder(0.14, 0.14, 0.008, "#f7deb1", [0.06, 0.374, 0]));
    return group;
  }
  private chair() {
    const group = new THREE.Group();
    for (const x of [-0.22, 0.22])
      for (const z of [-0.2, 0.2])
        group.add(
          this.rod(
            [x * 1.2, 0.02, z * 1.2],
            [x, 0.45, z],
            0.025,
            this.colors.dark,
          ),
        );
    group.add(
      this.box(
        [0.6, 0.12, 0.54],
        this.colors.textile,
        [0, 0.45, 0],
        0.07,
        "fabric",
      ),
    );
    const back = this.box(
      [0.57, 0.43, 0.09],
      this.colors.textile,
      [0, 0.76, 0.22],
      0.06,
      "fabric",
    );
    back.rotation.x = 0.13;
    group.add(back);
    group.add(this.rod([-0.23, 0.4, 0.18], [-0.23, 0.74, 0.23], 0.018));
    group.add(this.rod([0.23, 0.4, 0.18], [0.23, 0.74, 0.23], 0.018));
    return group;
  }

  /** Merge static meshes per material, keeping movable/domain objects independent. */
  batch(root: THREE.Group) {
    root.updateMatrixWorld(true);
    const batches = new Map<
      string,
      {
        material: THREE.Material;
        castShadow: boolean;
        receiveShadow: boolean;
        parts: THREE.BufferGeometry[];
      }
    >();
    root.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || Array.isArray(node.material)) return;
      const geometry = (
        node.geometry.index
          ? node.geometry.toNonIndexed()
          : node.geometry.clone()
      ).applyMatrix4(node.matrixWorld);
      const key = `${node.material.uuid}:${node.castShadow}:${node.receiveShadow}`;
      const batch = batches.get(key) ?? {
        material: node.material,
        castShadow: node.castShadow,
        receiveShadow: node.receiveShadow,
        parts: [] as THREE.BufferGeometry[],
      };
      batch.parts.push(geometry);
      batches.set(key, batch);
      node.geometry.dispose();
    });
    const result = new THREE.Group();
    for (const {
      material,
      parts,
      castShadow,
      receiveShadow,
    } of batches.values()) {
      // Box/cylinder/lathe geometries all have indexed position/normal/UV attributes.
      const merged = mergeGeometries(parts);
      parts.forEach((part) => part.dispose());
      if (merged) {
        const mesh = this.mesh(merged, material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = receiveShadow;
        result.add(mesh);
      }
    }
    return result;
  }

  room(room: GuestRoomLike, decorate: boolean) {
    const furnishings = new THREE.Group();
    const [w, d] = room.size;
    // Room bounds remain domain configuration. Objects and negative space form
    // the visible areas; no walls, window frames or room platforms are drawn.
    if (room.kind === "room" && decorate && w >= 3.5 && d >= 3.5) {
      if (room.id === "study") this.study(furnishings, w, d);
      else if (room.id === "living") this.living(furnishings, w, d);
      else if (room.id === "storage") this.storage(furnishings, w, d);
    }
    const result = this.batch(furnishings);
    result.userData.decorative = true;
    return result;
  }

  private study(g: THREE.Group, w: number, d: number) {
    const z = -d / 2 + 0.75;
    g.add(
      this.box(
        [2.35, 0.07, 0.78],
        this.colors.oak,
        [0.4, 0.77, z],
        0.025,
        "wood",
      ),
    );
    for (const x of [-0.6, 1.4])
      for (const dz of [-0.26, 0.26])
        g.add(
          this.rod([x, 0.02, z + dz], [x * 0.97, 0.73, z + dz * 0.95], 0.024),
        );
    g.add(
      this.box([0.44, 0.6, 0.55], this.colors.paper, [-0.35, 0.32, z], 0.025),
    );
    for (let i = 0; i < 3; i++) {
      g.add(
        this.box(
          [0.4, 0.008, 0.008],
          "#b5ad9a",
          [-0.35, 0.23 + i * 0.15, z + 0.28],
          0.001,
        ),
      );
      g.add(
        this.box(
          [0.09, 0.015, 0.02],
          this.colors.dark,
          [-0.35, 0.28 + i * 0.15, z + 0.29],
          0.004,
        ),
      );
    }
    const lamp = this.lamp();
    lamp.position.set(1.17, 0.805, z - 0.1);
    g.add(lamp);
    const notebook = this.box(
      [0.4, 0.035, 0.29],
      "#536c62",
      [0.38, 0.825, z + 0.1],
      0.008,
    );
    notebook.rotation.y = -0.12;
    g.add(notebook);
    g.add(
      this.box(
        [0.25, 0.008, 0.18],
        this.colors.paper,
        [0.39, 0.847, z + 0.08],
        0.002,
      ),
    );
    const cup = this.vessel("#b97958", 0.32);
    cup.position.set(0.83, 0.805, z + 0.16);
    g.add(cup);
    const chair = this.chair();
    chair.position.set(0.4, 0, z + 0.8);
    chair.rotation.y = -0.12;
    g.add(chair);
    const bx = -w / 2 + 0.6,
      bz = -d / 2 + 0.35;
    for (const x of [bx - 0.45, bx + 0.45])
      g.add(
        this.box(
          [0.04, 1.65, 0.32],
          this.colors.oak,
          [x, 0.84, bz],
          0.005,
          "wood",
        ),
      );
    for (let i = 0; i < 4; i++) {
      const y = 0.15 + i * 0.48;
      g.add(
        this.box(
          [0.94, 0.035, 0.34],
          this.colors.oak,
          [bx, y, bz],
          0.005,
          "wood",
        ),
      );
      if (i < 3) {
        const books = this.books(0.65);
        books.position.set(bx - 0.06, y + 0.02, bz);
        g.add(books);
      }
    }
    const plant = this.plant(0.45);
    plant.position.set(bx, 1.61, bz);
    g.add(plant);
    g.add(
      this.box(
        [2.5, 0.014, 1.75],
        "#c4bda6",
        [0.25, 0.012, 0.3],
        0.035,
        "fabric",
      ),
    );
    const tall = this.plant(1.2);
    tall.position.set(w / 2 - 0.48, 0.01, -d / 2 + 0.48);
    g.add(tall);
  }

  private living(g: THREE.Group, w: number, d: number) {
    const z = -d / 2 + 0.65;
    for (const x of [-1, 1])
      for (const dz of [-0.3, 0.3])
        g.add(
          this.cylinder(
            0.035,
            0.025,
            0.18,
            this.colors.dark,
            [x, 0.09, z + dz],
            "wood",
          ),
        );
    g.add(
      this.box(
        [2.4, 0.23, 0.92],
        this.colors.textile,
        [0, 0.29, z],
        0.09,
        "fabric",
      ),
    );
    const rounding = this.style === "soft" ? 0.16 : 0.08;
    for (const x of [-0.56, 0.56]) {
      g.add(
        this.box(
          [1.05, 0.19, 0.72],
          this.colors.textile,
          [x, 0.48, z + 0.05],
          rounding,
          "fabric",
        ),
      );
      const back = this.box(
        [1.08, 0.58, 0.2],
        this.colors.textile,
        [x, 0.69, z - 0.32],
        rounding,
        "fabric",
      );
      back.rotation.x = -0.08;
      g.add(back);
    }
    for (const x of [-1.18, 1.18])
      g.add(
        this.box(
          [0.2, 0.48, 0.94],
          this.colors.textile,
          [x, 0.52, z],
          0.075,
          "fabric",
        ),
      );
    const pillow = this.box(
      [0.39, 0.38, 0.14],
      this.colors.accent,
      [-0.78, 0.71, z - 0.06],
      0.09,
      "fabric",
    );
    pillow.rotation.set(-0.22, 0.15, 0.2);
    g.add(pillow);
    const cushion = this.box(
      [0.44, 0.28, 0.15],
      "#d5c6a7",
      [0.8, 0.65, z - 0.02],
      0.09,
      "fabric",
    );
    cushion.rotation.z = -0.2;
    g.add(cushion);
    g.add(
      this.box([2.85, 0.018, 2.1], "#ded0b4", [0, 0.015, 0.35], 0.06, "fabric"),
    );
    const table = this.cylinder(
      0.57,
      0.57,
      0.055,
      this.colors.oak,
      [0.1, 0.4, 0.7],
      "wood",
    );
    table.scale.z = 0.72;
    g.add(table);
    for (let i = 0; i < 3; i++) {
      const a = (i * Math.PI * 2) / 3;
      g.add(
        this.rod(
          [0.1 + Math.cos(a) * 0.37, 0.02, 0.7 + Math.sin(a) * 0.26],
          [0.1 + Math.cos(a) * 0.25, 0.38, 0.7 + Math.sin(a) * 0.2],
          0.024,
          this.colors.dark,
        ),
      );
    }
    g.add(this.box([0.3, 0.025, 0.22], "#586e70", [0.15, 0.441, 0.68], 0.005));
    const bowl = this.vessel(this.colors.paper, 0.35);
    bowl.position.set(-0.13, 0.429, 0.78);
    g.add(bowl);
    const plant = this.plant(1.4);
    plant.position.set(w / 2 - 0.5, 0.01, -d / 2 + 0.5);
    g.add(plant);
    g.add(
      this.cylinder(
        0.26,
        0.21,
        0.04,
        this.colors.dark,
        [-1.75, 0.59, z + 0.15],
        "wood",
      ),
    );
    g.add(
      this.cylinder(
        0.055,
        0.11,
        0.57,
        this.colors.dark,
        [-1.75, 0.29, z + 0.15],
        "wood",
      ),
    );
    const lamp = this.lamp();
    lamp.position.set(-1.75, 0.61, z + 0.15);
    g.add(lamp);
  }

  private storage(g: THREE.Group, w: number, d: number) {
    const width = Math.min(w - 0.7, 2.8),
      z = -d / 2 + 0.38;
    for (const x of [-width / 2, width / 2])
      g.add(
        this.box(
          [0.045, 1.5, 0.46],
          this.colors.metal,
          [x, 0.77, z],
          0.008,
          "metal",
        ),
      );
    for (let i = 0; i < 3; i++) {
      const y = 0.22 + i * 0.59;
      g.add(
        this.box(
          [width + 0.06, 0.035, 0.48],
          this.colors.oak,
          [0, y, z],
          0.008,
          "wood",
        ),
      );
      if (i === 1)
        for (const x of [-0.65, 0.1, 0.85]) {
          g.add(
            this.box(
              [0.57, 0.31, 0.37],
              "#b6a684",
              [x, y + 0.18, z],
              0.025,
              "fabric",
            ),
          );
          g.add(
            this.box(
              [0.15, 0.055, 0.008],
              this.colors.paper,
              [x, y + 0.21, z + 0.19],
              0.005,
            ),
          );
        }
    }
    const plant = this.plant(0.55);
    plant.position.set(-0.7, 1.42, z);
    g.add(plant);
    const vessel = this.vessel(this.colors.accent, 0.75);
    vessel.position.set(0.6, 1.42, z);
    g.add(vessel);
  }

  private furniture(asset: GuestAsset) {
    const g = new THREE.Group();
    const { width: w, height: h, depth: d, color, kind } = asset;
    const box = (
      size: Point,
      c: string,
      p: Point,
      surface: Parameters<SceneDesign["material"]>[1] = "paint",
    ) => g.add(this.box(size, c, p, Math.min(0.035, h * 0.03), surface));
    const legs = (top: number) => {
      for (const x of [-w * 0.42, w * 0.42])
        for (const z of [-d * 0.4, d * 0.4])
          g.add(
            this.rod(
              [x, 0.02, z],
              [x, top, z],
              Math.min(0.025, w * 0.035),
              this.colors.metal,
            ),
          );
    };
    if (kind === "table") {
      legs(h - 0.06);
      box([w, 0.06, d], color, [0, h - 0.03, 0], "wood");
    } else if (kind === "bed") {
      box([w, h * 0.42, d], "#aa927a", [0, h * 0.21, 0], "wood");
      box([w * 0.98, h * 0.36, d * 0.96], "#d2d8d7", [0, h * 0.6, 0], "fabric");
      box([w, h, 0.08], color, [0, h / 2, -d / 2 + 0.04], "fabric");
      box(
        [w * 0.99, h * 0.06, d * 0.68],
        "#94aaba",
        [0, h * 0.81, d * 0.13],
        "fabric",
      );
      for (const x of [-w * 0.25, w * 0.25])
        box(
          [w * 0.42, h * 0.12, d * 0.2],
          "#eee7d9",
          [x, h * 0.84, -d * 0.32],
          "fabric",
        );
    } else if (kind === "wardrobe" || kind === "cabinet" || kind === "fridge") {
      box(
        [w, h, d],
        color,
        [0, h / 2, 0],
        kind === "fridge" ? "metal" : "wood",
      );
      const doors = kind === "wardrobe" ? Math.max(2, Math.round(w / 0.5)) : 2;
      for (let i = 0; i < doors; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / doors;
        box([w / doors - 0.015, h * 0.94, 0.025], color, [x, h * 0.5, d / 2]);
        box(
          [0.018, Math.min(0.18, h / 4), 0.025],
          "#686a60",
          [x + (w / doors) * 0.3, h * 0.5, d / 2 + 0.025],
          "metal",
        );
      }
    } else if (kind === "shelf") {
      for (const x of [-w / 2, w / 2])
        box([0.035, h, d], color, [x, h / 2, 0], "wood");
      for (let i = 0; i < 5; i++)
        box([w, 0.035, d], color, [0, 0.04 + (i * (h - 0.08)) / 4, 0], "wood");
      for (let i = 0; i < 3; i++)
        box(
          [w * 0.27, h * 0.16, d * 0.8],
          i % 2 ? "#bbb29b" : "#91a199",
          [w * (i - 1) * 0.3, h * 0.36, 0],
          "fabric",
        );
    } else if (kind === "chair") {
      const chair = this.chair();
      const bounds = new THREE.Box3().setFromObject(chair),
        size = bounds.getSize(new THREE.Vector3());
      chair.scale.set(w / size.x, h / size.y, d / size.z);
      g.add(chair);
    } else if (kind === "sofa") {
      legs(h * 0.3);
      box([w, h * 0.35, d], color, [0, h * 0.35, 0], "fabric");
      box([w, h * 0.65, d * 0.22], color, [0, h * 0.65, -d * 0.39], "fabric");
      for (const x of [-w * 0.46, w * 0.46])
        box([w * 0.08, h * 0.6, d], color, [x, h * 0.4, 0], "fabric");
    } else if (kind === "screen") {
      box([w, h * 0.83, d * 0.5], "#303b3e", [0, h * 0.58, 0], "metal");
      box([w * 0.94, h * 0.73, 0.008], "#728e9a", [0, h * 0.58, d * 0.26]);
      box([w * 0.3, 0.025, d], "#4f5656", [0, 0.02, 0], "metal");
      box([0.04, h * 0.2, 0.04], "#4f5656", [0, h * 0.12, 0], "metal");
    } else if (kind === "washer") {
      box([w, h, d], color, [0, h / 2, 0]);
      const door = this.cylinder(w * 0.31, w * 0.31, 0.04, "#596d77", [
        0,
        h * 0.44,
        d / 2,
      ]);
      door.rotation.x = Math.PI / 2;
      g.add(door);
      box([w * 0.7, h * 0.09, 0.015], "#d1d6d1", [0, h * 0.87, d / 2]);
    } else if (kind === "sink") {
      box([w, h * 0.95, d], color, [0, h * 0.475, 0], "wood");
      for (const x of [-w * 0.245, w * 0.245]) {
        box([w * 0.47, h * 0.81, 0.014], color, [x, h * 0.49, d * 0.5], "wood");
        box(
          [0.012, h * 0.17, 0.015],
          "#707771",
          [x + (x < 0 ? 0.12 : -0.12) * w, h * 0.55, d * 0.52],
          "metal",
        );
      }
      box([w, h * 0.05, d], "#dddcd3", [0, h * 0.975, 0]);
      box([w * 0.64, 0.015, d * 0.6], "#7d9294", [0, h + 0.003, 0], "metal");
      g.add(this.rod([0, h, -d * 0.36], [0, h + 0.2, -d * 0.36], 0.018));
      g.add(this.rod([0, h + 0.2, -d * 0.36], [0, h + 0.2, -0.02], 0.018));
    } else if (kind === "toilet") {
      box([w * 0.85, h, d * 0.25], color, [0, h / 2, -d * 0.35]);
      g.add(
        this.sphere([w / 2, h * 0.22, d * 0.43], color, [
          0,
          h * 0.42,
          d * 0.05,
        ]),
      );
      box([w * 0.55, h * 0.4, d * 0.5], color, [0, h * 0.2, 0]);
      const seat = new THREE.Mesh(
        new THREE.TorusGeometry(1, 0.14, 8, 36),
        this.material(color, "paint"),
      );
      seat.rotation.x = -Math.PI / 2;
      seat.scale.set(w * 0.39, d * 0.29, h * 0.12);
      seat.position.set(0, h * 0.64, d * 0.08);
      g.add(seat);
      box(
        [w * 0.22, 0.012, d * 0.09],
        "#b0b8b7",
        [0, h + 0.005, -d * 0.35],
        "metal",
      );
    } else if (kind === "rug") box([w, h, d], color, [0, h / 2, 0], "fabric");
    g.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(g),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    g.position.set(-center.x, -bounds.min.y, -center.z);
    const fitted = new THREE.Group();
    fitted.add(g);
    fitted.scale.set(w / size.x, h / size.y, d / size.z);
    return this.batch(fitted);
  }

  overview(asset: GuestAsset) {
    // Silhouette is semantic information at every distance. Only imported detail
    // and tiny surface features may be deferred; furniture never becomes its bounds.
    return this.primitive(asset);
  }

  primitive(asset: GuestAsset) {
    const device =
      detailedWorkstation(asset, this) ?? detailedDevice(asset, this);
    if (device) return device;
    const detailed = detailedFurniture(asset, this);
    if (detailed) return detailed;
    if ((furnitureKinds as readonly string[]).includes(asset.kind))
      return this.furniture(asset);
    const g = new THREE.Group();
    const { width: w, height: h, depth: d } = asset;
    const color = new THREE.Color(asset.color)
      .lerp(new THREE.Color("#b5b1a6"), 0.18)
      .getStyle();
    if (["label", "bottle", "bag"].includes(asset.kind)) {
      if (asset.kind === "bottle") {
        g.add(this.cylinder(w * 0.5, w * 0.5, h * 0.8, color, [0, h * 0.4, 0]));
        g.add(
          this.cylinder(w * 0.23, w * 0.23, h * 0.2, "#5b7062", [
            0,
            h * 0.9,
            0,
          ]),
        );
      } else
        g.add(
          this.box(
            [w, h, d],
            color,
            [0, h / 2, 0],
            Math.min(w, h) * (asset.kind === "bag" ? 0.22 : 0.05),
          ),
        );
      if (typeof document !== "undefined") {
        const key = `label-${asset.id}-${asset.name}`;
        let material = this.materials.get(key);
        if (!material) {
          const canvas = document.createElement("canvas");
          canvas.width = 512;
          canvas.height = 256;
          const ctx = canvas.getContext("2d")!;
          ctx.fillStyle = "#f6f1e5";
          ctx.fillRect(0, 0, 512, 256);
          ctx.fillStyle = "#30483e";
          ctx.font = "bold 48px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(asset.name.slice(0, 8), 256, 145, 460);
          const texture = new THREE.CanvasTexture(canvas);
          texture.colorSpace = THREE.SRGBColorSpace;
          this.textures.push(texture);
          material = new THREE.MeshStandardMaterial({
            map: texture,
            roughness: 1,
          });
          this.materials.set(key, material);
        }
        const label = new THREE.Mesh(
          new THREE.PlaneGeometry(w * 0.9, h * 0.55),
          material,
        );
        label.position.set(0, h * 0.52, d / 2 + 0.002);
        g.add(label);
      }
    } else if (asset.kind === "plant") {
      const plant = this.plant();
      const bounds = new THREE.Box3().setFromObject(plant),
        size = bounds.getSize(new THREE.Vector3());
      plant.scale.set(w / size.x, h / size.y, d / size.z);
      g.add(plant);
    } else if (asset.kind === "computer" || asset.kind === "server") {
      const server = asset.kind === "server";
      g.add(
        this.box(
          [w, h * 0.92, d],
          color,
          [0, h * 0.54, 0],
          Math.min(w, h) * 0.1,
          "metal",
        ),
      );
      g.add(
        this.box(
          [w * 0.88, h * 0.1, d * 0.88],
          "#303b3c",
          [0, h * 0.05, 0],
          h * 0.03,
        ),
      );
      const faceZ = d / 2 + 0.003;
      if (server) {
        g.add(
          this.box(
            [w * 0.83, h * 0.81, 0.012],
            "#344347",
            [0, h * 0.53, faceZ],
            0.015,
            "metal",
          ),
        );
        for (let i = 0; i < 4; i++) {
          const y = h * (0.3 + i * 0.15);
          g.add(
            this.box(
              [w * 0.68, h * 0.115, 0.016],
              "#687570",
              [0, y, faceZ + 0.01],
              0.005,
              "metal",
            ),
          );
          g.add(
            this.box(
              [w * 0.42, h * 0.012, 0.005],
              "#263434",
              [-w * 0.07, y, faceZ + 0.02],
              0.001,
            ),
          );
        }
      } else {
        for (let i = 0; i < 3; i++)
          g.add(
            this.box(
              [w * 0.11, h * 0.12, 0.01],
              "#273436",
              [(i - 1) * w * 0.19, h * 0.48, faceZ],
              0.003,
            ),
          );
        g.add(
          this.box(
            [w * 0.7, h * 0.015, d * 0.65],
            color,
            [0, h + 0.001, 0],
            0.02,
            "metal",
          ),
        );
      }
      // A physical indicator detail; health is only shown by source-aware UI markers.
      g.add(
        this.box(
          [w * 0.035, h * 0.035, 0.006],
          "#b4c4c1",
          [w * 0.31, h * 0.13, faceZ + 0.02],
          0.002,
        ),
      );
    } else if (asset.kind === "plug") {
      g.add(this.box([w, h, d], color, [0, h / 2, 0], Math.min(w, h) * 0.17));
      const recess = this.cylinder(w * 0.29, w * 0.29, 0.012, "#d3d1c4", [
        0,
        h * 0.58,
        d / 2,
      ]);
      recess.rotation.x = Math.PI / 2;
      g.add(recess);
      for (const x of [-w * 0.11, w * 0.11])
        g.add(
          this.box(
            [w * 0.055, h * 0.12, 0.01],
            "#49524c",
            [x, h * 0.57, d / 2 + 0.01],
            0.003,
          ),
        );
    } else {
      g.add(this.box([w, h, d], color, [0, h / 2, 0], Math.min(w, h) * 0.07));
      g.add(
        this.box(
          [w * 0.88, h * 0.055, d * 1.02],
          "#b4a182",
          [0, h * 0.96, 0],
          0.005,
        ),
      );
      g.add(
        this.box(
          [w * 0.68, h * 0.5, 0.006],
          this.colors.paper,
          [0, h * 0.52, d / 2 + 0.003],
          0.01,
        ),
      );
      g.add(
        this.box(
          [w * 0.43, h * 0.055, 0.004],
          "#7e8c6f",
          [0, h * 0.62, d / 2 + 0.008],
          0.002,
        ),
      );
      for (let i = 0; i < 3; i++)
        g.add(
          this.box(
            [w * (0.44 - i * 0.07), h * 0.015, 0.004],
            "#b3ac94",
            [0, h * (0.48 - i * 0.06), d / 2 + 0.008],
            0.001,
          ),
        );
    }
    const bounds = new THREE.Box3().setFromObject(g, true),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    g.position.set(-center.x, -bounds.min.y, -center.z);
    const fitted = new THREE.Group();
    fitted.add(g);
    fitted.scale.set(w / size.x, h / size.y, d / size.z);
    return this.batch(fitted);
  }

  dispose() {
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
  }
}
