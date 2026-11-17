import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export interface ModelInfo {
  meshes: number;
  triangles: number;
  animations: number;
  sourceSize?: [number, number, number];
}
export class Viewer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100);
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;
  readonly grid = new THREE.GridHelper(12, 24, 0x53606c, 0x303c46);
  readonly key = new THREE.DirectionalLight(0xffffff, 3);
  private readonly loader = new GLTFLoader();
  private readonly draco = new DRACOLoader().setDecoderPath("/vendor/draco/");
  private readonly ktx: KTX2Loader;
  private readonly environment?: THREE.WebGLRenderTarget;
  private scheduled = 0;
  private disposed = false;
  private readonly observer: ResizeObserver;
  private readonly selection = new THREE.BoxHelper(
    new THREE.Object3D(),
    0xa8ecd0,
  );
  private readonly clock = new THREE.Clock();
  private mixer?: THREE.AnimationMixer;
  private model?: THREE.Group;
  private ticket = 0;
  private wireframe = false;
  private info: ModelInfo = { meshes: 0, triangles: 0, animations: 0 };

  constructor(
    readonly host: HTMLElement,
    onSelect: (name: string) => void,
    onLost: () => void,
    readonly options: { onDemand?: boolean; simpleLighting?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setClearColor(0x171f27);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D 模型视图：拖动旋转，滚轮缩放，点击选择部件",
    );
    this.renderer.domElement.tabIndex = 0;
    host.append(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !options.onDemand;
    this.controls.addEventListener("change", () => this.invalidate());
    this.controls.minDistance = 1;
    this.controls.maxDistance = 12;
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.ktx = new KTX2Loader()
      .setTranscoderPath("/vendor/basis/")
      .detectSupport(this.renderer);
    this.loader
      .setDRACOLoader(this.draco)
      .setKTX2Loader(this.ktx)
      .setMeshoptDecoder(MeshoptDecoder);
    if (!options.simpleLighting) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environment = pmrem.fromScene(room, 0.04);
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.8;
      room.dispose();
      pmrem.dispose();
    }
    this.key.position.set(3, 5, 4);
    if (options.simpleLighting) {
      const fill = new THREE.DirectionalLight(0xeef6ff, 1.1);
      fill.position.set(-3, 2, -4);
      this.scene.add(fill);
    }
    this.scene.add(
      this.key,
      new THREE.HemisphereLight(0xd5e9ff, 0x4b4850, 1.3),
      this.grid,
      this.selection,
    );
    this.selection.visible = false;
    this.reset();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.renderer.setAnimationLoop(null);
      onLost();
    });
    let pointerStart = new THREE.Vector2();
    this.renderer.domElement.addEventListener("pointerdown", (event) => {
      pointerStart = new THREE.Vector2(event.clientX, event.clientY);
    });
    this.renderer.domElement.addEventListener("pointerup", (event) => {
      if (
        !this.model ||
        pointerStart.distanceTo(
          new THREE.Vector2(event.clientX, event.clientY),
        ) > 5
      )
        return;
      const rect = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = ray.intersectObject(this.model, true)[0];
      this.selection.visible = Boolean(hit);
      if (hit) this.selection.setFromObject(hit.object);
      onSelect(hit ? hit.object.name || "未命名部件" : "未选择部件");
      this.invalidate();
    });
    if (!options.onDemand)
      this.renderer.setAnimationLoop(() => {
        this.mixer?.update(Math.min(this.clock.getDelta(), 0.1));
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        // Small observable diagnostics for browser checks; no app/credential state.
        host.dataset.frames = String(this.renderer.info.render.frame);
        host.dataset.triangles = String(this.renderer.info.render.triangles);
        host.dataset.camera = this.camera.position
          .toArray()
          .map((n) => n.toFixed(3))
          .join(",");
        host.dataset.distance = this.camera.position
          .distanceTo(this.controls.target)
          .toFixed(3);
      });
  }
  private invalidate() {
    if (!this.options.onDemand || this.scheduled || this.disposed) return;
    this.scheduled = requestAnimationFrame(() => {
      this.scheduled = 0;
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
      this.host.dataset.frames = String(this.renderer.info.render.frame);
      this.host.dataset.triangles = String(this.renderer.info.render.triangles);
    });
  }
  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }
  async load(
    source: string | ArrayBuffer | Promise<ArrayBuffer>,
  ): Promise<ModelInfo | undefined> {
    const current = ++this.ticket;
    const resolved = await source;
    if (current !== this.ticket) return;
    const gltf =
      typeof resolved === "string"
        ? await this.loader.loadAsync(resolved)
        : await this.loader.parseAsync(resolved, "");
    if (current !== this.ticket) {
      this.disposeModel(gltf.scene);
      return;
    }
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = 2.4 / Math.max(size.x, size.y, size.z);
    const info: ModelInfo = {
      meshes: 0,
      triangles: 0,
      animations: gltf.animations.length,
      sourceSize: [size.x, size.y, size.z],
    };
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        info.meshes++;
        info.triangles +=
          (object.geometry.index?.count ??
            object.geometry.attributes.position?.count ??
            0) / 3;
      }
    });
    if (!Number.isFinite(scale) || box.isEmpty() || !info.meshes) {
      this.disposeModel(gltf.scene);
      throw new Error("GLB has no visible mesh geometry.");
    }
    const wrapper = new THREE.Group();
    wrapper.add(gltf.scene);
    wrapper.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    wrapper.position.set(
      -center.x * scale,
      -box.min.y * scale + 0.02,
      -center.z * scale,
    );
    if (this.model) {
      this.mixer?.stopAllAction();
      this.scene.remove(this.model);
      this.disposeModel(this.model);
    }
    this.model = wrapper;
    this.info = info;
    this.scene.add(wrapper);
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    for (const clip of gltf.animations) this.mixer.clipAction(clip).play();
    this.selection.visible = false;
    this.setWireframe(this.wireframe);
    this.reset();
    this.host.dataset.meshes = String(info.meshes);
    this.invalidate();
    return info;
  }
  reset() {
    // Consume any pending OrbitControls damping before applying the home pose.
    const damping = this.controls.enableDamping;
    const autoRotate = this.controls.autoRotate;
    this.controls.enableDamping = false;
    this.controls.autoRotate = false;
    this.controls.update();
    this.camera.position.set(3.6, 2.7, 4.7);
    this.controls.target.set(0, 1.1, 0);
    this.controls.update();
    this.camera.updateMatrixWorld();
    this.controls.enableDamping = damping;
    this.controls.autoRotate = autoRotate;
  }
  inspectOrientation(modelYaw: number, front: number) {
    if (!this.model) return;
    this.model.rotation.y = 0;
    this.model.position.set(0, 0, 0);
    this.model.rotation.y = modelYaw;
    this.model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model);
    const center = bounds.getCenter(new THREE.Vector3());
    this.model.position.set(-center.x, -bounds.min.y + 0.02, -center.z);
    const height = bounds.max.y - bounds.min.y;
    this.controls.target.set(0, height / 2 + 0.02, 0);
    this.camera.position
      .copy(this.controls.target)
      .add(new THREE.Vector3(Math.sin(front) * 4.6, 0, Math.cos(front) * 4.6));
    this.controls.update();
    this.invalidate();
  }
  zoom(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, 1, 12));
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  rotate() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 8);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }
  light(value: number) {
    this.key.intensity = value;
    this.scene.environmentIntensity = value / 4;
    this.host.dataset.light = String(value);
    this.invalidate();
  }
  setWireframe(value: boolean) {
    this.wireframe = value;
    this.model?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          if ("wireframe" in material) material.wireframe = value;
        }
      }
    });
  }
  get statistics() {
    return this.info;
  }
  private disposeModel(group: THREE.Object3D) {
    const textures = new Set<THREE.Texture>();
    const materials = new Set<THREE.Material>();
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) textures.add(value);
        }
      }
    });
    textures.forEach((texture) => {
      (texture.source.data as { close?: () => void } | undefined)?.close?.();
      texture.dispose();
    });
    materials.forEach((material) => material.dispose());
  }
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.scheduled);
    ++this.ticket;
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.controls.dispose();
    this.draco.dispose();
    this.ktx.dispose();
    if (this.model) this.disposeModel(this.model);
    this.environment?.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
