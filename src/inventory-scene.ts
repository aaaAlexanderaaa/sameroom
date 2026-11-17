import * as THREE from "three";
import {
  CSS3DObject,
  CSS3DRenderer,
} from "three/addons/renderers/CSS3DRenderer.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { SceneDesign } from "./scene-design.js";
import { assetFor, isStorage, items, storageGrid } from "../shared/spatial.js";
import { emptyInterior, leaves, regions } from "../shared/compartments.js";
import type { Entity, HomeTemplate } from "../shared/domain.js";

interface Board {
  object: CSS3DObject;
  near: HTMLElement;
  summary: HTMLElement;
  dot: HTMLElement;
  lod: string;
  cabinet: string;
  part: string;
  drawer: boolean;
  closedZ: number;
  open: boolean;
  front: THREE.Vector3;
  cabinetFront: THREE.Vector3;
}
export class InventoryScene {
  readonly camera = new THREE.PerspectiveCamera(65, 1, 0.025, 180);
  private scene = new THREE.Scene();
  private labels = new THREE.Scene();
  private renderer = new THREE.WebGLRenderer({ antialias: true });
  private css = new CSS3DRenderer();
  private cssCamera = new THREE.PerspectiveCamera(65, 1, 0.025, 180);
  private design = new SceneDesign("natural");
  private content = new THREE.Group();
  private boards: Board[] = [];
  private keys = new Set<string>();
  private raf = 0;
  private disposed = false;
  private last = 0;
  private yaw = 0;
  private pitch = 0;
  private eye = 1.6;
  private floor = 0;
  private cameraSet = false;
  private focused?: string;
  private observer: ResizeObserver;
  private abort = new AbortController();
  private home?: HomeTemplate;
  private down?: { x: number; y: number };
  private pause = false;
  private generation = 0;
  private draco = new DRACOLoader().setDecoderPath("/vendor/draco/");
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  constructor(
    readonly host: HTMLElement,
    private select: (id: string, compartment?: string) => void,
    private lockChange: (locked: boolean) => void,
  ) {
    this.loader.setDRACOLoader(this.draco);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor("#e8e7dd");
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "inventory-canvas";
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "室内库存漫游，方向键或 WASD 移动，空格切换高度",
    );
    this.css.domElement.className = "inventory-labels";
    host.append(this.renderer.domElement, this.css.domElement);
    this.scene.add(new THREE.HemisphereLight("#fff8e6", "#91a6a2", 2.8));
    const sun = new THREE.DirectionalLight("#fff3df", 2.2);
    sun.position.set(5, 10, 6);
    this.scene.add(sun, this.content);
    this.scene.fog = new THREE.Fog("#e8e7dd", 12, 35);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshStandardMaterial({ color: "#dedfd4", roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.025;
    this.scene.add(ground);
    const canvas = this.renderer.domElement,
      signal = this.abort.signal;
    const resize = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      this.renderer.setSize(w, h);
      this.css.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (this.focused) this.focus(this.focused, true);
      else this.render();
    };
    this.observer = new ResizeObserver(resize);
    this.observer.observe(host);
    document.addEventListener(
      "pointerlockchange",
      () => {
        this.keys.clear();
        this.lockChange(document.pointerLockElement === canvas);
      },
      { signal },
    );
    window.addEventListener("blur", () => this.keys.clear(), { signal });
    window.addEventListener(
      "keydown",
      (e) => {
        if (
          this.pause ||
          (e.target as HTMLElement)?.closest(
            "input,textarea,select,button,[role=dialog]",
          ) ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        if (e.code === "Space") {
          e.preventDefault();
          if (!e.repeat) this.toggleHeight();
          return;
        }
        if (
          [
            "KeyW",
            "KeyA",
            "KeyS",
            "KeyD",
            "ArrowUp",
            "ArrowDown",
            "ArrowLeft",
            "ArrowRight",
          ].includes(e.code)
        ) {
          e.preventDefault();
          this.keys.add(e.code);
          this.animate();
        }
      },
      { signal },
    );
    window.addEventListener("keyup", (e) => this.keys.delete(e.code), {
      signal,
    });
    canvas.addEventListener(
      "pointerdown",
      (e) => {
        canvas.focus();
        this.down = { x: e.clientX, y: e.clientY };
        canvas.setPointerCapture(e.pointerId);
      },
      { signal },
    );
    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (this.pause) return;
        if (document.pointerLockElement === canvas) {
          this.focused = undefined;
          this.yaw -= e.movementX * 0.0025;
          this.pitch = Math.max(
            -1.25,
            Math.min(1.25, this.pitch - e.movementY * 0.0025),
          );
          this.render();
        } else if (this.down && e.buttons) {
          this.focused = undefined;
          this.yaw -= (e.clientX - this.down.x) * 0.004;
          this.pitch = Math.max(
            -1.25,
            Math.min(1.25, this.pitch - (e.clientY - this.down.y) * 0.004),
          );
          this.down = { x: e.clientX, y: e.clientY };
          this.render();
        }
      },
      { signal },
    );
    canvas.addEventListener(
      "pointerup",
      () => {
        this.down = undefined;
      },
      { signal },
    );
    canvas.addEventListener(
      "pointercancel",
      () => {
        this.down = undefined;
      },
      { signal },
    );
    canvas.addEventListener(
      "dblclick",
      () => {
        if (!this.pause) void canvas.requestPointerLock()?.catch(() => {});
      },
      { signal },
    );
    resize();
  }
  setPaused(value: boolean) {
    this.pause = value;
    if (value) {
      this.keys.clear();
      if (document.pointerLockElement === this.renderer.domElement)
        document.exitPointerLock();
    }
  }
  toggleHeight() {
    this.eye = this.eye === 1.6 ? 0.4 : 1.6;
    this.animate();
  }
  walk(direction: "forward" | "back" | "left" | "right", active: boolean) {
    const key = { forward: "KeyW", back: "KeyS", left: "KeyA", right: "KeyD" }[
      direction
    ];
    if (active) this.keys.add(key);
    else this.keys.delete(key);
    this.animate();
  }
  private animate() {
    if (this.raf || this.disposed) return;
    this.last = performance.now();
    const step = (now: number) => {
      this.raf = 0;
      if (this.disposed) return;
      const dt = Math.min(0.2, (now - this.last) / 1000);
      this.last = now;
      const forward =
        Number(this.keys.has("KeyW") || this.keys.has("ArrowUp")) -
        Number(this.keys.has("KeyS") || this.keys.has("ArrowDown"));
      const right =
        Number(this.keys.has("KeyD") || this.keys.has("ArrowRight")) -
        Number(this.keys.has("KeyA") || this.keys.has("ArrowLeft"));
      const speed = (1.8 * dt) / Math.max(1, Math.hypot(forward, right));
      if (forward || right) this.focused = undefined;
      this.camera.position.x +=
        (-Math.sin(this.yaw) * forward + Math.cos(this.yaw) * right) * speed;
      this.camera.position.z +=
        (-Math.cos(this.yaw) * forward - Math.sin(this.yaw) * right) * speed;
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.floor + this.eye,
        14,
        dt,
      );
      this.render();
      if (
        this.keys.size ||
        Math.abs(this.camera.position.y - this.floor - this.eye) > 0.002
      )
        this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }
  focus(id: string, preserveHeight = false) {
    const entity = this.home?.entities.find((e) => e.id === id);
    if (!entity || !this.home) return;
    const room = this.home.rooms.find((r) => r.id === entity.locationId)!,
      asset = assetFor(this.home, entity);
    const front = new THREE.Vector3(
      Math.sin(entity.rotation),
      0,
      Math.cos(entity.rotation),
    );
    const position = new THREE.Vector3(...room.origin).add(
      new THREE.Vector3(...entity.position),
    );
    this.floor = room.origin[1];
    if (!preserveHeight) this.eye = asset.height < 0.9 ? 0.4 : 1.6;
    const tangent = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distance =
      asset.depth / 2 +
      Math.max(
        1,
        (asset.width * 0.65) / (tangent * this.camera.aspect),
        (asset.height * 0.75) / tangent,
      );
    this.camera.position.copy(position).addScaledVector(front, distance);
    this.camera.position.y = this.floor + this.eye;
    this.yaw = entity.rotation;
    this.pitch = Math.atan2(asset.height * 0.55 - this.eye, distance);
    this.focused = id;
    this.cameraSet = true;
    this.render();
  }
  update(home: HomeTemplate) {
    this.home = home;
    const generation = ++this.generation;
    this.disposeGroup(this.content);
    this.content.clear();
    for (const board of this.boards) board.object.element.remove();
    this.boards = [];
    this.labels.clear();
    this.design.dispose();
    this.design = new SceneDesign("natural");
    const all = items(home),
      cabinets: Entity[] = [];
    for (const entity of home.entities) {
      const room = home.rooms.find((r) => r.id === entity.locationId);
      if (
        !room ||
        room.kind !== "room" ||
        entity.lifecycle !== "active" ||
        entity.visibility === "editing" ||
        entity.attachment?.kind === "storage"
      )
        continue;
      const asset = assetFor(home, entity),
        group = new THREE.Group();
      group.position
        .set(...entity.position)
        .add(new THREE.Vector3(...room.origin));
      group.rotation.y = entity.rotation;
      this.content.add(group);
      if (isStorage(home, entity)) {
        cabinets.push(entity);
        const w = asset.width,
          h = asset.height,
          d = asset.depth;
        const shell = new THREE.MeshStandardMaterial({
          color: asset.color,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
          roughness: 0.8,
        });
        const volume = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shell);
        volume.position.y = h / 2;
        group.add(volume);
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(volume.geometry),
          new THREE.LineBasicMaterial({
            color: "#7e978b",
            transparent: true,
            opacity: 0.65,
          }),
        );
        outline.position.y = h / 2;
        group.add(outline);
        const interior =
          storageGrid(home, entity.id).interior ?? emptyInterior();
        for (const r of regions(interior).filter((r) => r.part.split)) {
          const split = r.part.split!,
            vertical = split.axis === "x",
            offset = vertical
              ? (r.x + r.width * split.ratio) * w - w / 2
              : h - (r.y + r.height * split.ratio) * h;
          const shelf = this.design.box(
            vertical ? [0.016, r.height * h, d] : [r.width * w, 0.016, d],
            "#adb8aa",
            vertical
              ? [offset, h - (r.y + r.height / 2) * h, 0]
              : [(r.x + r.width / 2) * w - w / 2, offset, 0],
            0.002,
          );
          group.add(shelf);
        }
        const cabinetFront = new THREE.Vector3(0, h / 2, d / 2 + 0.025)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotation)
          .add(group.position);
        for (const r of leaves(interior)) {
          const element = document.createElement("section");
          element.className = "inventory-board";
          element.dataset.container = entity.id;
          element.dataset.compartment = r.part.id;
          const bw = Math.max(45, r.width * w * 500 - 10),
            bh = Math.max(40, r.height * h * 500 - 10);
          element.style.width = `${bw}px`;
          element.style.height = `${bh}px`;
          const titleSize = Math.round(
            Math.max(12, Math.min(16, bw / 13, bh / 3.4)),
          );
          const summarySize = Math.round(
            Math.max(11, Math.min(20, (bw - 12) / 10, (bh - 12) / 3.8)),
          );
          element.style.setProperty("--inv-title-size", `${titleSize}px`);
          element.style.setProperty("--inv-summary-size", `${summarySize}px`);
          if (bh < 130) element.classList.add("inventory-shallow");
          const header = document.createElement("button");
          header.className = "inventory-region-title";
          header.textContent = `${r.part.kind === "drawer" ? "▱ " : "▤ "}${r.part.name}`;
          header.title = entity.name;
          const near = document.createElement("div");
          near.className = "inventory-contents";
          const contents = all.filter(
            (i) =>
              i.attachment?.kind === "storage" &&
              i.attachment.parentId === entity.id &&
              (i.attachment.compartmentId ?? leaves(interior)[0].part.id) ===
                r.part.id,
          );
          const maxTiles = Math.max(
            0,
            Math.floor((bw - 20) / 108) *
              Math.max(0, Math.floor((bh - 100) / 116)),
          );
          if (!maxTiles) element.classList.add("inventory-compact");
          header.title = `${entity.name} / ${r.part.name} · ${contents.length} 种物品`;
          for (const item of contents.slice(0, maxTiles)) {
            const tile = document.createElement("button");
            tile.className = "inventory-item";
            tile.title = item.name;
            tile.dataset.item = item.id;
            if (item.photos?.length) {
              const image = document.createElement("img");
              image.src = item.photos[0];
              image.alt = item.name;
              tile.append(image);
            } else {
              const icon = document.createElement("span");
              icon.className = "inventory-item-icon";
              icon.textContent = "quantity" in item ? "▧" : "◇";
              tile.append(icon);
            }
            const label = document.createElement("strong");
            label.textContent = item.name;
            tile.append(label);
            if ("quantity" in item) {
              const count = document.createElement("small");
              count.textContent = `${item.quantity} ${item.unit}`;
              tile.append(count);
            }
            tile.onclick = (e) => {
              e.stopPropagation();
              this.select(item.id);
            };
            near.append(tile);
          }
          const more = document.createElement("button");
          more.className = "inventory-add";
          more.textContent =
            !maxTiles && contents.length
              ? `${contents[0].name}${contents.length > 1 ? ` 等 ${contents.length} 种` : ""} · 查看`
              : contents.length > maxTiles
                ? `另有 ${contents.length - maxTiles} 件 · 查看`
                : "+ 放入物品";
          more.onclick = () => this.select(entity.id, r.part.id);
          near.append(more);
          const summary = document.createElement("button");
          summary.className = "inventory-summary";
          summary.title = `${entity.name} / ${r.part.name} · ${contents.length} 种物品`;
          const partLeaves = leaves(interior);
          if (partLeaves.length > 1) {
            const scope = document.createElement("span");
            scope.className = "inventory-summary-scope";
            scope.textContent = entity.name;
            const title = document.createElement("strong");
            title.className = "inventory-summary-title";
            title.textContent = r.part.name;
            summary.append(scope, title);
          } else {
            const title = document.createElement("strong");
            title.className = "inventory-summary-title";
            title.textContent = entity.name;
            summary.append(title);
          }
          const meta = document.createElement("small");
          meta.className = "inventory-summary-meta";
          meta.textContent = `${contents.length} 种物品${contents[0] ? ` · ${contents[0].name}` : ""}`;
          summary.append(meta);
          summary.onclick = () => {
            this.select(entity.id, r.part.id);
          };
          const dot = document.createElement("button");
          dot.className = "inventory-dot";
          dot.title = `${entity.name} · ${contents.length} 种物品`;
          dot.setAttribute("aria-label", dot.title);
          dot.textContent = "•";
          dot.onclick = () => this.focus(entity.id);
          element.append(header, near, summary, dot);
          const object = new CSS3DObject(element);
          object.scale.setScalar(0.002);
          object.rotation.y = entity.rotation;
          const local = new THREE.Vector3(
            (r.x + r.width / 2) * w - w / 2,
            h - (r.y + r.height / 2) * h,
            d / 2 + 0.025,
          ).applyAxisAngle(new THREE.Vector3(0, 1, 0), entity.rotation);
          object.position.copy(group.position).add(local);
          this.labels.add(object);
          const front = new THREE.Vector3(0, 0, 1).applyAxisAngle(
            new THREE.Vector3(0, 1, 0),
            entity.rotation,
          );
          const board: Board = {
            object,
            near,
            summary,
            dot,
            lod: "",
            cabinet: entity.id,
            part: r.part.id,
            drawer: r.part.kind === "drawer",
            closedZ: 0,
            open: r.part.kind !== "drawer",
            front,
            cabinetFront,
          };
          header.onclick = () => {
            if (board.drawer) {
              board.open = !board.open;
              object.position.addScaledVector(front, board.open ? 0.15 : -0.15);
              element.classList.toggle("drawer-open", board.open);
              this.render();
            } else this.select(entity.id, r.part.id);
          };
          this.boards.push(board);
        }
      } else {
        group.add(
          this.design.primitive(
            asset.kind === "glb" ? { ...asset, kind: "box" } : asset,
          ),
        );
        if (asset.url) {
          void this.loader
            .loadAsync(asset.url)
            .then((gltf) => {
              if (this.disposed || generation !== this.generation) {
                this.disposeGroup(gltf.scene);
                return;
              }
              const bounds = new THREE.Box3().setFromObject(gltf.scene),
                s = bounds.getSize(new THREE.Vector3()),
                center = bounds.getCenter(new THREE.Vector3());
              const scale = Math.min(
                asset.width / Math.max(0.001, s.x),
                asset.height / Math.max(0.001, s.y),
                asset.depth / Math.max(0.001, s.z),
              );
              gltf.scene.position.set(-center.x, -bounds.min.y, -center.z);
              const fitted = new THREE.Group();
              fitted.add(gltf.scene);
              fitted.scale.setScalar(scale);
              this.disposeGroup(group);
              group.clear();
              group.add(fitted);
              this.render();
            })
            .catch(() => {});
        }
      }
    }
    if (!this.cameraSet) {
      if (cabinets[0]) this.focus(cabinets[0].id);
      else {
        const room = home.rooms.find((r) => r.kind === "room");
        this.camera.position.set(
          room?.origin[0] ?? 0,
          1.6,
          (room?.origin[2] ?? 0) + 2,
        );
        this.cameraSet = true;
      }
    }
    this.render();
  }
  private render() {
    if (this.disposed) return;
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
    this.camera.updateMatrixWorld();
    let near = 0,
      summary = 0,
      distant = 0;
    for (const b of this.boards) {
      const distance = this.camera.position.distanceTo(b.cabinetFront),
        old = b.lod;
      const lod =
        distance < (old === "near" ? 2.92 : 2.82)
          ? "near"
          : distance < (old === "summary" ? 6.5 : 6)
            ? "summary"
            : "distant";
      b.lod = lod;
      b.object.element.dataset.lod = lod;
      const facing =
        this.camera.position.clone().sub(b.object.position).dot(b.front) >
        -0.05;
      b.object.element.style.visibility = facing ? "visible" : "hidden";
      b.near.hidden = lod !== "near" || (b.drawer && !b.open);
      b.summary.hidden = lod !== "summary";
      b.dot.hidden = lod !== "distant";
      b.object.element.classList.toggle("drawer-closed", b.drawer && !b.open);
      if (lod === "near") near++;
      else if (lod === "summary") summary++;
      else distant++;
    }
    this.renderer.render(this.scene, this.camera);
    // Keep the CSS camera transform in front of its perspective plane. With
    // metre-sized scenes, a world camera at negative Z can put the parent DOM
    // plane behind the eye: Chromium paints the children but cannot hit-test them.
    // Transform the label world into camera space; the resulting image is identical.
    this.cssCamera.projectionMatrix.copy(this.camera.projectionMatrix);
    this.cssCamera.position.set(0, 0, 1);
    this.labels.matrixAutoUpdate = false;
    this.labels.matrix
      .makeTranslation(0, 0, 1)
      .multiply(this.camera.matrixWorldInverse);
    this.labels.matrixWorldNeedsUpdate = true;
    this.css.render(this.labels, this.cssCamera);
    this.host.dataset.camera = this.camera.position
      .toArray()
      .map((n) => n.toFixed(3))
      .join(",");
    this.host.dataset.eye = String(this.eye);
    this.host.dataset.near = String(near);
    this.host.dataset.summary = String(summary);
    this.host.dataset.distant = String(distant);
    this.host.dataset.frames = String(
      Number(this.host.dataset.frames ?? 0) + 1,
    );
  }
  private disposeGroup(group: THREE.Object3D) {
    group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
        o.geometry.dispose();
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const v of Object.values(m))
            if (v instanceof THREE.Texture) v.dispose();
          m.dispose();
        }
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    cancelAnimationFrame(this.raf);
    if (document.pointerLockElement === this.renderer.domElement)
      document.exitPointerLock();
    this.abort.abort();
    this.observer.disconnect();
    this.disposeGroup(this.scene);
    this.design.dispose();
    this.draco.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.css.domElement.remove();
  }
}
