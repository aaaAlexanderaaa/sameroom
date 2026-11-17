import * as THREE from "three";
import {
  eligible,
  frontAngle,
  inspectionItems,
  focusAnchor,
  lightKinds,
  type TaskMode,
} from "../shared/spatial.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SceneDesign, type SceneStyle } from "./scene-design.js";
import {
  entityObservation,
  observationState,
  stockVisibleLimit,
  type Dashboard,
} from "../shared/domain.js";
import {
  hotspotEffectDefaults,
  resolveHotspotVisual,
  resolveHotspotWorldPosition,
  type GuestAsset,
  type GuestDashboard,
  type GuestEntity,
  type Hotspot,
} from "../shared/guest.js";
import { createHotspotSvgElement } from "./hotspot-icons.js";

export type SceneWorldState = Dashboard | GuestDashboard;
export interface SurfacePickHit {
  kind: "entity" | "room";
  locationId: string;
  worldPosition: [number, number, number];
  roomPosition: [number, number, number];
  entityId?: string;
  entityLocalOffset?: [number, number, number];
}
export interface SceneSelection {
  kind: "entity" | "stock";
  id: string;
}
export interface SceneFilter {
  room: string;
  category: string;
  query: string;
  task?: TaskMode;
  lights?: boolean;
  guest?: boolean;
  showHotspots?: boolean;
  activeHotspotId?: string;
}
export interface SceneEdit {
  mode: "translate" | "rotate";
  snap: boolean;
  onChange: (
    selection: SceneSelection,
    position: [number, number, number],
    rotation: number,
  ) => void;
}
interface SceneLabel {
  element: HTMLButtonElement;
  position: THREE.Vector3;
  entityId?: string;
  attention?: boolean;
}
interface SceneHotspotPin {
  hotspot: Hotspot;
  element: HTMLButtonElement;
  position: THREE.Vector3;
  occluded: boolean;
}

export class HomeScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-10, 10, 8, -8, 0.1, 250);
  readonly controls: OrbitControls;
  private content = new THREE.Group();
  private design = new SceneDesign("natural");
  private decorative = true;
  private state?: SceneWorldState;
  private filter: SceneFilter = { room: "all", category: "all", query: "" };
  private selection?: SceneSelection;
  private inspecting = false;
  private returnCamera?: {
    position: THREE.Vector3;
    target: THREE.Vector3;
    zoom: number;
  };
  private inspectionOffset?: THREE.Vector3;
  private focusViews = new Map<
    string,
    { position: THREE.Vector3; target: THREE.Vector3; zoom: number }
  >();
  private hovered?: string;
  private contextualHit = false;
  private occluded = new Map<
    THREE.Mesh,
    { original: THREE.Material | THREE.Material[]; faded: THREE.Material[] }
  >();
  private objects = new Map<string, THREE.Group>();
  private rings = new Map<
    string,
    THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>
  >();
  private roomBounds = new Map<string, THREE.Box3>();
  private visibleRooms = new Set<string>();
  private layoutKey = "";
  private draco = new DRACOLoader().setDecoderPath("/vendor/draco/");
  private ktx: KTX2Loader;
  private loader = new GLTFLoader();
  private assets = new Map<string, Promise<THREE.Group>>();
  private assetRoots = new Set<THREE.Group>();
  private observer: ResizeObserver;
  private controller = new AbortController();
  private scheduled = 0;
  private transition = 0;
  private disposed = false;
  private frame = 0;
  private pointerStart = new THREE.Vector2();
  private pointers = new Set<number>();
  private gesture = false;
  private editor?: SceneEdit;
  private transform?: TransformControls;
  private editGuides = new THREE.Group();
  private transformGesture = false;
  private view: "angle" | "top" = "angle";
  private roomFocus = "all";
  private cyberEnabled = false;
  private cyberInsets?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  private labelLayer = document.createElement("div");
  private assetWarning = document.createElement("div");
  private labels: SceneLabel[] = [];
  private hotspotPins: SceneHotspotPin[] = [];
  private onHotspotSelect?: (hotspot: Hotspot) => void;
  private surfacePickHandler?: (hit: SurfacePickHit) => void;
  private environment: THREE.WebGLRenderTarget;
  private sun = new THREE.DirectionalLight(0xfff0d7, 3.3);
  private ground = new THREE.Mesh(
    new THREE.PlaneGeometry(250, 250),
    new THREE.ShadowMaterial({ color: 0x514939, opacity: 0.14 }),
  );
  private selectionMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.5, 0.515, 64),
    new THREE.MeshBasicMaterial({
      color: 0xa66736,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );

  constructor(
    readonly host: HTMLElement,
    private onSelect: (selection: SceneSelection) => void,
    onError: (message: string) => void,
    private onEmpty: () => void = () => {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor(0xeeeae3);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "家庭三维视图，拖动旋转、滚轮缩放、点击物件查看、点击空白打开菜单；M 打开菜单，斜杠搜索",
    );
    this.renderer.domElement.tabIndex = 0;
    this.labelLayer.className = "scene-label-layer";
    this.assetWarning.className = "scene-asset-warning";
    this.assetWarning.setAttribute("role", "status");
    this.assetWarning.hidden = true;
    host.append(this.renderer.domElement, this.labelLayer, this.assetWarning);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.zoomSpeed = 1.4;
    this.controls.minZoom = 0.2;
    this.controls.maxZoom = 360;
    this.controls.minPolarAngle = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2;
    this.controls.addEventListener("change", () => this.invalidate());
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.ktx = new KTX2Loader()
      .setTranscoderPath("/vendor/basis/")
      .detectSupport(this.renderer);
    this.loader
      .setDRACOLoader(this.draco)
      .setKTX2Loader(this.ktx)
      .setMeshoptDecoder(MeshoptDecoder);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    this.scene.environmentIntensity = 0.38;
    room.dispose();
    pmrem.dispose();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.bias = -0.00008;
    this.sun.shadow.radius = 3;
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.015;
    this.ground.receiveShadow = true;
    this.selectionMarker.rotation.x = -Math.PI / 2;
    this.selectionMarker.visible = false;
    this.scene.add(
      new THREE.HemisphereLight(0xf2f4ef, 0x8a7967, 1.35),
      this.sun,
      this.sun.target,
      this.ground,
      this.content,
      this.selectionMarker,
    );
    this.reset();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    const canvas = this.renderer.domElement;
    const { signal } = this.controller;
    this.labelLayer.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        canvas.dispatchEvent(
          new WheelEvent("wheel", {
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaZ: event.deltaZ,
            deltaMode: event.deltaMode,
            clientX: event.clientX,
            clientY: event.clientY,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            metaKey: event.metaKey,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { passive: false, signal },
    );
    let gestureScale = 1;
    host.addEventListener(
      "gesturestart",
      (event) => {
        event.preventDefault();
        gestureScale = (event as Event & { scale?: number }).scale || 1;
      },
      { passive: false, signal },
    );
    host.addEventListener(
      "gesturechange",
      (event) => {
        event.preventDefault();
        const scale = (event as Event & { scale?: number }).scale;
        if (typeof scale === "number" && scale > 0 && gestureScale > 0) {
          this.zoom(scale / gestureScale);
          gestureScale = scale;
        }
      },
      { passive: false, signal },
    );
    canvas.addEventListener("pointerdown", (e) => {
      cancelAnimationFrame(this.transition);
      if (!this.pointers.size) this.gesture = false;
      this.pointers.add(e.pointerId);
      if (this.pointers.size > 1) this.gesture = true;
      this.pointerStart.set(e.clientX, e.clientY);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.transform?.dragging) return;
      if (e.buttons) {
        if (
          this.pointerStart.distanceTo(
            new THREE.Vector2(e.clientX, e.clientY),
          ) > 5
        )
          this.gesture = true;
        return;
      }
      if (this.surfacePickHandler) {
        canvas.style.cursor = "crosshair";
        return;
      }
      const selected = this.pick(e);
      if (selected?.id !== this.hovered) {
        this.hovered = selected?.id;
        canvas.style.cursor = selected ? "pointer" : "grab";
        this.projectLabels();
      }
    });
    canvas.addEventListener("pointerleave", (event) => {
      if (
        event.relatedTarget instanceof Node &&
        this.labelLayer.contains(event.relatedTarget)
      )
        return;
      this.hovered = undefined;
      this.projectLabels();
    });
    canvas.addEventListener("pointerup", (e) => {
      this.pointers.delete(e.pointerId);
      if (this.transformGesture || this.transform?.axis) return;
      if (this.gesture) return;
      if (e.button !== 0 || !e.isPrimary) return;
      if (
        this.pointerStart.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) >
        5
      )
        return;
      if (this.surfacePickHandler) {
        const hit = this.pickSurface(e);
        if (hit) this.surfacePickHandler(hit);
        return;
      }
      const selected = this.pick(e);
      if (selected) this.onSelect(selected);
      else if (!this.contextualHit) this.onEmpty();
    });
    canvas.addEventListener("pointercancel", (e) => {
      this.pointers.delete(e.pointerId);
      this.gesture = true;
    });
    canvas.addEventListener("lostpointercapture", (e) => {
      this.pointers.delete(e.pointerId);
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      onError("图形连接已中断，请刷新。列表和库存操作仍可使用。");
    });
  }

  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    this.contextualHit = false;
    for (const hit of ray.intersectObjects(
      [...this.objects.values()].filter((o) => o.visible),
      true,
    )) {
      let object: THREE.Object3D | null = hit.object;
      let visible = true;
      while (object && !object.userData.selection) {
        visible = visible && object.visible;
        object = object.parent;
      }
      if (!visible || !object?.visible || !object.userData.selection) continue;
      if (object.userData.occluding) {
        this.contextualHit = true;
        continue;
      }
      const asset = object.userData.asset as GuestAsset;
      if (!this.editor && asset.kind === "mouse") {
        const point = object.worldToLocal(hit.point.clone());
        if (
          Math.abs(point.x) > asset.width * 0.19 ||
          Math.abs(point.z) > asset.depth * 0.25 ||
          point.y < asset.height * 0.15
        ) {
          // It is still a physical surface, not empty background. A harmless
          // pad click must not dismiss the current context either.
          this.contextualHit = true;
          return undefined;
        }
      }
      this.contextualHit = true;
      // An opaque background object still occludes what is behind it. It must
      // neither select itself nor leak the click through to an unrelated device.
      return object.userData.interactive === false
        ? undefined
        : (object.userData.selection as SceneSelection);
    }
    return undefined;
  }
  private pickSurface(event: PointerEvent): SurfacePickHit | undefined {
    if (!this.state) return undefined;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    for (const hit of ray.intersectObjects(
      [...this.objects.values()].filter((o) => o.visible),
      true,
    )) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !object.userData.selection) object = object.parent;
      if (!object || object.userData.selection?.kind !== "entity") continue;
      const entity = this.state.home.entities.find(
        (e) => e.id === object.userData.selection.id,
      );
      if (!entity) continue;
      const room = this.state.home.rooms.find((r) => r.id === entity.locationId);
      if (!room || room.kind !== "room") continue;
      const worldPoint = hit.point.clone();
      const local = object.worldToLocal(worldPoint.clone());
      return {
        kind: "entity",
        locationId: room.id,
        entityId: entity.id,
        worldPosition: [
          Number(worldPoint.x.toFixed(3)),
          Number((worldPoint.y + 0.08).toFixed(3)),
          Number(worldPoint.z.toFixed(3)),
        ],
        roomPosition: [
          Number((worldPoint.x - room.origin[0]).toFixed(3)),
          Number((worldPoint.y - room.origin[1] + 0.08).toFixed(3)),
          Number((worldPoint.z - room.origin[2]).toFixed(3)),
        ],
        entityLocalOffset: [
          Number(local.x.toFixed(3)),
          Number((local.y + 0.08).toFixed(3)),
          Number(local.z.toFixed(3)),
        ],
      };
    }
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (!ray.ray.intersectPlane(groundPlane, point)) return undefined;
    const room = this.state.home.rooms.find(
      (r) =>
        r.kind === "room" &&
        Math.abs(point.x - r.origin[0]) <= r.size[0] / 2 &&
        Math.abs(point.z - r.origin[2]) <= r.size[1] / 2,
    );
    if (!room) return undefined;
    return {
      kind: "room",
      locationId: room.id,
      worldPosition: [
        Number(point.x.toFixed(3)),
        0.24,
        Number(point.z.toFixed(3)),
      ],
      roomPosition: [
        Number((point.x - room.origin[0]).toFixed(3)),
        0.24,
        Number((point.z - room.origin[2]).toFixed(3)),
      ],
    };
  }
  private resize() {
    const width = Math.max(this.host.clientWidth, 1),
      height = Math.max(this.host.clientHeight, 1);
    this.renderer.setSize(width, height);
    const aspect = width / height;
    this.camera.left = -10;
    this.camera.right = 10;
    this.camera.top = 10 / aspect;
    this.camera.bottom = -10 / aspect;
    this.applyCyberCamera(width, height);
    this.camera.updateProjectionMatrix();
    this.camera.zoom = this.fittedZoom(this.viewBounds());
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  invalidate() {
    if (this.scheduled || this.disposed) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      if (this.disposed) return;
      this.refreshDetailLevel();
      this.updateOcclusion();
      this.renderer.render(this.scene, this.camera);
      this.updateHotspotOcclusion();
      this.projectLabels();
      this.host.dataset.frames = String(++this.frame);
      this.host.dataset.triangles = String(this.renderer.info.render.triangles);
      this.host.dataset.modelEntities = [...this.objects]
        .filter(([, group]) => group.userData.modelLoaded)
        .map(([id]) => id)
        .sort()
        .join(",");
      this.host.dataset.camera = this.camera.position
        .toArray()
        .map((n) => n.toFixed(2))
        .join(",");
      this.host.dataset.target = this.controls.target.toArray().join(",");
      this.host.dataset.zoom = this.camera.zoom.toFixed(2);
      this.host.dispatchEvent(new Event("scene-frame"));
    });
  }
  private label(
    text: string,
    position: THREE.Vector3,
    onClick: () => void,
    entityId?: string,
    attention = false,
  ) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = entityId ? "scene-object-label" : "scene-room-label";
    element.textContent = text;
    if (entityId) element.dataset.objectId = entityId;
    element.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    this.labelLayer.append(element);
    this.labels.push({ element, position, entityId, attention });
  }
  private addHotspotPin(hotspot: Hotspot, position: THREE.Vector3) {
    const visual = resolveHotspotVisual(hotspot);
    const element = document.createElement("button");
    element.type = "button";
    element.className = "scene-hotspot-pin";
    element.dataset.hotspotId = hotspot.id;
    element.dataset.effectKind = hotspot.effect.kind;
    element.dataset.size = visual.size;
    element.dataset.pulse = visual.pulse;
    element.style.setProperty("--hotspot-color", visual.color);
    element.setAttribute(
      "aria-label",
      `${hotspot.label}（${hotspotEffectDefaults[hotspot.effect.kind].label}）`,
    );
    const halo = document.createElement("span");
    halo.className = "hotspot-halo";
    halo.setAttribute("aria-hidden", "true");
    const core = document.createElement("span");
    core.className = "hotspot-core";
    core.setAttribute("aria-hidden", "true");
    core.append(createHotspotSvgElement(visual.icon));
    const tooltip = document.createElement("span");
    tooltip.className = "hotspot-tooltip";
    tooltip.textContent = hotspot.label;
    element.append(halo, core, tooltip);
    element.addEventListener("pointerdown", (e) => e.stopPropagation());
    element.addEventListener("pointerup", (e) => e.stopPropagation());
    element.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onHotspotSelect?.(hotspot);
    });
    this.labelLayer.append(element);
    this.hotspotPins.push({ hotspot, element, position, occluded: false });
  }
  private updateHotspotOcclusion() {
    if (!this.hotspotPins.length) return;
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const candidates = [...this.objects.values()].filter(
      (o) => o.visible && !o.userData.occluding,
    );
    for (const pin of this.hotspotPins) {
      let occluded = false;
      const ray = new THREE.Raycaster(
        pin.position.clone().addScaledVector(direction, 30),
        direction.clone().negate(),
        0,
        29.88,
      );
      for (const hit of ray.intersectObjects(candidates, true)) {
        if (!hit.object.visible) continue;
        if (hit.object instanceof THREE.Mesh) {
          const mat = Array.isArray(hit.object.material)
            ? hit.object.material[0]
            : hit.object.material;
          if (mat && mat.transparent && mat.opacity < 0.5) continue;
        }
        occluded = true;
        break;
      }
      pin.occluded = occluded;
    }
  }
  private projectLabels() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    const occupied: { x: number; y: number; w: number; h: number }[] = [];
    for (const pin of this.hotspotPins) {
      const show = !this.editor && this.filter.showHotspots !== false;
      const p = pin.position.clone().project(this.camera);
      const x = ((p.x + 1) * width) / 2,
        y = ((1 - p.y) * height) / 2;
      const visible =
        show &&
        Math.abs(p.z) < 1 &&
        x > 18 &&
        x < width - 18 &&
        y > 18 &&
        y < height - 18;
      pin.element.hidden = !visible;
      pin.element.classList.toggle("occluded", pin.occluded);
      pin.element.classList.toggle(
        "active",
        this.filter.activeHotspotId === pin.hotspot.id,
      );
      if (!visible) continue;
      pin.element.style.left = `${x}px`;
      pin.element.style.top = `${y}px`;
      occupied.push({ x, y, w: 34, h: 34 });
    }
    const priority = (l: SceneLabel) =>
      l.entityId === this.selection?.id
        ? 4
        : !l.entityId
          ? 3
          : l.attention
            ? 2
            : 1;
    for (const label of [...this.labels].sort(
      (a, b) => priority(b) - priority(a),
    )) {
      const selected = label.entityId === this.selection?.id;
      const show =
        selected ||
        (!this.editor &&
          (Boolean(this.filter.query) || this.hovered === label.entityId));
      const p = label.position.clone().project(this.camera);
      const x = ((p.x + 1) * width) / 2,
        y = ((1 - p.y) * height) / 2;
      const visible =
        show &&
        (!this.inspecting ||
          selected ||
          Boolean(
            label.entityId && this.objects.get(label.entityId)?.visible,
          )) &&
        Math.abs(p.z) < 1 &&
        x > 12 &&
        x < width - 12 &&
        y > 12 &&
        y < height - 12;
      label.element.hidden = !visible;
      label.element.classList.toggle("selected", selected);
      label.element.classList.toggle("attention", Boolean(label.attention));
      if (!visible) continue;
      const w = label.element.offsetWidth,
        h = label.element.offsetHeight;
      const left = Math.max(w / 2 + 8, Math.min(width - w / 2 - 8, x));
      const top = [0, -26, 26, -52, 52]
        .map((offset) => y + offset)
        .find(
          (candidate) =>
            candidate > h / 2 + 4 &&
            candidate < height - h / 2 - 4 &&
            !occupied.some(
              (r) =>
                Math.abs(left - r.x) < (w + r.w) / 2 + 5 &&
                Math.abs(candidate - r.y) < (h + r.h) / 2 + 4,
            ),
        );
      label.element.hidden = top === undefined;
      if (top === undefined) continue;
      label.element.style.left = `${left}px`;
      label.element.style.top = `${top}px`;
      occupied.push({ x: left, y: top, w, h });
    }
  }
  private loadAsset(url: string) {
    if (!this.assets.has(url)) {
      this.assets.set(
        url,
        this.loader
          .loadAsync(url)
          .then((gltf) => {
            if (this.disposed) {
              this.disposeTree(gltf.scene, true);
              throw new Error("Scene disposed.");
            }
            this.assetRoots.add(gltf.scene);
            return gltf.scene;
          })
          .catch((error) => {
            this.assets.delete(url);
            throw error;
          }),
      );
    }
    return this.assets.get(url)!;
  }
  private attached(group: THREE.Group) {
    return !this.disposed && this.content.getObjectById(group.id) === group;
  }
  private warnAsset(group: THREE.Group) {
    if (!this.attached(group)) return;
    this.host.dataset.assetWarning =
      "Model unavailable; schematic appearance retained.";
    this.assetWarning.textContent =
      "有几个模型没能加载出来，先用基础造型顶上，刷新可以重试。";
    this.assetWarning.hidden = false;
  }
  private normalization(source: THREE.Group, asset: GuestAsset, yaw = 0) {
    source.updateMatrixWorld(true);
    const bounds = new THREE.Box3()
      .setFromObject(source)
      .applyMatrix4(new THREE.Matrix4().makeRotationY(yaw));
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.min(
      asset.width / size.x,
      asset.height / size.y,
      asset.depth / size.z,
    );
    if (!Number.isFinite(scale) || scale <= 0)
      throw new Error("Model has no measurable width.");
    const center = bounds.getCenter(new THREE.Vector3());
    return new THREE.Matrix4()
      .makeTranslation(
        -center.x * scale,
        -bounds.min.y * scale,
        -center.z * scale,
      )
      .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
      .multiply(new THREE.Matrix4().makeRotationY(yaw));
  }
  private async addAsset(group: THREE.Group, asset: GuestAsset) {
    const ticket = (group.userData.assetTicket ?? 0) + 1;
    group.userData.assetTicket = ticket;
    group.userData.modelLoaded = false;
    const selected = this.selection?.id === group.userData.selection?.id;
    const detail =
      this.editor ||
      selected ||
      group.userData.forcedDetail ||
      (this.roomFocus !== "all" && group.userData.interactive !== false);
    const url =
      (selected || group.userData.forcedDetail) && asset.detailUrl
        ? asset.detailUrl
        : asset.url;
    group.userData.level = selected ? "detail" : detail ? "local" : "overview";
    if (!url) {
      group.add(
        detail ? this.design.primitive(asset) : this.design.overview(asset),
      );
      return;
    }
    // Retain the authored identity while its optional detailed model loads or fails.
    const fallback = this.design.primitive(asset);
    group.add(fallback);
    try {
      const source = await this.loadAsset(url);
      if (!this.attached(group) || group.userData.assetTicket !== ticket)
        return;
      const wrapper = new THREE.Group();
      wrapper.applyMatrix4(
        this.normalization(source, asset, asset.modelRotation),
      );
      const object = source.clone(true);
      object.traverse((o) => {
        o.userData.shared = true;
        if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
      });
      wrapper.add(object);
      group.remove(fallback);
      this.disposeTree(fallback);
      group.add(wrapper);
      group.userData.modelLoaded = true;
      this.highlight();
      this.renderer.shadowMap.needsUpdate = true;
      this.invalidate();
    } catch {
      this.warnAsset(group);
    }
  }
  private refreshDetailLevel() {
    if (this.editor || this.inspecting) return;
    let detailed = 0;
    for (const group of this.objects.values()) {
      if (
        group.userData.selection?.kind !== "entity" ||
        group.userData.interactive === false
      )
        continue;
      const asset = group.userData.asset as GuestAsset;
      const pixels =
        (Math.max(asset.width, asset.height, asset.depth) *
          this.camera.zoom *
          this.host.clientWidth) /
        20;
      const next =
        pixels > 180 || (group.userData.forcedDetail && pixels > 110);
      if (next) detailed++;
      if (
        Boolean(group.userData.forcedDetail) === Boolean(next) &&
        (next ||
          this.roomFocus !== "all" ||
          group.userData.level === "overview")
      )
        continue;
      group.userData.forcedDetail = next;
      const ring = this.rings.get(group.userData.selection.id);
      for (const child of [...group.children])
        if (child !== ring) {
          group.remove(child);
          this.disposeTree(child);
        }
      void this.addAsset(group, asset);
    }
    this.host.dataset.detailedObjects = String(detailed);
  }
  private async addStockAsset(
    group: THREE.Group,
    asset: GuestAsset,
    positions: THREE.Matrix4[],
    fallback: THREE.Group,
  ) {
    if (asset.kind !== "glb" || !asset.url || !positions.length) return;
    try {
      const source = await this.loadAsset(asset.url);
      if (!this.attached(group)) return;
      const normalization = this.normalization(
        source,
        asset,
        asset.modelRotation,
      );
      const batches = new THREE.Group();
      source.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const mesh = new THREE.InstancedMesh(
          node.geometry,
          node.material,
          positions.length,
        );
        mesh.userData.shared = true;
        mesh.castShadow = mesh.receiveShadow = true;
        const local = normalization.clone().multiply(node.matrixWorld);
        positions.forEach((position, i) =>
          mesh.setMatrixAt(i, position.clone().multiply(local)),
        );
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        batches.add(mesh);
      });
      if (!batches.children.length) throw new Error("No model geometry.");
      group.remove(fallback);
      this.disposeTree(fallback);
      group.add(batches);
      group.userData.stockGlbCount = positions.length;
      this.host.dataset.stockGlbInstances = String(
        [...this.objects.values()].reduce(
          (n, o) => n + (o.userData.stockGlbCount ?? 0),
          0,
        ),
      );
      this.highlight();
      this.renderer.shadowMap.needsUpdate = true;
      this.invalidate();
    } catch {
      this.warnAsset(group);
    }
  }
  setHotspotHandler(handler?: (hotspot: Hotspot) => void) {
    this.onHotspotSelect = handler;
  }
  setSurfacePick(handler?: (hit: SurfacePickHit) => void) {
    this.surfacePickHandler = handler;
    this.renderer.domElement.style.cursor = handler ? "crosshair" : "grab";
  }
  getCameraPose(): {
    offset: [number, number, number];
    zoom: number;
    target: [number, number, number];
  } {
    const offset = this.camera.position.clone().sub(this.controls.target);
    return {
      offset: [
        Number(offset.x.toFixed(2)),
        Number(offset.y.toFixed(2)),
        Number(offset.z.toFixed(2)),
      ],
      zoom: Number(this.camera.zoom.toFixed(2)),
      target: [
        Number(this.controls.target.x.toFixed(2)),
        Number(this.controls.target.y.toFixed(2)),
        Number(this.controls.target.z.toFixed(2)),
      ],
    };
  }
  focusPoint(
    worldPoint: [number, number, number],
    offset?: [number, number, number],
    zoom?: number,
  ) {
    if (!this.returnCamera) {
      this.returnCamera = {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        zoom: this.camera.zoom,
      };
    }
    const target = new THREE.Vector3(...worldPoint);
    const nextOffset = offset
      ? new THREE.Vector3(...offset)
      : this.camera.position.clone().sub(this.controls.target);
    const nextZoom = THREE.MathUtils.clamp(
      zoom ?? Math.max(this.camera.zoom, 3.2),
      0.2,
      360,
    );
    this.move(target, nextZoom, false, nextOffset);
  }
  restoreView() {
    const previous = this.returnCamera;
    this.returnCamera = undefined;
    if (previous) {
      this.move(
        previous.target,
        previous.zoom,
        false,
        previous.position.clone().sub(previous.target),
      );
    }
  }
  update(state: SceneWorldState, filter: SceneFilter) {
    this.transform?.detach();
    this.state = state;
    this.filter = filter;
    const focusChanged = this.roomFocus !== filter.room;
    this.roomFocus = filter.room;
    this.clearOcclusion();
    this.scene.remove(this.content);
    this.disposeTree(this.content);
    this.content = new THREE.Group();
    this.scene.add(this.content);
    this.labels = [];
    this.hotspotPins = [];
    this.labelLayer.replaceChildren();
    this.hovered = undefined;
    this.objects.clear();
    this.rings.clear();
    this.roomBounds.clear();
    delete this.host.dataset.assetWarning;
    this.assetWarning.hidden = true;
    const previousRooms = [...this.visibleRooms].join(",");
    const overview =
      filter.room === "all" && filter.category === "all" && !filter.query;
    const hasPhysical = state.home.rooms.some((r) => r.kind === "room");
    this.visibleRooms = new Set(
      state.home.rooms
        .filter((r) =>
          filter.room === "all"
            ? !(overview && hasPhysical) || r.kind === "room"
            : r.id === filter.room,
        )
        .map((r) => r.id),
    );
    const showRoom = (id: string) => this.visibleRooms.has(id);
    let visibleRooms = 0,
      decorativeMeshes = 0;
    for (const room of state.home.rooms) {
      const [w, d] = room.size;
      this.roomBounds.set(
        room.id,
        new THREE.Box3(
          new THREE.Vector3(
            room.origin[0] - w / 2 - 0.15,
            room.origin[1] - 0.2,
            room.origin[2] - d / 2 - 0.15,
          ),
          new THREE.Vector3(
            room.origin[0] + w / 2 + 0.15,
            room.origin[1] + (room.kind === "room" ? 2.1 : 1),
            room.origin[2] + d / 2 + 0.45,
          ),
        ),
      );
      if (!showRoom(room.id)) continue;
      visibleRooms++;
      const group = this.design.room(
        room,
        state.home.schematic && this.decorative,
      );
      group.position.set(...room.origin);
      group.traverse((o) => {
        if (o.userData.decorative) decorativeMeshes += o.children.length;
      });
      this.content.add(group);
    }
    let visibleEntities = 0;
    for (const entity of state.home.entities) {
      if (
        "attachment" in entity &&
        entity.attachment?.kind === "storage" &&
        entity.id !== this.selection?.id
      )
        continue;
      if ("visibility" in entity && entity.visibility === "editing" && !this.editor)
        continue;
      if (
        ("lifecycle" in entity && entity.lifecycle === "retired") ||
        !showRoom(entity.locationId)
      )
        continue;
      if (filter.category !== "all" && filter.category !== entity.category)
        continue;
      const searchCorpus = `${entity.name} ${
        "description" in entity
          ? entity.description
          : ((entity as GuestEntity).publicSummary ?? "")
      } ${"tags" in entity ? entity.tags.join(" ") : ""}`;
      if (
        filter.query &&
        !searchCorpus.toLowerCase().includes(filter.query.toLowerCase())
      )
        continue;
      const room = state.home.rooms.find((r) => r.id === entity.locationId)!;
      const asset = state.home.assets.find((a) => a.id === entity.assetId)!;
      const group = new THREE.Group();
      group.position
        .set(...entity.position)
        .add(new THREE.Vector3(...room.origin));
      group.rotation.y = entity.rotation;
      group.userData.selection = { kind: "entity", id: entity.id };
      group.userData.interactive =
        Boolean(this.editor) ||
        (filter.guest
          ? (entity as GuestEntity).guestInteraction !== "backdrop"
          : eligible(
              state.home as Dashboard["home"],
              entity as Dashboard["home"]["entities"][number],
              filter.task ?? "browse",
            ));
      group.userData.asset = asset;
      this.content.add(group);
      this.objects.set(entity.id, group);
      void this.addAsset(group, asset);
      const isFullDashboard = "observations" in state;
      const health = isFullDashboard
        ? observationState(entityObservation(state, entity.id))
        : "unknown";
      const incident = isFullDashboard ? this.attention(state, entity.id) : false;
      const radius = Math.max(asset.width, asset.depth) * 0.62 + 0.07;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius, radius + 0.018, 48),
        new THREE.MeshBasicMaterial({
          color: incident ? "#bd783d" : health === "up" ? "#449980" : "#9ca9af",
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.035;
      ring.visible = incident;
      this.rings.set(entity.id, ring);
      group.add(ring);
      if (group.userData.interactive)
        this.label(
          entity.name,
          group.position
            .clone()
            .add(new THREE.Vector3(0, asset.height + 0.16, 0)),
          () => this.onSelect({ kind: "entity", id: entity.id }),
          entity.id,
          incident,
        );
      visibleEntities++;
    }
    let instances = 0;
    const stocks = "stocks" in state.home ? state.home.stocks : [];
    for (const stock of stocks) {
      if (
        stock.attachment?.kind === "storage" &&
        stock.id !== this.selection?.id
      )
        continue;
      if (
        !showRoom(stock.locationId) ||
        (filter.category !== "all" && filter.category !== "stock")
      )
        continue;
      if (
        filter.query &&
        !stock.name.toLowerCase().includes(filter.query.toLowerCase())
      )
        continue;
      const room = state.home.rooms.find((r) => r.id === stock.locationId)!;
      const asset = state.home.assets.find((a) => a.id === stock.assetId)!;
      const group = new THREE.Group();
      group.position
        .set(...stock.position)
        .add(new THREE.Vector3(...room.origin));
      group.rotation.y = stock.rotation ?? 0;
      group.userData.selection = { kind: "stock", id: stock.id };
      group.userData.interactive =
        Boolean(this.editor) ||
        eligible(state.home as Dashboard["home"], stock, filter.task ?? "browse");
      group.userData.asset = asset;
      this.content.add(group);
      this.objects.set(stock.id, group);
      const count = Math.min(stockVisibleLimit, stock.quantity);
      instances += count;
      const columns = Math.max(1, Math.min(count, 6)),
        rows = Math.max(1, Math.ceil(count / 6));
      const stepX = asset.width + 0.08,
        stepZ = asset.depth + 0.08;
      group.add(
        this.design.box(
          [
            Math.max(1, columns * stepX + 0.15),
            0.05,
            Math.max(0.8, rows * stepZ + 0.15),
          ],
          "#b7ab8f",
          [0, 0.015, 0],
          0.025,
          "wood",
        ),
      );
      const positions = Array.from({ length: count }, (_, i) =>
        new THREE.Matrix4().makeTranslation(
          ((i % 6) - (columns - 1) / 2) * stepX,
          0.05,
          (Math.floor(i / 6) - (rows - 1) / 2) * stepZ,
        ),
      );
      const source = this.design.primitive({
        ...asset,
        kind: asset.kind === "glb" ? "box" : asset.kind,
      });
      const fallback = new THREE.Group();
      source.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const mesh = new THREE.InstancedMesh(
          node.geometry,
          node.material,
          count,
        );
        positions.forEach((position, i) => mesh.setMatrixAt(i, position));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = mesh.receiveShadow = true;
        fallback.add(mesh);
      });
      group.add(fallback);
      void this.addStockAsset(group, asset, positions, fallback);
      if (group.userData.interactive)
        this.label(
          `${stock.name} · ${stock.quantity}${stock.unit}`,
          group.position
            .clone()
            .add(new THREE.Vector3(0, asset.height + 0.25, 0)),
          () => this.onSelect({ kind: "stock", id: stock.id }),
          stock.id,
          false,
        );
    }
    if (!this.editor && filter.showHotspots !== false) {
      for (const hotspot of state.home.hotspots ?? []) {
        const targetRoomId =
          hotspot.anchor.kind === "room"
            ? hotspot.anchor.locationId
            : state.home.entities.find(
                (e) => e.id === (hotspot.anchor as { entityId: string }).entityId,
              )?.locationId;
        if (!targetRoomId || !showRoom(targetRoomId)) continue;
        if (
          hotspot.anchor.kind === "entity" &&
          !this.objects.has(hotspot.anchor.entityId)
        )
          continue;
        const worldPos = resolveHotspotWorldPosition(state.home, hotspot);
        if (worldPos) this.addHotspotPin(hotspot, new THREE.Vector3(...worldPos));
      }
    }
    this.applyFocusVisibility();
    const layoutKey = JSON.stringify(state.home.rooms);
    if (
      layoutKey !== this.layoutKey ||
      focusChanged ||
      previousRooms !== [...this.visibleRooms].join(",")
    ) {
      this.layoutKey = layoutKey;
      this.reset();
    }
    if (this.inspecting && !this.objects.has(this.selection?.id ?? ""))
      this.reset();
    this.configureShadows();
    this.host.dataset.stockGlbInstances = "0";
    this.host.dataset.entities = String(visibleEntities);
    this.host.dataset.hotspots = String(this.hotspotPins.length);
    this.host.dataset.task = filter.task ?? "browse";
    this.host.dataset.pickable = [...this.objects]
      .filter(([, o]) => o.userData.interactive)
      .map(([id]) => id)
      .join(",");
    this.applyFocusVisibility();
    this.host.dataset.stockInstances = String(instances);
    this.host.dataset.rooms = String(visibleRooms);
    this.host.dataset.decorativeMeshes = String(decorativeMeshes);
    this.host.dataset.style = this.design.style;
    this.highlight();
    if (this.editor) this.refreshEditGuides();
    this.invalidate();
  }
  project(point: [number, number, number]) {
    const p = new THREE.Vector3(...point).project(this.camera);
    return {
      x: ((p.x + 1) * this.host.clientWidth) / 2,
      y: ((1 - p.y) * this.host.clientHeight) / 2,
      visible: Math.abs(p.z) < 1,
    };
  }
  private applyCyberCamera(
    width = Math.max(this.host.clientWidth, 1),
    height = Math.max(this.host.clientHeight, 1),
  ) {
    if (!this.cyberInsets || width <= 1 || height <= 1) {
      this.host.dataset.cyberInsets = "";
      this.camera.clearViewOffset();
      return;
    }
    const { top, bottom, left, right } = this.cyberInsets;
    this.host.dataset.cyberInsets = `${left},${top},${right},${bottom}`;
    this.camera.setViewOffset(
      width,
      height,
      (right - left) / 2,
      -(top - bottom) / 2,
      width,
      height,
    );
  }
  setCyber(
    enabled: boolean,
    insets?: { top: number; bottom: number; left: number; right: number },
  ) {
    const wasCyber = this.cyberEnabled;
    this.cyberEnabled = enabled;
    this.renderer.setClearColor(enabled ? 0x111e29 : 0xeeeae3);
    this.renderer.toneMappingExposure = enabled ? 0.42 : 1.05;
    this.host.classList.toggle("cyber-scene", enabled);
    let insetsChanged = false;
    if (enabled) {
      const next = insets ??
        this.cyberInsets ?? { top: 0, bottom: 0, left: 0, right: 0 };
      insetsChanged =
        !this.cyberInsets ||
        this.cyberInsets.top !== next.top ||
        this.cyberInsets.bottom !== next.bottom ||
        this.cyberInsets.left !== next.left ||
        this.cyberInsets.right !== next.right;
      this.cyberInsets = next;
    } else {
      insetsChanged = Boolean(this.cyberInsets);
      this.cyberInsets = undefined;
    }
    this.applyCyberCamera();
    if (!this.inspecting && (!wasCyber || !enabled || insetsChanged)) {
      this.camera.zoom = this.fittedZoom(this.viewBounds());
    }
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  private attention(state: Dashboard, id: string) {
    return state.incidents.some(
      (i) =>
        i.state !== "resolved" &&
        (i.subjectId === id ||
          state.home.services.some(
            (s) => s.id === i.subjectId && s.entityId === id,
          )),
    );
  }
  refreshHealth(state: Dashboard) {
    let changed = false;
    for (const [id, ring] of this.rings) {
      const attention = this.attention(state, id),
        health = observationState(entityObservation(state, id));
      const color = new THREE.Color(
        attention ? "#bd783d" : health === "up" ? "#449980" : "#9ca9af",
      );
      const visible = attention;
      if (!ring.material.color.equals(color) || ring.visible !== visible) {
        ring.material.color.copy(color);
        ring.visible = visible;
        changed = true;
      }
      const label = this.labels.find((l) => l.entityId === id);
      if (label && label.attention !== attention) {
        label.attention = attention;
        changed = true;
      }
    }
    if (changed) this.invalidate();
  }
  setPresentation(style: SceneStyle, decorative: boolean) {
    if (this.design.style === style && this.decorative === decorative) return;
    this.decorative = decorative;
    if (this.design.style !== style) {
      this.scene.remove(this.content);
      this.disposeTree(this.content);
      this.content = new THREE.Group();
      this.design.dispose();
      this.design = new SceneDesign(style);
      this.renderer.toneMappingExposure = style === "natural" ? 1.05 : 1.12;
    }
    if (this.state) this.update(this.state, this.filter);
  }
  select(selection?: SceneSelection) {
    const changed = selection?.id !== this.selection?.id;
    if (changed) this.clearOcclusion();
    const previousId = this.selection?.id;
    const previousAnchor =
      this.state && previousId
        ? focusAnchor(this.state.home, previousId)?.id
        : undefined;
    if (changed && previousId && this.inspecting)
      this.focusViews.set(previousId, {
        position: this.camera.position.clone(),
        target: this.controls.target.clone(),
        zoom: this.camera.zoom,
      });
    this.selection = selection;
    if (changed && !this.editor && this.state) {
      const stocks = "stocks" in this.state.home ? this.state.home.stocks : [];
      const all = [...this.state.home.entities, ...stocks];
      if (
        all.some(
          (i) =>
            (i.id === selection?.id || i.id === previousId) &&
            "attachment" in i &&
            i.attachment?.kind === "storage",
        )
      ) {
        const wasInspecting = this.inspecting;
        this.inspecting = false;
        this.update(this.state, this.filter);
        this.inspecting = wasInspecting;
      }
    }
    if (!this.editor && changed) {
      if (selection && this.objects.has(selection.id)) {
        if (!this.returnCamera)
          this.returnCamera = {
            position: this.camera.position.clone(),
            target: this.controls.target.clone(),
            zoom: this.camera.zoom,
          };
        // Rebuild only the selected representation, preserving the record and camera history.
        const related = this.state
          ? inspectionItems(this.state.home, selection.id)
          : new Set([selection.id]);
        for (const id of related) {
          const group = this.objects.get(id);
          if (!group || group.userData.selection?.kind !== "entity") continue;
          group.userData.forcedDetail = true;
          const visual = group.children.filter((c) => c !== this.rings.get(id));
          for (const child of visual) {
            group.remove(child);
            this.disposeTree(child);
          }
          void this.addAsset(group, group.userData.asset);
        }
        const nextAnchor = this.state
          ? focusAnchor(this.state.home, selection.id)?.id
          : selection.id;
        this.inspecting = true;
        this.host.dataset.inspecting = selection.id;
        this.applyFocusVisibility();
        const saved = this.focusViews.get(selection.id);
        if (saved)
          this.move(
            saved.target,
            saved.zoom,
            false,
            saved.position.clone().sub(saved.target),
          );
        else if (previousAnchor !== nextAnchor)
          this.fitInspection(false, false);
      } else {
        this.inspecting = false;
        this.inspectionOffset = undefined;
        this.host.dataset.inspecting = "";
        this.applyFocusVisibility();
        const previous = this.returnCamera;
        this.returnCamera = undefined;
        this.focusViews.clear();
        if (previous)
          this.move(
            previous.target,
            previous.zoom,
            false,
            previous.position.clone().sub(previous.target),
          );
      }
    }
    this.highlight();
  }
  private applyFocusVisibility() {
    for (const [id, object] of this.objects) {
      const asset = object.userData.asset as GuestAsset;
      object.visible = Boolean(
        this.editor ||
        this.filter.lights ||
        !lightKinds.has(asset.kind) ||
        id === this.selection?.id,
      );
    }
    for (const child of this.content.children)
      if (!child.userData.selection) child.visible = true;
    this.host.dataset.inspectionItems = this.inspecting
      ? [...this.objects]
          .filter(([, object]) => object.visible)
          .map(([id]) => id)
          .join(",")
      : "";
    this.host.dataset.pickable = [...this.objects]
      .filter(([, object]) => object.visible && object.userData.interactive)
      .map(([id]) => id)
      .join(",");
    this.host.dataset.focusAnchor =
      this.state && this.selection
        ? (focusAnchor(this.state.home, this.selection.id)?.id ?? "")
        : "";
    this.host.dataset.visibleObjects = [...this.objects]
      .filter(([, object]) => object.visible)
      .map(([id]) => id)
      .join(",");
    this.host.dataset.detail = this.inspecting
      ? (this.selection?.id ?? "")
      : "";
  }
  private clearOcclusion() {
    for (const [mesh, { original, faded }] of this.occluded) {
      mesh.material = original;
      for (const material of faded) material.dispose();
    }
    this.occluded.clear();
    this.host.dataset.occluders = "";
    for (const object of this.objects.values())
      object.userData.occluding = false;
  }
  private updateOcclusion() {
    this.clearOcclusion();
    if (!this.inspecting || this.editor || !this.selection) return;
    const target = this.objects.get(this.selection.id);
    if (!target) return;
    const asset = target.userData.asset as GuestAsset;
    target.updateMatrixWorld(true);
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    const installation = this.state
      ? inspectionItems(this.state.home, this.selection.id)
      : new Set([this.selection.id]);
    const candidates = [...this.objects.values()].filter(
      (o) => !installation.has(o.userData.selection.id) && o.visible,
    );
    const blockers = new Set<THREE.Object3D>();
    // Include the silhouette edges: a low foreground cabinet can cover the
    // chair's feet, or a screen can cover only the top of a round table.
    for (const x of [-0.48, -0.24, 0, 0.24, 0.48])
      for (const y of [0.02, 0.25, 0.5, 0.75, 0.98]) {
        const point = target.localToWorld(
          new THREE.Vector3(asset.width * x, asset.height * y, 0),
        );
        const ray = new THREE.Raycaster(
          point.clone().addScaledVector(direction, 30),
          direction.clone().negate(),
          0,
          29.97,
        );
        for (const hit of ray.intersectObjects(candidates, true)) {
          let object: THREE.Object3D | null = hit.object;
          if (!object.visible) continue;
          while (object && !object.userData.selection) object = object.parent;
          if (
            object?.visible &&
            object.userData.selection?.id !== this.selection.id
          )
            blockers.add(object);
        }
      }
    for (const object of blockers) {
      object.userData.occluding = true;
      object.traverse((node) => {
        if (
          !(node instanceof THREE.Mesh) ||
          this.rings.get(object.userData.selection.id) === node
        )
          return;
        const original = node.material;
        const faded = (Array.isArray(original) ? original : [original]).map(
          (material) => {
            const copy = material.clone();
            copy.transparent = true;
            copy.opacity = Math.min(material.opacity, 0.13);
            copy.depthWrite = false;
            return copy;
          },
        );
        node.material = Array.isArray(original) ? faded : faded[0];
        this.occluded.set(node, { original, faded });
      });
    }
    this.host.dataset.occluders = [...blockers]
      .map((o) => o.userData.selection.id)
      .join(",");
  }
  private highlight() {
    const object = this.selection && this.objects.get(this.selection.id);
    this.selectionMarker.visible = Boolean(object);
    if (object) {
      const bounds = new THREE.Box3().setFromObject(object),
        size = bounds.getSize(new THREE.Vector3());
      this.selectionMarker.position
        .copy(object.position)
        .add(new THREE.Vector3(0, 0.045, 0));
      this.selectionMarker.scale.set(
        Math.max(size.x, size.z) + 0.25,
        Math.max(size.x, size.z) + 0.25,
        1,
      );
    }
    if (this.transform) {
      if (this.editor && object) this.transform.attach(object);
      else this.transform.detach();
    }
    this.projectLabels();
    this.invalidate();
  }
  focus(roomId: string) {
    if (this.roomFocus !== roomId) {
      this.roomFocus = roomId;
      this.reset();
    }
  }
  setView(view: "angle" | "top") {
    if (this.view === view) return;
    this.view = view;
    this.renderer.shadowMap.needsUpdate = true;
    this.reset();
  }
  setEditing(editor?: SceneEdit) {
    this.editor = editor;
    if (editor && !this.transform) {
      const transform = new TransformControls(
        this.camera,
        this.renderer.domElement,
      );
      this.transform = transform;
      transform.setSize(0.85);
      this.scene.add(transform.getHelper(), this.editGuides);
      transform.addEventListener("dragging-changed", (event) => {
        this.controls.enabled = !event.value;
        if (event.value) {
          cancelAnimationFrame(this.transition);
          this.transformGesture = true;
        } else
          requestAnimationFrame(() => {
            this.transformGesture = false;
          });
      });
      transform.addEventListener("objectChange", () => {
        const object = transform.object;
        const selected = object?.userData.selection as
          SceneSelection | undefined;
        if (!object || !selected || !this.state) return;
        const stocks =
          "stocks" in this.state.home ? this.state.home.stocks : [];
        const record =
          selected.kind === "entity"
            ? this.state.home.entities.find((e) => e.id === selected.id)
            : stocks.find((s) => s.id === selected.id);
        const room = this.state.home.rooms.find(
          (r) => r.id === record?.locationId,
        );
        if (!record || !room) return;
        object.position.x = THREE.MathUtils.clamp(
          object.position.x,
          room.origin[0] - room.size[0] / 2,
          room.origin[0] + room.size[0] / 2,
        );
        object.position.z = THREE.MathUtils.clamp(
          object.position.z,
          room.origin[2] - room.size[1] / 2,
          room.origin[2] + room.size[1] / 2,
        );
        object.position.y = room.origin[1] + record.position[1];
        const label = this.labels.find((l) => l.entityId === selected.id);
        if (label) {
          label.position.x = object.position.x;
          label.position.z = object.position.z;
        }
        this.selectionMarker.position.x = object.position.x;
        this.selectionMarker.position.z = object.position.z;
        this.renderer.shadowMap.needsUpdate = true;
        this.invalidate();
      });
      transform.addEventListener("change", () => this.invalidate());
      transform.addEventListener("mouseUp", () => {
        const object = transform.object;
        const selected = object?.userData.selection as
          SceneSelection | undefined;
        if (!object || !selected || !this.state) return;
        const stocks =
          "stocks" in this.state.home ? this.state.home.stocks : [];
        const record =
          selected.kind === "entity"
            ? this.state.home.entities.find((e) => e.id === selected.id)
            : stocks.find((s) => s.id === selected.id);
        const room = this.state.home.rooms.find(
          (r) => r.id === record?.locationId,
        );
        if (room) {
          // TransformControls writes a quaternion. Euler.y folds back beyond
          // 90 degrees; derive the full ground-plane heading from its forward axis.
          const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(
            object.quaternion,
          );
          this.editor?.onChange(
            selected,
            object.position
              .clone()
              .sub(new THREE.Vector3(...room.origin))
              .toArray(),
            Math.atan2(forward.x, forward.z),
          );
        }
      });
    }
    if (this.transform && editor) {
      this.transform.setMode(editor.mode);
      this.transform.showX = this.transform.showZ = editor.mode === "translate";
      this.transform.showY = editor.mode === "rotate";
      this.transform.showXY =
        this.transform.showYZ =
        this.transform.showXYZE =
          false;
      this.transform.showE = false;
      this.transform.showXZ = editor.mode === "translate";
      this.transform.setTranslationSnap(editor.snap ? 0.1 : null);
      this.transform.setRotationSnap(editor.snap ? Math.PI / 12 : null);
    }
    this.editGuides.visible = Boolean(editor);
    this.highlight();
    this.refreshEditGuides();
  }
  private refreshEditGuides() {
    this.disposeTree(this.editGuides);
    this.editGuides.clear();
    if (!this.editor || !this.state) return;
    for (const room of this.state.home.rooms) {
      if (!this.visibleRooms.has(room.id)) continue;
      const [w, d] = room.size;
      const points = (
        room.footprint ?? [
          [-w / 2, -d / 2],
          [w / 2, -d / 2],
          [w / 2, d / 2],
          [-w / 2, d / 2],
        ]
      ).map(([x, z]) => new THREE.Vector3(x, 0.008, z));
      const outline = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x9baf9e,
          transparent: true,
          opacity: 0.7,
        }),
      );
      outline.position.set(...room.origin);
      this.editGuides.add(outline);
      const grid = new THREE.GridHelper(1, 10, 0xa6b5a7, 0xbac6b9);
      grid.scale.set(w, 1, d);
      grid.position.set(room.origin[0], room.origin[1] + 0.004, room.origin[2]);
      const materials = Array.isArray(grid.material)
        ? grid.material
        : [grid.material];
      for (const material of materials) {
        material.transparent = true;
        material.opacity = 0.22;
      }
      this.editGuides.add(grid);
    }
    this.invalidate();
  }
  private viewBounds() {
    const bounds = new THREE.Box3();
    const object =
      this.inspecting && this.selection && this.objects.get(this.selection.id);
    if (object && this.state && this.selection) {
      const anchor = focusAnchor(this.state.home, this.selection.id);
      const related = inspectionItems(
        this.state.home,
        anchor?.id ?? this.selection.id,
      );
      related.add(this.selection.id);
      for (const id of related) {
        const member = this.objects.get(id);
        if (!member || !member.visible) continue;
        const asset = member.userData.asset as GuestAsset;
        member.updateMatrixWorld(true);
        bounds.union(
          new THREE.Box3(
            new THREE.Vector3(-asset.width / 2, 0, -asset.depth / 2),
            new THREE.Vector3(asset.width / 2, asset.height, asset.depth / 2),
          ).applyMatrix4(member.matrixWorld),
        );
      }
      if (bounds.isEmpty()) bounds.setFromObject(object);
      const center = bounds.getCenter(new THREE.Vector3()),
        size = bounds.getSize(new THREE.Vector3());
      // The smallest normal focus is a place on a desk, never a mouse-pad-sized universe.
      size.x = Math.max(size.x + 0.5, 1.8);
      size.y = Math.max(size.y + 0.45, 1.25);
      size.z = Math.max(size.z + 0.5, 1.4);
      return bounds.setFromCenterAndSize(center, size);
    }
    if (this.editor) {
      for (const [id, room] of this.roomBounds)
        if (this.visibleRooms.has(id)) bounds.union(room);
      if (!bounds.isEmpty()) return bounds;
    }
    // Without architectural shells, frame the visible arrangement rather than
    // the empty corners of the configured room rectangles.
    for (const member of this.objects.values())
      if (member.visible) bounds.union(new THREE.Box3().setFromObject(member));
    if (!bounds.isEmpty()) return bounds.expandByScalar(0.3);
    if (this.roomBounds.has(this.roomFocus))
      bounds.copy(this.roomBounds.get(this.roomFocus)!);
    else
      for (const [id, room] of this.roomBounds)
        if (this.visibleRooms.has(id)) bounds.union(room);
    return bounds;
  }
  private fittedZoom(bounds: THREE.Box3) {
    if (bounds.isEmpty()) return 1;
    this.camera.updateMatrixWorld(true);
    const projected = new THREE.Box3();
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z])
          projected.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(
              this.camera.matrixWorldInverse,
            ),
          );
    const size = projected.getSize(new THREE.Vector3());
    const width = Math.max(this.host.clientWidth, 1),
      height = Math.max(this.host.clientHeight, 1);
    const openWFrac = this.cyberInsets
      ? THREE.MathUtils.clamp(
          (width - this.cyberInsets.left - this.cyberInsets.right) / width,
          0.42,
          0.98,
        )
      : 1;
    const openHFrac = this.cyberInsets
      ? THREE.MathUtils.clamp(
          (height - this.cyberInsets.top - this.cyberInsets.bottom) / height,
          0.42,
          0.98,
        )
      : 1;
    return THREE.MathUtils.clamp(
      Math.min(
        ((this.camera.right - this.camera.left) / size.x) * openWFrac,
        ((this.camera.top - this.camera.bottom) / size.y) * openHFrac,
      ) * (this.inspecting ? 0.65 : this.cyberInsets ? 0.96 : 0.86),
      0.2,
      this.inspecting ? 360 : 24,
    );
  }
  private configureShadows() {
    const bounds = new THREE.Box3();
    for (const [id, room] of this.roomBounds)
      if (this.visibleRooms.has(id)) bounds.union(room);
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3()),
      size = bounds.getSize(new THREE.Vector3());
    const reach = Math.max(size.x, size.z) * 0.7 + 3;
    this.sun.position.copy(center).add(new THREE.Vector3(-6, 14, 9));
    this.sun.target.position.copy(center);
    Object.assign(this.sun.shadow.camera, {
      left: -reach,
      right: reach,
      top: reach,
      bottom: -reach,
      near: 0.1,
      far: 80,
    });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = true;
  }
  private viewOffset() {
    if (this.view === "top") return new THREE.Vector3(0, 22, 0.01);
    // Keep a long rectangular home along the portrait screen's long axis.
    // This only changes the viewing direction, never saved placement.
    if (innerWidth / innerHeight < 0.75) {
      const size = new THREE.Box3()
        .setFromObject(this.content)
        .getSize(new THREE.Vector3());
      if (size.z > size.x * 1.8) return new THREE.Vector3(4, 26, 18);
      if (size.x > size.z * 1.8) return new THREE.Vector3(18, 26, 4);
      return new THREE.Vector3(20, 24, 8);
    }
    return new THREE.Vector3(12, 13, 18);
  }
  private move(
    target: THREE.Vector3,
    zoom: number,
    immediate = false,
    explicitOffset?: THREE.Vector3,
  ) {
    cancelAnimationFrame(this.transition);
    const fromTarget = this.controls.target.clone(),
      fromCamera = this.camera.position.clone(),
      fromZoom = this.camera.zoom;
    const offset = explicitOffset ?? this.inspectionOffset ?? this.viewOffset();
    const destination = target.clone().add(offset);
    const start = performance.now();
    const duration =
      immediate || matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : 320;
    const step = () => {
      const t = duration
        ? Math.min((performance.now() - start) / duration, 1)
        : 1;
      const ease = t * t * (3 - 2 * t);
      this.controls.target.lerpVectors(fromTarget, target, ease);
      this.camera.position.lerpVectors(fromCamera, destination, ease);
      this.camera.zoom = THREE.MathUtils.lerp(fromZoom, zoom, ease);
      this.camera.updateProjectionMatrix();
      this.controls.update();
      this.invalidate();
      if (t < 1 && !this.disposed)
        this.transition = requestAnimationFrame(step);
    };
    step();
  }
  reset() {
    this.inspecting = false;
    this.inspectionOffset = undefined;
    this.returnCamera = undefined;
    this.applyFocusVisibility();
    this.host.dataset.inspecting = "";
    const bounds = this.viewBounds(),
      target = bounds.isEmpty()
        ? new THREE.Vector3()
        : bounds.getCenter(new THREE.Vector3());
    // Fit with the destination orientation, then restore the current camera for the transition.
    const position = this.camera.position.clone(),
      quaternion = this.camera.quaternion.clone();
    this.camera.position.copy(target).add(this.viewOffset());
    this.camera.lookAt(target);
    const zoom = this.fittedZoom(bounds);
    this.camera.position.copy(position);
    this.camera.quaternion.copy(quaternion);
    this.move(target, zoom, this.frame === 0);
  }
  private fitInspection(immediate = false, front = true) {
    if (!this.selection) return;
    const object = this.objects.get(this.selection.id);
    if (!object) return;
    const asset = object.userData.asset as GuestAsset;
    const angle = object.rotation.y + frontAngle(asset);
    const anchor = this.state
      ? focusAnchor(this.state.home, this.selection.id)
      : undefined;
    const support = anchor && this.objects.get(anchor.id);
    const current = this.camera.position.clone().sub(this.controls.target);
    const approachAsset = (support?.userData.asset ?? asset) as GuestAsset;
    const directionless =
      approachAsset.front === undefined &&
      ["round-storage-table", "mug", "beanbag", "rug"].includes(
        approachAsset.kind,
      );
    const approachAngle =
      !front && directionless
        ? Math.atan2(current.x, current.z)
        : !front && support
          ? support.rotation.y +
            frontAngle(support.userData.asset as GuestAsset)
          : angle;
    const elevation = front
      ? 0
      : THREE.MathUtils.clamp(
          current.y / Math.max(0.01, Math.hypot(current.x, current.z)),
          0.25,
          0.85,
        ) * 5;
    this.inspectionOffset = new THREE.Vector3(
      Math.sin(approachAngle) * 5,
      elevation,
      Math.cos(approachAngle) * 5,
    );
    const bounds = this.viewBounds(),
      target = bounds.getCenter(new THREE.Vector3());
    const position = this.camera.position.clone(),
      quaternion = this.camera.quaternion.clone();
    this.camera.position.copy(target).add(this.inspectionOffset);
    this.camera.lookAt(target);
    const zoom = this.fittedZoom(bounds);
    this.camera.position.copy(position);
    this.camera.quaternion.copy(quaternion);
    this.move(target, zoom, immediate);
  }
  inspect() {
    if (!this.selection || !this.objects.has(this.selection.id)) return;
    this.inspecting = true;
    this.host.dataset.inspecting = this.selection.id;
    this.applyFocusVisibility();
    this.fitInspection();
  }
  zoom(factor: number) {
    cancelAnimationFrame(this.transition);
    this.camera.zoom = THREE.MathUtils.clamp(
      this.camera.zoom * factor,
      0.2,
      this.inspecting ? 360 : 24,
    );
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  private disposeTree(object: THREE.Object3D, shared = false) {
    object.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
      if (!shared && o.userData.shared) return;
      if (
        o instanceof THREE.Mesh ||
        o instanceof THREE.Line ||
        o instanceof THREE.Sprite
      ) {
        if ("geometry" in o) o.geometry.dispose();
        for (const material of Array.isArray(o.material)
          ? o.material
          : [o.material]) {
          if (material.userData.managedByDesign) continue;
          if (shared)
            for (const value of Object.values(material))
              if (value instanceof THREE.Texture) {
                (value.source.data as { close?: () => void })?.close?.();
                value.dispose();
              }
          material.dispose();
        }
      }
    });
  }
  dispose() {
    this.disposed = true;
    this.controller.abort();
    cancelAnimationFrame(this.scheduled);
    cancelAnimationFrame(this.transition);
    this.observer.disconnect();
    this.controls.dispose();
    this.transform?.dispose();
    this.disposeTree(this.editGuides);
    this.draco.dispose();
    this.ktx.dispose();
    this.clearOcclusion();
    this.disposeTree(this.content);
    this.assetRoots.forEach((r) => this.disposeTree(r, true));
    this.design.dispose();
    this.environment.dispose();
    this.sun.shadow.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.selectionMarker.geometry.dispose();
    this.selectionMarker.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
    this.assetWarning.remove();
  }
}
