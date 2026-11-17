import { v4 as randomUUID } from "uuid";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  Box,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  Cpu,
  Eye,
  House,
  Layers,
  LoaderCircle,
  LogOut,
  MapPin,
  ArrowLeft,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Unplug,
  X,
} from "lucide-react";
import {
  HomeScene,
  type SceneSelection,
  type SceneFilter,
  type SurfacePickHit,
} from "./home-scene.js";
import {
  TaskOverview,
  StoragePanel,
  PlacementPanel,
  taskNames,
} from "./spatial-panels.js";
import { ServiceBadgeIcon } from "./service-icon.js";
import { installBrowserWebMcp } from "./web-mcp.js";
import { builtinServiceIcons } from "../shared/icons.js";
import {
  eligible,
  isStorage,
  isSurface,
  planSurface,
  planFloor,
  type TaskMode,
  type SpatialItem,
} from "../shared/spatial.js";
import { CaptureScene } from "./capture-scene.js";
import { ModelAttribution, ModelLibrary } from "./model-library.js";
import type { ImportedModel, ModelSource } from "../shared/model-source.js";
import { LayoutEditor } from "./layout-editor.js";
import "./worlds.css";
import { QuickRecord, PhotoGallery, PhotoEditor } from "./possession.js";
import { CabinetEditor } from "./cabinet-editor.js";
import { Viewer } from "./viewer.js";
import type { SceneStyle } from "./scene-design.js";
import {
  command,
  initialize,
  logoutAdmin,
  pendingCommand,
  retryPending,
  request,
  type Generation,
  type ProviderInfo,
} from "./api.js";
import { BRAND_FULL, SameRoomLogo } from "./brand.js";
import {
  resizedRoom,
  entityObservation,
  observationState,
  type Action,
  type Dashboard,
  type Entity,
  type HomeTemplate,
  type SceneAsset,
  type Service,
  type Stock,
} from "../shared/domain.js";
import {
  resolveHotspotWorldPosition,
  type Hotspot,
} from "../shared/guest.js";
import { GuestApp } from "./guest-app.js";
import { HotspotEffectOverlay } from "./hotspot-effects.js";
import { EntityGuestSection, HotspotManager } from "./hotspot-admin.js";
import "./hotspot-effects.css";
import "./dashboard.css";

const categories = [
  { id: "all", label: "全部" },
  { id: "host", label: "主机" },
  { id: "device", label: "物联" },
  { id: "stock", label: "库存" },
  { id: "object", label: "物件" },
];
const phaseNames: Record<string, string> = {
  submitting: "正在提交",
  uncertain: "提交结果待核实",
  submitted: "排队中",
  running: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  canceled: "已取消",
};
const healthNames = {
  unknown: "未接入监控",
  stale: "数据已过期",
  up: "可用",
  down: "需要注意",
};
function Icon({ type }: { type: string }) {
  return type === "remote" ? (
    <Cloud size={16} />
  ) : type === "stock" ? (
    <Boxes size={16} />
  ) : type === "device" ? (
    <Unplug size={16} />
  ) : type === "object" ? (
    <Box size={16} />
  ) : (
    <Cpu size={16} />
  );
}
function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className={`modal ${wide ? "wide" : ""} ${className}`}
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button className="icon-button" aria-label="关闭面板" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SpacePanel({
  title,
  side = "left",
  onClose,
  onBack,
  tools,
  children,
}: {
  tools?: ReactNode;
  title: string;
  side?: "left" | "right";
  onClose: () => void;
  onBack?: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = panel.current!;
    (element.querySelector<HTMLElement>("[data-autofocus]") ?? element).focus({
      preventScroll: true,
    });
    return () => {
      if (element.contains(document.activeElement)) {
        const destination = previous?.isConnected
          ? previous
          : document.querySelector<HTMLElement>(".space-launcher");
        destination?.focus({ preventScroll: true });
      }
    };
  }, []);
  return (
    <section
      ref={panel}
      className={`space-panel ${side === "right" ? "detail-panel" : "navigation-panel"}`}
      role="dialog"
      aria-label={title}
      tabIndex={-1}
    >
      <div className="space-panel-heading">
        {onBack && (
          <button
            className="icon-button"
            aria-label={side === "right" ? "返回上级视图" : "返回共在中枢"}
            onClick={onBack}
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h2>{title}</h2>
        {tools}
        <button
          className="icon-button"
          aria-label={side === "right" ? "取消选择" : "关闭空间面板"}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </section>
  );
}

function Preview({
  url,
  onSize,
  yaw = 0,
  front = 0,
}: {
  url: string;
  yaw?: number;
  front?: number;
  onSize: (size: [number, number, number]) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | undefined>(undefined);
  const orientation = useRef({ yaw, front });
  orientation.current = { yaw, front };
  const callback = useRef(onSize);
  callback.current = onSize;
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState("");
  const [stats, setStats] = useState<{ meshes: number; triangles: number }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let viewer: Viewer | undefined;
    setStatus("loading");
    setError("");
    setStats(undefined);
    try {
      viewer = new Viewer(
        host.current!,
        () => {},
        () => {
          if (!active) return;
          setStatus("error");
          setError("3D 预览上下文中断，请重试加载。");
        },
        { onDemand: true, simpleLighting: true },
      );
      viewerRef.current = viewer;
      void viewer
        .load(url)
        .then((info) => {
          if (!active) return;
          if (info?.sourceSize) callback.current(info.sourceSize);
          if (info)
            setStats({
              meshes: info.meshes,
              triangles: Math.round(info.triangles),
            });
          viewer?.inspectOrientation(
            (orientation.current.yaw * Math.PI) / 180,
            (orientation.current.front * Math.PI) / 180,
          );
          setStatus("ready");
        })
        .catch(() => {
          if (!active) return;
          setStatus("error");
          setError("无法加载此 3D 模型，请检查 GLB 文件或网络连接。");
        });
    } catch {
      setStatus("error");
      setError("当前浏览器无法创建 WebGL 预览。");
    }
    return () => {
      active = false;
      viewer?.dispose();
      viewerRef.current = undefined;
    };
  }, [url, attempt]);
  useEffect(
    () =>
      viewerRef.current?.inspectOrientation(
        (yaw * Math.PI) / 180,
        (front * Math.PI) / 180,
      ),
    [yaw, front],
  );
  return (
    <div className="asset-preview" data-meshes={stats?.meshes}>
      <div className="asset-preview-canvas" ref={host} />
      {status === "loading" && (
        <div className="preview-overlay" role="status">
          <LoaderCircle className="spin" size={24} />
          <span>正在加载 3D 模型…</span>
        </div>
      )}
      {status === "ready" && stats && (
        <span className="preview-badge">
          {stats.meshes} 部件 · {stats.triangles.toLocaleString()} 三角面
        </span>
      )}
      {status === "error" && (
        <div className="preview-overlay is-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary"
            onClick={() => setAttempt((a) => a + 1)}
          >
            重试加载
          </button>
        </div>
      )}
    </div>
  );
}
function Capture({
  state,
  mutate,
  onClose,
  onSaved,
  notify,
  initialTarget = "entity",
  onQuick,
}: {
  onQuick: () => void;
  initialTarget?: string;
  state: Dashboard;
  mutate: (a: Action, revision?: number) => Promise<void>;
  onSaved: (selection: SceneSelection, isNew: boolean) => void;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [sourceMode, setSourceMode] = useState<"photo" | "market" | "local">(
    "photo",
  );
  const [draftId] = useState(() => randomUUID());
  const [saveError, setSaveError] = useState("");
  const submitted = useRef<Action | undefined>(undefined);
  const [provider, setProvider] = useState<"lux3d" | "fixture">("lux3d");
  const [imports, setImports] = useState<ImportedModel[]>([]);
  const [imported, setImported] = useState<ImportedModel>();
  const [yaw, setYaw] = useState(0);
  const [front, setFront] = useState(0);
  const [category, setCategory] = useState<"object" | "device" | "host">(
    "object",
  );
  const [supportId, setSupportId] = useState("");
  const [info, setInfo] = useState<ProviderInfo>();
  const [uploads, setUploads] = useState<
    { id: string; url: string; name: string }[]
  >([]);
  const [jobs, setJobs] = useState<Generation[]>([]);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("我的新物件");
  const [width, setWidth] = useState(30);
  const [room, setRoom] = useState(
    state.home.rooms.find((r) => r.kind === "unplaced")?.id ??
      state.home.rooms[0].id,
  );
  const [size, setSize] = useState<[number, number, number]>();
  const [target, setTarget] = useState(initialTarget);
  const [assetKind, setAssetKind] = useState<SceneAsset["kind"]>("glb");
  const [taskId, setTaskId] = useState("");
  const [history, setHistory] = useState("");
  const [version, setVersion] = useState("G1-Turbo");
  const [pollPaused, setPollPaused] = useState(false);
  const polls = useRef(0);
  useEffect(() => {
    polls.current = 0;
    setPollPaused(false);
  }, [selected]);
  const selectedJob = jobs.find((j) => j.name === selected);
  const url =
    imported?.url ?? selectedJob?.assets.find((a) => a.format === "glb")?.url;
  useEffect(() => {
    setSize(undefined);
    if (url) setStep(1);
  }, [url]);
  async function reload() {
    setJobs((await request<Generation[]>("/generations")).reverse());
  }
  useEffect(() => {
    void request<ProviderInfo>("/providers")
      .then(setInfo)
      .catch((e) => notify(e.message));
    void reload().catch((e) => notify(e.message));
    void request<ImportedModel[]>("/assets/imports")
      .then(setImports)
      .catch((e) => notify(e.message));
  }, []);
  async function refresh(job: Generation) {
    try {
      await request(`/generations/${job.name}/refresh`, {});
      await reload();
    } catch (e) {
      setPollPaused(true);
      notify((e as Error).message);
      await reload().catch(() => {});
    }
  }
  useEffect(() => {
    if (
      pollPaused ||
      !selectedJob ||
      !["submitted", "running"].includes(selectedJob.phase)
    )
      return;
    const timer = setInterval(() => {
      if (++polls.current > 120) {
        setPollPaused(true);
        return;
      }
      void refresh(selectedJob);
    }, 15000);
    return () => clearInterval(timer);
  }, [selectedJob?.name, selectedJob?.phase, pollPaused]);
  async function uploadFiles(files: File[]) {
    if (!files.length || busy) return;
    if (uploads.length + files.length > 32) {
      notify("同一物品最多选择 32 张照片，请先移除多余视角。");
      return;
    }
    setBusy(true);
    try {
      const added: typeof uploads = [];
      for (const file of files) {
        const form = new FormData();
        form.append("image", file);
        const uploaded = await request<{ id: string; url: string }>(
          "/uploads",
          form,
        );
        added.push({ ...uploaded, name: file.name });
      }
      setUploads((previous) => [...previous, ...added]);
      setSelected(undefined);
      setImported(undefined);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function changeViews(next: typeof uploads) {
    setUploads(next);
    setSelected(undefined);
    setImported(undefined);
  }
  function chooseImported(model: ImportedModel) {
    setImported(model);
    setSelected(undefined);
    setName(model.name.replace(/\.glb$/i, ""));
    setStep(1);
  }
  async function importFile(file: File, source?: ModelSource) {
    setBusy(true);
    try {
      const form = new FormData();
      form.append("model", file);
      if (source) form.append("source", JSON.stringify(source));
      const model = await request<ImportedModel>("/assets/import", form);
      setImports((previous) => [
        model,
        ...previous.filter((item) => item.id !== model.id),
      ]);
      chooseImported(model);
    } finally {
      setBusy(false);
    }
  }
  async function generate() {
    if (!uploads.length || busy) return;
    setBusy(true);
    try {
      const job = await request<Generation>("/generations", {
        name: "capture-" + randomUUID(),
        uploadIds: uploads.map((view) => view.id),
        providerId: provider,
        params: {
          version,
          faceCount: 10000,
          outputFormat: ["glb"],
          enablePbr: true,
          aiPredictSize: false,
        },
      });
      setImported(undefined);
      setSelected(job.name);
      await reload();
      if (provider === "fixture") await refresh(job);
      notify(
        job.phase === "uncertain"
          ? "该输入已有待核实任务，请先恢复原任务。"
          : "任务已记录。可以关闭面板，稍后继续。",
      );
    } catch (e) {
      notify((e as Error).message);
      await reload();
    } finally {
      setBusy(false);
    }
  }
  const supports = state.home.entities.filter(
    (e) =>
      e.scope === "home" &&
      e.lifecycle === "active" &&
      e.visibility !== "editing" &&
      e.attachment?.kind !== "storage" &&
      isSurface(state.home, e) &&
      state.home.rooms.find((r) => r.id === e.locationId)?.kind === "room",
  );
  const draft = useMemo(() => {
    if (
      !url ||
      (!selectedJob && !imported) ||
      !size ||
      !name.trim() ||
      !Number.isFinite(width) ||
      width < 1 ||
      width > 1000
    )
      return undefined;
    const w = width / 100,
      angle = (yaw * Math.PI) / 180;
    const sourceWidth =
      Math.abs(Math.cos(angle)) * size[0] + Math.abs(Math.sin(angle)) * size[2];
    const sourceDepth =
      Math.abs(Math.sin(angle)) * size[0] + Math.abs(Math.cos(angle)) * size[2];
    if (sourceWidth <= 0) return undefined;
    const asset: SceneAsset = {
      id: "asset-" + draftId,
      name: name.trim(),
      kind: assetKind,
      url,
      ...(assetKind !== "glb" ? { detailUrl: url } : {}),
      width: w,
      height: (w * size[1]) / sourceWidth,
      depth: (w * sourceDepth) / sourceWidth,
      modelRotation: angle,
      front: (front * Math.PI) / 180,
      color: "#dcb573",
      provenance: imported
        ? "Imported local GLB; dimensions adjusted by user"
        : `${selectedJob!.providerId} / ${selectedJob!.name}; dimensions adjusted by user`,
      source: imported?.source,
    };
    const support = state.home.entities.find((e) => e.id === supportId);
    const location = state.home.rooms.find(
      (r) => r.id === (support?.locationId ?? room),
    );
    if (!location) return undefined;
    const entity: Entity = {
      id: "object-" + draftId,
      name: name.trim(),
      category,
      scope: location.kind === "remote" ? "remote" : "home",
      lifecycle: "active",
      locationId: location.id,
      position: [0, 0, 0],
      rotation: 0,
      placementConfirmed: location.kind === "room",
      assetId: asset.id,
      description:
        selectedJob?.providerId === "fixture"
          ? "离线流程示例；模型与照片无关。"
          : imported
            ? "导入的本地模型；尺寸经手工调整。"
            : "由照片生成的近似外观；尺寸经手工调整。",
      notes: "",
      tags: [],
      source: selectedJob?.providerId === "fixture" ? "sample" : "user",
      asOf: new Date().toISOString().slice(0, 10),
    };
    const home = {
      ...state.home,
      entities: [
        ...state.home.entities.filter((e) => e.id !== entity.id),
        entity,
      ],
      assets: [...state.home.assets.filter((a) => a.id !== asset.id), asset],
    };
    let error = "";
    try {
      const plan = supportId
        ? planSurface(home, entity.id, supportId)
        : location.kind === "room"
          ? planFloor(home, entity.id, location.id)
          : undefined;
      if (plan) {
        entity.position = plan.position;
        entity.rotation = plan.rotation;
      }
      if (supportId)
        entity.attachment = { parentId: supportId, kind: "surface" };
    } catch (e) {
      error = (e as Error).message;
    }
    return { asset, entity, error, state: { ...state, home } };
  }, [
    state,
    url,
    selectedJob,
    imported,
    size,
    name,
    width,
    yaw,
    front,
    assetKind,
    category,
    supportId,
    room,
    draftId,
  ]);
  const frozen = Boolean(submitted.current);
  const photoUrls =
    !imported && selectedJob
      ? (
          selectedJob.uploadIds ??
          (selectedJob.uploadId ? [selectedJob.uploadId] : [])
        ).map((id) => `/api/uploads/${id}`)
      : [];
  function finish(action: Action) {
    if (action.type === "object.capture")
      onSaved({ kind: "entity", id: action.entity.id }, true);
    else if (action.type === "object.model")
      onSaved({ kind: "entity", id: action.entityId }, false);
    else if (action.type === "stock.asset")
      onSaved({ kind: "stock", id: action.stockId }, false);
  }
  async function place() {
    if (!draft || busy) return;
    setBusy(true);
    setSaveError("");
    let action = submitted.current;
    try {
      if (!action) {
        if (target === "entity") {
          if (draft.error) throw new Error(draft.error);
          action = {
            type: "object.capture",
            asset: draft.asset,
            entity: draft.entity,
            ...(supportId ? { supportId } : {}),
          };
        } else if (target.startsWith("existing:")) {
          const existing = state.home.entities.find(
            (e) => e.id === target.slice(9),
          );
          const original = state.home.assets.find(
            (a) => a.id === existing?.assetId,
          );
          if (!existing || !original)
            throw new Error("原物品已变化，请返回重新选择。");
          action = {
            type: "object.model",
            entityId: existing.id,
            asset: {
              ...original,
              id: draft.asset.id,
              detailUrl: url,
              modelRotation: draft.asset.modelRotation,
              front: draft.asset.front,
              provenance: draft.asset.provenance,
              source: draft.asset.source,
            },
          };
        } else
          action = { type: "stock.asset", stockId: target, asset: draft.asset };
        submitted.current = action;
      }
      // A committed capture observed through SSE must never be created a second time.
      const createdId =
        action.type === "object.capture" ? action.entity.id : undefined;
      if (createdId && state.home.entities.some((e) => e.id === createdId)) {
        if (pendingCommand()) await retryPending();
      } else await mutate(action, state.revision);
      finish(action);
    } catch (e) {
      setSaveError((e as Error).message);
      const createdId =
        action?.type === "object.capture" ? action.entity.id : undefined;
      if (
        !pendingCommand() &&
        !(createdId && state.home.entities.some((e) => e.id === createdId))
      )
        submitted.current = undefined;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="把真实物件带进来"
      subtitle={
        [
          sourceMode === "market"
            ? "找一件熟悉的物品，把合适的模型带回自己的小世界。"
            : sourceMode === "local"
              ? "已有的模型，也能拥有位置和故事。"
              : "从一件喜欢的东西开始。照片生成需要等待，已有结果可以直接继续。",
          "认得出它吗？旋转、靠近检查，再确认大小。",
          "给它一个位置。确认前只是预览，周围仍是你的家。",
        ][step]
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
      className="capture-modal"
    >
      <ol className="capture-steps" aria-label="录入步骤">
        {["带一件进来", "检查外观", "放进小世界"].map((label, i) => (
          <li
            key={label}
            aria-current={step === i ? "step" : undefined}
            className={i <= step ? "reached" : ""}
          >
            <span>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {saveError && (
        <p className="notice" role="alert">
          {saveError}
        </p>
      )}
      {frozen && (
        <div className="notice" role="status">
          正在核实这次保存。继续会沿用原操作，不会重复录入。
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void place()}
          >
            确认这次录入结果
          </button>
        </div>
      )}
      {step === 0 && (
        <>
          <div className="capture-sources" role="group" aria-label="物品来源">
            <button disabled={busy || frozen} onClick={onQuick}>
              文字 / 照片记录
            </button>
            {(
              [
                ["photo", "拍照生成", Camera],
                ["market", "寻找现成模型", Search],
                ["local", "本地导入", Box],
              ] as const
            ).map(([value, label, SourceIcon]) => (
              <button
                key={value}
                aria-pressed={sourceMode === value}
                disabled={busy}
                onClick={() => setSourceMode(value)}
              >
                <SourceIcon size={17} />
                {label}
              </button>
            ))}
          </div>
          {sourceMode !== "photo" ? (
            <ModelLibrary
              market={sourceMode === "market"}
              imports={imports}
              busy={busy}
              initialQuery={
                state.home.entities.find(
                  (e) => initialTarget === `existing:${e.id}`,
                )?.name ?? ""
              }
              onImport={importFile}
              onSelect={chooseImported}
            />
          ) : (
            <div className="capture-grid">
              <section>
                <label className="upload-zone capture-upload">
                  {uploads.length ? (
                    <>
                      <img src={uploads[0].url} alt="已选择的物品照片" />
                      <span>继续添加同一物品的其他视角</span>
                    </>
                  ) : (
                    <>
                      <Camera size={34} />
                      <strong>拍照或选择照片</strong>
                      <span>同一物品 1–32 张 · 每张最多 12 MB</span>
                    </>
                  )}
                  <input
                    aria-label="物品照片"
                    type="file"
                    multiple
                    disabled={busy}
                    accept="image/jpeg,image/png,image/webp,image/heic"
                    capture="environment"
                    onChange={(e) => {
                      void uploadFiles(Array.from(e.target.files ?? []));
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploads.length > 0 && (
                  <>
                    <p className="muted">
                      已选 {uploads.length} 张。同一物品使用一致的背景和光照，
                      将最清晰、最完整的一张设为主图。
                    </p>
                    <ol className="capture-views" aria-label="生成视角">
                      {uploads.map((view, index) => (
                        <li key={`${view.id}-${index}`}>
                          <img src={view.url} alt={`视角 ${index + 1}`} />
                          <span>
                            <strong>
                              {index === 0 ? "主图" : `视角 ${index + 1}`}
                            </strong>
                            <small title={view.name}>{view.name}</small>
                          </span>
                          <button
                            type="button"
                            className="secondary"
                            aria-label={`将视角 ${index + 1} 设为主图`}
                            disabled={busy || index === 0}
                            onClick={() =>
                              changeViews([
                                view,
                                ...uploads.filter((_, i) => i !== index),
                              ])
                            }
                          >
                            设为主图
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            aria-label={`移除视角 ${index + 1}`}
                            disabled={busy}
                            onClick={() =>
                              changeViews(uploads.filter((_, i) => i !== index))
                            }
                          >
                            移除
                          </button>
                        </li>
                      ))}
                    </ol>
                  </>
                )}
                <label className="field">
                  生成服务
                  <select
                    value={provider}
                    onChange={(e) =>
                      setProvider(e.target.value as "lux3d" | "fixture")
                    }
                  >
                    <option value="lux3d">Lux3D · 默认服务</option>
                    <option value="fixture">离线流程演示 · 不识别照片</option>
                  </select>
                </label>
                {provider === "lux3d" ? (
                  <>
                    <label className="field">
                      生成版本
                      <select
                        value={version}
                        onChange={(e) => setVersion(e.target.value)}
                      >
                        <option>G1-Turbo</option>
                        <option>G1</option>
                      </select>
                    </label>
                    <p className="muted">
                      生成会将选中的 {uploads.length || "全部"} 张照片发送给
                      Lux3D，作为同一个任务使用你的额度。
                      {info?.configured
                        ? "密钥已配置。"
                        : "请先在设置中配置密钥。"}
                    </p>
                  </>
                ) : (
                  <p className="notice">
                    离线模式复制已有机器人模型，仅验证录入流程，不会根据照片生成，也不消耗额度。
                  </p>
                )}
                <button
                  className="primary full"
                  disabled={
                    !uploads.length ||
                    busy ||
                    (provider === "lux3d" && !info?.configured)
                  }
                  onClick={() => void generate()}
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Sparkles size={17} />
                  )}
                  生成 3D 模型
                </button>
                <div className="section-label spaced">任务记录</div>
                <div className="job-list">
                  {jobs.map((job) => (
                    <button
                      key={job.name}
                      className={`job ${job.name === selected ? "active" : ""}`}
                      onClick={() => {
                        setImported(undefined);
                        setSelected(job.name);
                        if (job.assets.some((asset) => asset.format === "glb"))
                          setStep(1);
                      }}
                    >
                      <Box size={15} />
                      <span>
                        {job.providerId === "fixture" ? "离线演示" : "Lux3D"} ·{" "}
                        {job.name.slice(-8)}
                        <small>{phaseNames[job.phase] ?? job.phase}</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  ))}
                </div>
              </section>
              <section>
                <div className="capture-placeholder">
                  {selectedJob &&
                  ["submitting", "submitted", "running"].includes(
                    selectedJob.phase,
                  ) ? (
                    <LoaderCircle className="spin" size={42} />
                  ) : (
                    <Box size={42} />
                  )}
                  <h3>
                    {url
                      ? "已有模型，可以继续"
                      : selectedJob
                        ? phaseNames[selectedJob.phase]
                        : "给一件物品，留一个位置"}
                  </h3>
                  <p>
                    {url
                      ? "复用这个结果，检查外观后再摆放。"
                      : selectedJob &&
                          ["submitted", "running"].includes(selectedJob.phase)
                        ? "模型正在云端生成，面板每 15 秒会自动查询进度；完成后会自动打开 3D 预览。"
                        : selectedJob?.phase === "succeeded"
                          ? "云端已生成完成，请点击下方按钮下载模型文件以开启 3D 预览。"
                          : "选择自己的照片，或导入已有模型。你可以关闭面板，稍后从任务记录继续。"}
                  </p>
                  {url && (
                    <button className="primary" onClick={() => setStep(1)}>
                      检查这个模型
                    </button>
                  )}
                </div>
                {pollPaused && (
                  <p className="notice">
                    自动查询已暂停。可稍后手动查询原任务。
                  </p>
                )}
                {selectedJob && !url && (
                  <>
                    <p className="muted">
                      任务 {selectedJob.taskId ?? "ID 尚未确认"} ·{" "}
                      {selectedJob.providerId}
                    </p>
                    {selectedJob.lastError && (
                      <p className="error-text">{selectedJob.lastError}</p>
                    )}
                    {selectedJob.taskId && (
                      <button
                        className="secondary"
                        onClick={() => void refresh(selectedJob)}
                      >
                        查询并下载结果
                      </button>
                    )}
                    {!selectedJob.taskId && (
                      <div className="recovery">
                        <p>
                          提交结果不确定，请核实官方历史中的任务，避免重复付费。
                        </p>
                        <button
                          className="secondary"
                          onClick={() =>
                            void request(
                              `/generation-history?name=${selectedJob.name}`,
                            )
                              .then((v) =>
                                setHistory(JSON.stringify(v, null, 2)),
                              )
                              .catch((e) => notify(e.message))
                          }
                        >
                          查看官方任务历史
                        </button>
                        {history && <pre>{history}</pre>}
                        <label className="field">
                          确认匹配的任务 ID
                          <input
                            value={taskId}
                            onChange={(e) => setTaskId(e.target.value)}
                          />
                        </label>
                        <button
                          className="secondary"
                          onClick={() =>
                            void request(
                              `/generations/${selectedJob.name}/attach`,
                              {
                                taskId: Number(taskId),
                                confirmMatch: true,
                              },
                            )
                              .then(reload)
                              .catch((e) => notify(e.message))
                          }
                        >
                          我已核实，绑定此任务
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </>
      )}
      {step === 1 && url && (
        <div className="capture-inspect">
          <section>
            <Preview url={url} onSize={setSize} yaw={yaw} front={front} />
            <p className="muted">
              拖动旋转 · 滚轮或双指缩放。外观不满意，可以保留结果稍后再处理。
            </p>
            {photoUrls.length > 0 && (
              <figure className="capture-photo">
                <div className="capture-reference-views">
                  {photoUrls.map((photoUrl, index) => (
                    <img
                      key={`${photoUrl}-${index}`}
                      src={photoUrl}
                      alt={
                        index === 0
                          ? "生成使用的参考照片"
                          : `生成使用的参考视角 ${index + 1}`
                      }
                    />
                  ))}
                </div>
                <figcaption>
                  参考照片 · {photoUrls.length} 张，第一张为主图
                  {selectedJob?.providerId === "fixture"
                    ? " · 离线模型与照片无关"
                    : " · 生成外观可能有偏差"}
                </figcaption>
              </figure>
            )}
            {imported && (
              <>
                <p className="notice">
                  已导入：{imported.name}。请检查细节与实际尺寸。
                </p>
                <ModelAttribution source={imported.source} />
              </>
            )}
          </section>
          <section>
            <fieldset disabled={busy || frozen} className="capture-fields">
              <label className="field">
                物品名称
                <input
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                实际宽度（厘米，近似值）
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </label>
              <p className="muted">
                高度和深度按比例调整。
                {imported
                  ? "请核对型号、接口和材质细节。"
                  : "照片中的背面和细节可能由模型推测。"}
              </p>
              <div className="two-fields">
                <label className="field">
                  模型转向
                  <select
                    value={yaw}
                    onChange={(e) => setYaw(Number(e.target.value))}
                  >
                    {[0, 90, 180, 270].map((v) => (
                      <option key={v} value={v}>
                        {v}°
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  正面方向
                  <select
                    value={front}
                    onChange={(e) => setFront(Number(e.target.value))}
                  >
                    {[0, 90, 180, 270].map((v) => (
                      <option key={v} value={v}>
                        {v}°
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="muted">
                关联现有设备时保留原有尺寸和摆放，只增加近景外观。
              </p>
              <label className="field">
                用途
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="entity">作为独立物件</option>
                  {state.home.entities
                    .filter(
                      (e) =>
                        e.lifecycle === "active" && e.visibility !== "editing",
                    )
                    .map((e) => (
                      <option key={e.id} value={`existing:${e.id}`}>
                        关联 {e.name} 的近景模型
                      </option>
                    ))}
                  {state.home.stocks.map((s) => (
                    <option key={s.id} value={s.id}>
                      用作 {s.name} 的库存模型
                    </option>
                  ))}
                </select>
              </label>
              {target === "entity" && (
                <>
                  <label className="field">
                    空间用途
                    <select
                      value={assetKind}
                      onChange={(e) =>
                        setAssetKind(e.target.value as SceneAsset["kind"])
                      }
                    >
                      <option value="glb">通用模型</option>
                      <option value="table">桌面 / 台面</option>
                      <option value="wardrobe">衣柜</option>
                      <option value="cabinet">储物柜</option>
                      <option value="mini-pc">迷你主机</option>
                      <option value="homepod-mini">HomePod mini</option>
                    </select>
                  </label>
                  <label className="field">
                    物品类型
                    <select
                      value={category}
                      onChange={(e) =>
                        setCategory(e.target.value as typeof category)
                      }
                    >
                      <option value="object">普通物品</option>
                      <option value="device">智能设备</option>
                      <option value="host">主机</option>
                    </select>
                  </label>
                </>
              )}
            </fieldset>
            <button
              className="primary full"
              disabled={busy || frozen || !draft}
              onClick={() => (target === "entity" ? setStep(2) : void place())}
            >
              <MapPin size={17} />
              {target === "entity" ? "给它找个位置" : "加入家庭场景"}
            </button>
            <button
              className="secondary full"
              disabled={busy || frozen}
              onClick={() => setStep(0)}
            >
              返回物品来源
            </button>
          </section>
        </div>
      )}
      {step === 2 && draft && (
        <div className="capture-placement">
          <section>
            <CaptureScene
              state={draft.error ? state : draft.state}
              roomId={draft.entity.locationId}
              entityId={draft.error ? undefined : draft.entity.id}
              supportId={supportId}
            />
            <p className="muted">
              拖动查看周围，滚轮或双指缩放。模型按刚才确认的尺寸显示。
            </p>
          </section>
          <section>
            <h3>{name}</h3>
            <p className="muted">
              确认你实际放置的位置。这里存下的是你的家当清单，随时都能改。
            </p>
            <fieldset disabled={busy || frozen} className="capture-fields">
              <label className="field">
                摆放到台面
                <select
                  value={supportId}
                  onChange={(e) => {
                    setSupportId(e.target.value);
                    setSaveError("");
                  }}
                >
                  <option value="">选择区域 / 暂不定位</option>
                  {supports.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ·{" "}
                      {
                        state.home.rooms.find((r) => r.id === e.locationId)
                          ?.name
                      }
                    </option>
                  ))}
                </select>
              </label>
              {!supportId && (
                <label className="field">
                  放在哪里
                  <select
                    value={room}
                    onChange={(e) => {
                      setRoom(e.target.value);
                      setSaveError("");
                    }}
                  >
                    {state.home.rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                        {r.kind === "room" ? " · 地面空位" : " · 逻辑区域"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </fieldset>
            {draft.error ? (
              <p className="notice" role="status">
                {draft.error} 原有物品不会被挪动。请换一个位置，或返回调整尺寸。
              </p>
            ) : (
              <p className="capture-location" role="status">
                {
                  state.home.rooms.find((r) => r.id === draft.entity.locationId)
                    ?.name
                }
                {supportId
                  ? ` / ${supports.find((e) => e.id === supportId)?.name}`
                  : draft.entity.placementConfirmed
                    ? " / 地面"
                    : " / 位置尚未确认"}
              </p>
            )}
            <button
              className="primary full"
              disabled={busy || frozen || Boolean(draft.error)}
              onClick={() => void place()}
            >
              <Check size={17} />
              {busy ? "正在保存…" : "确认位置，加入小世界"}
            </button>
            <button
              className="secondary full"
              disabled={busy || frozen}
              onClick={() => setStep(1)}
            >
              返回检查外观
            </button>
            <button
              className="secondary full"
              disabled={busy}
              onClick={onClose}
            >
              {frozen ? "退出录入，稍后核实" : "暂时不放，稍后继续"}
            </button>
          </section>
        </div>
      )}
    </Modal>
  );
}

function ProviderSettings({
  onClose,
  notify,
}: {
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [info, setInfo] = useState<ProviderInfo>();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void request<ProviderInfo>("/providers")
      .then(setInfo)
      .catch((e) => notify(e.message));
  }, []);
  return (
    <Modal
      title="连接与服务"
      subtitle="你的密钥留在本地服务端，场景数据可以独立使用。"
      onClose={onClose}
    >
      <div className="provider-card">
        <div className="provider-mark">
          <Sparkles size={25} />
        </div>
        <div>
          <h3>Lux3D</h3>
          <p>默认 3D 生成服务 · 中国区</p>
        </div>
        <span className={`badge ${info?.configured ? "success" : ""}`}>
          {info?.configured ? "已配置" : "待配置"}
        </span>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            setInfo(await request("/providers/lux3d", { key }, "PUT"));
            setKey("");
            notify("新连接已保存。已有任务继续使用原连接。");
          } catch (error) {
            notify((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          API key
          <input
            type="password"
            autoComplete="new-password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="输入你自己的 API key"
          />
        </label>
        <p className="muted">
          保存后不回显密钥。生成物品时才会调用服务。后续可通过独立适配器接入其他
          3D、语音或语言模型。
        </p>
        <button className="primary" disabled={busy || !key.trim()}>
          保存连接
        </button>
      </form>
      <div className="settings-note">
        <Activity size={18} />
        <div>
          <strong>主机监控与设备控制</strong>
          <p>
            监控提供方尚未配置。外部工具可通过带令牌的事件 API
            接入；本应用不执行 SSH、关机或升级操作。
          </p>
        </div>
      </div>
      <a
        className="text-link"
        href="/inspector.html"
        target="_blank"
        rel="noreferrer"
      >
        打开独立 GLB 查看器 <ArrowUpRight size={15} />
      </a>
    </Modal>
  );
}

function ServicePanel({
  service,
  onClose,
}: {
  service: Service;
  onClose: () => void;
}) {
  const [embed, setEmbed] = useState(
    service.embed === "allowed" || service.demo,
  );
  const url = service.demo ? "/demo/service" : service.url;
  return (
    <Modal
      title={service.name}
      subtitle={`${service.version} · 来源日期 ${service.asOf}`}
      onClose={onClose}
      wide
    >
      <div className="service-actions">
        <p>
          {service.demo
            ? "本地演示页面，不按真机状态算数。"
            : "此页面由外部服务提供，可能需要登录或禁止嵌入。"}
        </p>
        {url && (
          <a className="secondary" href={url} target="_blank" rel="noreferrer">
            打开原页面 <ArrowUpRight size={16} />
          </a>
        )}
      </div>
      {url ? (
        embed ? (
          <>
            <iframe
              className="service-frame"
              title={service.name}
              src={url}
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            />
            <p className="muted">
              如果页面空白或登录不可用，请使用上方的原页面入口。
            </p>
          </>
        ) : (
          <div className="frame-placeholder">
            <Unplug size={36} />
            <h3>尚未验证这个服务能否嵌入</h3>
            <p>你可以打开原页面，也可以主动尝试嵌入。</p>
            {service.embed !== "link" && (
              <button className="primary" onClick={() => setEmbed(true)}>
                尝试嵌入页面
              </button>
            )}
          </div>
        )
      ) : (
        <div className="empty">
          <p>资料中没有提供服务 URL。请在服务设置中补充。</p>
        </div>
      )}
    </Modal>
  );
}

function ElectricalDetails({
  entity,
  home,
  onSelect,
}: {
  entity: Entity;
  home: HomeTemplate;
  onSelect: (id: string) => void;
}) {
  const circuits = (home.electricalCircuits ?? []).filter(
    (c) =>
      c.controllerEntityId === entity.id ||
      c.channels.some((channel) => channel.entityIds.includes(entity.id)),
  );
  if (!circuits.length) return null;
  return (
    <section className="electrical-details" aria-label="供电与控制">
      <h3>供电与控制</h3>
      {circuits.map((circuit) => (
        <div key={circuit.id}>
          <strong>{circuit.name}</strong>
          <p className="muted">
            {circuit.metering === "per-outlet"
              ? "每个插孔独立统计电量"
              : circuit.metering === "aggregate"
                ? "整组共用电量统计"
                : "智能开关控制"}{" "}
            ·{" "}
            {circuit.source === "sample"
              ? "示例关系"
              : circuit.source === "owner"
                ? "主人记录"
                : "手动记录"}{" "}
            {circuit.asOf}
          </p>
          {circuit.controllerEntityId !== entity.id && (
            <button
              className="secondary full"
              onClick={() => onSelect(circuit.controllerEntityId)}
            >
              查看
              {
                home.entities.find((e) => e.id === circuit.controllerEntityId)
                  ?.name
              }
            </button>
          )}
          {circuit.channels
            .filter(
              (channel) =>
                circuit.controllerEntityId === entity.id ||
                channel.entityIds.includes(entity.id),
            )
            .map((channel) => (
              <div className="electrical-channel" key={channel.id}>
                <p>
                  {channel.name}
                  {circuit.metering === "per-outlet" && (
                    <small>
                      {" "}
                      ·{" "}
                      {channel.outlet === undefined
                        ? "实体插孔编号待核对"
                        : `插孔 ${channel.outlet}`}
                    </small>
                  )}
                </p>
                <div className="electrical-loads">
                  {channel.entityIds.map((id) =>
                    id === entity.id ? (
                      <span key={id}>{entity.name}</span>
                    ) : (
                      <button
                        key={id}
                        className="secondary"
                        onClick={() => onSelect(id)}
                      >
                        {home.entities.find((e) => e.id === id)?.name}
                      </button>
                    ),
                  )}
                </div>
              </div>
            ))}
          <p className="muted">
            {circuit.metering === "none"
              ? "开关状态未接入"
              : "实时功率与累计电量尚未接入"}
          </p>
        </div>
      ))}
    </section>
  );
}

function EntityDetails({
  entity,
  state,
  mutate,
  notify,
  onService,
  onConfigure,
  onSelectEntity,
  onSelectItem,
  task,
  arrival = false,
  onFinishArrival,
}: {
  entity: Entity;
  state: Dashboard;
  mutate: (a: Action) => Promise<void>;
  notify: (s: string) => void;
  onService: (s: Service) => void;
  onConfigure: () => void;
  onSelectEntity: (id: string) => void;
  onSelectItem: (item: SpatialItem) => void;
  task: TaskMode;
  arrival?: boolean;
  onFinishArrival: () => void;
}) {
  const storage = isStorage(state.home, entity);
  const [tab, setTab] = useState(
    arrival
      ? "info"
      : storage
        ? "contents"
        : task === "devices" &&
            state.home.services.some((s) => s.entityId === entity.id)
          ? "services"
          : "info",
  );
  const [notes, setNotes] = useState(entity.notes);
  const [writing, setWriting] = useState(
    arrival || !entity.notes || entity.category !== "object",
  );
  const [noteBusy, setNoteBusy] = useState(false);
  const [location, setLocation] = useState(entity.locationId);
  const [x, setX] = useState(entity.position[0]);
  const [z, setZ] = useState(entity.position[2]);
  const [rotation, setRotation] = useState(
    Math.round((entity.rotation * 180) / Math.PI),
  );
  useEffect(() => {
    setNotes(entity.notes);
    setLocation(entity.locationId);
    setX(entity.position[0]);
    setZ(entity.position[2]);
    setRotation(Math.round((entity.rotation * 180) / Math.PI));
  }, [
    entity.id,
    entity.notes,
    entity.locationId,
    entity.position[0],
    entity.position[2],
    entity.rotation,
  ]);
  const observation = entityObservation(state, entity.id),
    health = observationState(observation);
  const services = state.home.services.filter((s) => s.entityId === entity.id);
  const appearance = state.home.assets.find((a) => a.id === entity.assetId);
  return (
    <>
      <div className={`detail-title ${storage ? "container-title" : ""}`}>
        <div className="entity-icon">
          <Icon type={entity.scope === "remote" ? "remote" : entity.category} />
        </div>
        <div>
          <h2>{entity.name}</h2>
          <p>
            {entity.lifecycle === "retired"
              ? "已退役 · 无活动服务"
              : entity.scope === "remote"
                ? "远端节点 · 非家庭物理位置"
                : "家庭中的独立对象"}
          </p>
        </div>
      </div>
      <div className="badge-row">
        {appearance && (
          <span className="badge">
            {appearance.url || appearance.detailUrl
              ? "模型外观近似"
              : "示意外观"}
          </span>
        )}
        {(entity.category !== "object" || observation) && (
          <span
            className={`badge ${health === "up" ? "success" : health === "down" ? "warning" : ""}`}
          >
            {healthNames[health]}
          </span>
        )}
        {observation?.demo && <span className="badge warning">演示数据</span>}
        {!entity.placementConfirmed && entity.scope === "home" && (
          <span className="badge">位置待确认</span>
        )}
      </div>
      <div className="detail-tabs">
        {[
          ...(storage ? [["contents", "收纳"]] : []),
          ["info", "详情"],
          ...(entity.category !== "object" || services.length
            ? [["services", `服务 ${services.length}`]]
            : []),
          ["place", "摆放"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "contents" && (
        <StoragePanel
          state={state}
          container={entity}
          mutate={mutate}
          onSelect={onSelectItem}
        />
      )}
      {tab === "info" && (
        <>
          <section className="object-story-section" aria-label="物品故事">
            {arrival && (
              <>
                <p className="capture-location">
                  {entity.placementConfirmed
                    ? "已加入小世界 · 位置已保存"
                    : "物品已保存 · 实际位置尚未确认"}
                </p>
                <h3>想给它留句话吗？</h3>
                <p className="muted">
                  来历、用途，或一个只有你知道的小细节。也可以以后再写。
                </p>
              </>
            )}
            {entity.notes && !writing && (
              <>
                <p className="object-story">{entity.notes}</p>
                <button className="secondary" onClick={() => setWriting(true)}>
                  编辑故事
                </button>
              </>
            )}
            {writing && (
              <>
                <label className="field">
                  这个物件的故事 / 备注
                  <textarea
                    value={notes}
                    maxLength={4000}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    placeholder="它的来历、用途，或你想记住的事情…"
                  />
                </label>
                <button
                  className={arrival ? "primary full" : "secondary full"}
                  disabled={noteBusy}
                  onClick={async () => {
                    setNoteBusy(true);
                    try {
                      await mutate({
                        type: "entity.note",
                        entityId: entity.id,
                        notes,
                      });
                      notify("备注已保存。");
                      if (arrival) onFinishArrival();
                      else if (entity.category === "object") setWriting(false);
                    } catch (e) {
                      notify((e as Error).message);
                    } finally {
                      setNoteBusy(false);
                    }
                  }}
                >
                  {noteBusy
                    ? "正在保存…"
                    : arrival
                      ? "保存故事，回到小世界"
                      : "保存备注"}
                </button>
              </>
            )}
            {arrival && (
              <button
                className="secondary full"
                disabled={noteBusy}
                onClick={onFinishArrival}
              >
                以后再写，回到小世界
              </button>
            )}
          </section>
          <p className="description">{entity.description}</p>
          <dl className="details">
            <div>
              <dt>位置</dt>
              <dd>
                {state.home.rooms.find((r) => r.id === entity.locationId)?.name}
              </dd>
            </div>
            <div>
              <dt>来源</dt>
              <dd>
                {entity.source === "owner"
                  ? "主人提供"
                  : entity.source === "sample"
                    ? "示例资料"
                    : "手动录入"}
              </dd>
            </div>
            <div>
              <dt>记录日期</dt>
              <dd>{entity.asOf}</dd>
            </div>
            {observation && (
              <div>
                <dt>最近观测</dt>
                <dd>{new Date(observation.observedAt).toLocaleTimeString()}</dd>
              </div>
            )}
          </dl>
          <ElectricalDetails
            entity={entity}
            home={state.home}
            onSelect={onSelectEntity}
          />
        </>
      )}
      {tab === "services" && (
        <>
          <ElectricalDetails
            entity={entity}
            home={state.home}
            onSelect={onSelectEntity}
          />
          <div className="service-list">
            {services.map((s) => (
              <button
                key={s.id}
                className="service-item"
                onClick={() => onService(s)}
              >
                <span className="service-item-main">
                  <ServiceBadgeIcon
                    icon={s.icon}
                    serviceId={s.id}
                    label={s.name}
                    size={22}
                  />
                  <span>
                    <strong>{s.name}</strong>
                    <small>
                      {s.version} ·{" "}
                      {s.demo
                        ? "演示"
                        : s.embed === "unverified"
                          ? "嵌入待验证"
                          : "服务入口"}
                    </small>
                  </span>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {services.length === 0 && <p className="empty">还没有关联服务。</p>}
          </div>
          {entity.lifecycle !== "retired" && (
            <button className="secondary full" onClick={onConfigure}>
              <Plus size={15} />
              管理服务入口
            </button>
          )}
        </>
      )}
      {tab === "place" && (
        <>
          {entity.scope === "home" && (
            <PlacementPanel state={state} item={entity} mutate={mutate} />
          )}
          <h3 className="spaced">手动坐标</h3>
          <p className="muted">
            相对于所选区域中心的位置，单位为米。只改画面里的摆放，设备归属不变。
          </p>
          <label className="field">
            所在区域
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            >
              {state.home.rooms
                .filter((r) =>
                  entity.scope === "remote"
                    ? r.kind === "remote"
                    : r.kind !== "remote",
                )
                .map((r) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="two-fields">
            <label className="field">
              左右 X
              <input
                type="number"
                step="0.1"
                value={x}
                onChange={(e) => setX(Number(e.target.value))}
              />
            </label>
            <label className="field">
              前后 Z
              <input
                type="number"
                step="0.1"
                value={z}
                onChange={(e) => setZ(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            朝向（度）
            <input
              type="number"
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value))}
            />
          </label>
          <button
            className="primary full"
            disabled={entity.lifecycle === "retired"}
            onClick={() =>
              void mutate({
                type: "entity.place",
                entityId: entity.id,
                locationId: location,
                position: [x, entity.position[1], z],
                rotation: (rotation * Math.PI) / 180,
              })
                .then(() => notify("位置已保存。"))
                .catch((e) => notify(e.message))
            }
          >
            <MapPin size={16} />
            确认位置
          </button>
        </>
      )}
    </>
  );
}

function StockCard({
  stock,
  state,
  adjust,
  selected = false,
}: {
  stock: Stock;
  state: Dashboard;
  adjust: (delta: number) => void;
  selected?: boolean;
}) {
  return (
    <div className={`stock-card ${selected ? "selected" : ""}`}>
      <div className="stock-card-top">
        <div className="stock-symbol">
          <Boxes size={22} />
        </div>
        <div>
          <h3>{stock.name}</h3>
          <p>
            {state.home.rooms.find((r) => r.id === stock.locationId)?.name} ·{" "}
            {stock.sku}
          </p>
        </div>
      </div>
      <div className="stock-quantity">
        <div>
          <strong data-testid={`quantity-${stock.id}`}>{stock.quantity}</strong>
          <span>{stock.unit}</span>
        </div>
        <div className="stepper">
          <button
            aria-label={`减少 ${stock.name}`}
            disabled={stock.quantity === 0}
            onClick={() => adjust(-1)}
          >
            <Minus size={16} />
          </button>
          <button aria-label={`增加 ${stock.name}`} onClick={() => adjust(1)}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="stock-track">
        <span
          style={{
            width: `${Math.min(100, (stock.quantity / stock.capacity) * 100)}%`,
          }}
        />
      </div>
      <div className="stock-foot">
        <span>{stock.sample ? "示例库存 · 可调整" : "已记录库存"}</span>
        <span>
          {stock.quantity > stock.capacity
            ? "超出区域容量"
            : stock.quantity <= stock.threshold
              ? "接近补货线"
              : `区域容量 ${stock.capacity}`}
        </span>
      </div>
      {stock.quantity > 24 && (
        <p className="muted">场景最多展示 24 个实例，实际总数以这里为准。</p>
      )}
    </div>
  );
}

function LayoutPanel({
  state,
  mutate,
  onClose,
  notify,
}: {
  state: Dashboard;
  mutate: (a: Action) => Promise<void>;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [templates, setTemplates] = useState<HomeTemplate[]>([]);
  const [roomId, setRoomId] = useState(state.home.rooms[0].id);
  const current = state.home.rooms.find((r) => r.id === roomId)!;
  const [room, setRoom] = useState(current);
  useEffect(() => {
    void request<HomeTemplate[]>("/templates").then(setTemplates);
  }, []);
  useEffect(() => setRoom(current), [current]);
  function exportHome() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(state.home, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.home.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function importHome(value: unknown) {
    try {
      await mutate({
        type: "template.import",
        template: value as HomeTemplate,
      });
      notify("模板已载入。");
      onClose();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal
      title="空间与模板"
      subtitle="先让布局容易辨认，再逐步补齐真实尺寸和位置。"
      onClose={onClose}
      wide
    >
      <div className="capture-grid">
        <section>
          <h3>编辑功能区</h3>
          <label className="field">
            区域
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {state.home.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            名称
            <input
              value={room.name}
              onChange={(e) => setRoom({ ...room, name: e.target.value })}
            />
          </label>
          <div className="two-fields">
            <label className="field">
              宽（米）
              <input
                type="number"
                step="0.1"
                min="1"
                max="30"
                value={room.size[0]}
                onChange={(e) =>
                  setRoom(
                    resizedRoom(room, [Number(e.target.value), room.size[1]]),
                  )
                }
              />
            </label>
            <label className="field">
              深（米）
              <input
                type="number"
                step="0.1"
                min="1"
                max="30"
                value={room.size[1]}
                onChange={(e) =>
                  setRoom(
                    resizedRoom(room, [room.size[0], Number(e.target.value)]),
                  )
                }
              />
            </label>
          </div>
          <div className="two-fields">
            <label className="field">
              中心 X
              <input
                type="number"
                step="0.1"
                value={room.origin[0]}
                onChange={(e) =>
                  setRoom({
                    ...room,
                    origin: [Number(e.target.value), 0, room.origin[2]],
                  })
                }
              />
            </label>
            <label className="field">
              中心 Z
              <input
                type="number"
                step="0.1"
                value={room.origin[2]}
                onChange={(e) =>
                  setRoom({
                    ...room,
                    origin: [room.origin[0], 0, Number(e.target.value)],
                  })
                }
              />
            </label>
          </div>
          <button
            className="primary"
            onClick={() =>
              void mutate({ type: "room.update", room })
                .then(() => notify("区域已更新，物件相对位置保持不变。"))
                .catch((e) => notify(e.message))
            }
          >
            保存区域
          </button>
        </section>
        <section>
          <h3>保存与替换家庭</h3>
          <p className="muted">
            导出包含当前物品、库存及服务地址，不包含密钥或通知。更换模板会替换当前场景并自动保存备份，也可以先导出需要保留的记录。
          </p>
          <button className="secondary full" onClick={exportHome}>
            <ArrowDownToLine size={16} />
            导出当前家庭
          </button>
          <label className="import-control">
            导入家庭 JSON
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file)
                  void file
                    .text()
                    .then((s) => importHome(JSON.parse(s)))
                    .catch((err) => notify(err.message));
              }}
            />
          </label>
          <div className="section-label spaced">可复用示例</div>
          {templates.map((t) => (
            <button
              className="template-card"
              key={t.id}
              onClick={() => void importHome(t)}
            >
              <House size={22} />
              <span>
                <strong>{t.name}</strong>
                <small>{t.entities.length} 个物件 · 合成示例</small>
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
      </div>
    </Modal>
  );
}

function EntryForm({
  kind,
  state,
  entity,
  mutate,
  onClose,
  notify,
}: {
  kind: "stock" | "object" | "service";
  state: Dashboard;
  entity?: Entity;
  mutate: (a: Action) => Promise<void>;
  onClose: () => void;
  notify: (s: string) => void;
}) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState(
    (state.home.rooms.find((r) => r.kind === "room") ?? state.home.rooms[0]).id,
  );
  const [x, setX] = useState(0),
    [z, setZ] = useState(0);
  const [assetId, setAssetId] = useState(
    kind === "stock"
      ? (state.home.assets.find((a) => a.kind === "box")?.id ??
          state.home.assets[0].id)
      : state.home.assets[0].id,
  );
  const [quantity, setQuantity] = useState(0),
    [unit, setUnit] = useState("件"),
    [sku, setSku] = useState("");
  const [url, setUrl] = useState(""),
    [embed, setEmbed] = useState<"unverified" | "allowed" | "link">(
      "unverified",
    ),
    [serviceIcon, setServiceIcon] = useState("");
  const [category, setCategory] = useState<"host" | "device" | "object">(
    "object",
  );
  const [serviceId, setServiceId] = useState("new");
  const existingServices = state.home.services.filter(
    (s) => s.entityId === entity?.id,
  );
  async function save() {
    const id = randomUUID();
    try {
      if (kind === "stock")
        await mutate({
          type: "stock.create",
          stock: {
            id: "stock-" + id,
            name,
            sku: sku || "sku-" + id,
            unit,
            quantity,
            threshold: 2,
            locationId: location,
            position: [x, 0, z],
            assetId,
            capacity: 24,
            sample: false,
          },
        });
      else if (kind === "object")
        await mutate({
          type: "entity.create",
          entity: {
            id: "entity-" + id,
            name,
            category,
            scope: "home",
            lifecycle: "active",
            locationId: location,
            position: [x, 0, z],
            rotation: 0,
            placementConfirmed:
              state.home.rooms.find((r) => r.id === location)?.kind === "room",
            assetId,
            description: "",
            notes: "",
            tags: [],
            source: "user",
            asOf: new Date().toISOString().slice(0, 10),
          },
        });
      else if (entity) {
        const prev = existingServices.find((s) => s.id === serviceId);
        await mutate({
          type: "service.upsert",
          service: {
            id: serviceId === "new" ? "service-" + id : serviceId,
            entityId: entity.id,
            name,
            version: prev?.version ?? "未记录",
            ...(url ? { url } : {}),
            embed,
            ...(serviceIcon.trim() ? { icon: serviceIcon.trim() } : {}),
            description: prev?.description ?? "",
            asOf: new Date().toISOString().slice(0, 10),
            demo: prev?.demo ?? false,
          },
        });
      }
      notify("已保存。");
      onClose();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  return (
    <Modal
      title={
        kind === "stock"
          ? "新增库存区域"
          : kind === "object"
            ? "添加一个物件"
            : "管理服务入口"
      }
      subtitle={
        kind === "stock" ? "划定一个位置，再用数量驱动模型实例。" : undefined
      }
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {kind === "service" && (
          <label className="field">
            选择入口
            <select
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value);
                const s = existingServices.find((s) => s.id === e.target.value);
                setName(s?.name ?? "");
                setUrl(s?.url ?? "");
                setEmbed(s?.embed ?? "unverified");
                setServiceIcon(s?.icon ?? "");
              }}
            >
              <option value="new">新建服务入口</option>
              {existingServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          名称
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              kind === "stock" ? "例如：备用线材区" : "给它一个容易找到的名字"
            }
          />
        </label>
        {kind === "service" ? (
          <>
            <label className="field">
              网页地址
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <label className="field">
              打开方式
              <select
                value={embed}
                onChange={(e) => setEmbed(e.target.value as typeof embed)}
              >
                <option value="unverified">嵌入尚未验证</option>
                <option value="allowed">允许在侧栏中嵌入</option>
                <option value="link">始终打开原页面</option>
              </select>
            </label>
            <label className="field">
              图标标识或资源库路径（可选）
              <input
                list="builtin-service-icons"
                value={serviceIcon}
                onChange={(e) => setServiceIcon(e.target.value)}
                placeholder="自动匹配或输入如 gitea / /api/icons/..."
              />
              <datalist id="builtin-service-icons">
                {builtinServiceIcons.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.name}
                  </option>
                ))}
              </datalist>
            </label>
          </>
        ) : (
          <>
            {kind === "object" && (
              <label className="field">
                类别
                <select
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as typeof category)
                  }
                >
                  <option value="object">个人物件</option>
                  <option value="host">主机</option>
                  <option value="device">物联网设备</option>
                </select>
              </label>
            )}
            <label className="field">
              所在区域
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                {state.home.rooms
                  .filter((r) => r.kind !== "remote")
                  .map((r) => (
                    <option value={r.id} key={r.id}>
                      {r.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="two-fields">
              <label className="field">
                区域内 X（米）
                <input
                  type="number"
                  step="0.1"
                  value={x}
                  onChange={(e) => setX(Number(e.target.value))}
                />
              </label>
              <label className="field">
                区域内 Z（米）
                <input
                  type="number"
                  step="0.1"
                  value={z}
                  onChange={(e) => setZ(Number(e.target.value))}
                />
              </label>
            </div>
            <label className="field">
              使用的模型
              <select
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
              >
                {state.home.assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            {kind === "stock" && (
              <>
                <label className="field">
                  物品编码 / SKU
                  <input
                    value={sku}
                    onChange={(e) => setSku(e.target.value)}
                    placeholder="留空自动生成；同种物品可共用编码"
                  />
                </label>
                <div className="two-fields">
                  <label className="field">
                    初始数量
                    <input
                      type="number"
                      min="0"
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                    />
                  </label>
                  <label className="field">
                    单位
                    <input
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                    />
                  </label>
                </div>
              </>
            )}
          </>
        )}
        <button className="primary full" type="submit">
          <Check size={17} />
          保存
        </button>
      </form>
    </Modal>
  );
}

const WorldWorkspace = lazy(() =>
  import("./world-workspace.js").then((m) => ({ default: m.WorldWorkspace })),
);
export function AdminApp() {
  const [world, setWorld] = useState<"cyber" | "inventory">();
  const [guestPreview, setGuestPreview] = useState(false);
  const [cabinetEdit, setCabinetEdit] = useState<string>();
  const [photoEdit, setPhotoEdit] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [task, setTask] = useState<TaskMode>("browse");
  const [trail, setTrail] = useState<
    { selection: SceneSelection; filter: SceneFilter }[]
  >([]);
  const selectionScope = useRef<SceneFilter | undefined>(undefined);
  const [state, setState] = useState<Dashboard>();
  const stateRef = useRef(state);
  stateRef.current = state;
  const [connected, setConnected] = useState(false),
    [loadingError, setLoadingError] = useState("");
  const [filter, setFilter] = useState<SceneFilter>({
    room: "all",
    category: "all",
    query: "",
  });
  const [selection, setSelection] = useState<SceneSelection>();
  const [arrivalId, setArrivalId] = useState<string>();
  const [modal, setModal] = useState<
    | "capture"
    | "quick"
    | "settings"
    | "layout"
    | "stock"
    | "object"
    | "service"
    | "activity"
    | "alerts"
    | "hotspots"
  >();
  const [hotspotPreview, setHotspotPreview] = useState<Hotspot>();
  const [hotspotPickDraft, setHotspotPickDraft] = useState<Hotspot>();
  const [hotspotPickedHit, setHotspotPickedHit] = useState<SurfacePickHit>();
  const [pickingHotspot, setPickingHotspot] = useState(false);
  const [showHotspots, setShowHotspots] = useState(true);
  const [service, setService] = useState<Service>();
  const [toast, setToast] = useState("");
  const [sceneError, setSceneError] = useState("");
  const [top, setTop] = useState(false);
  const [sceneStyle, setSceneStyle] = useState<SceneStyle>("natural");
  const [decorative, setDecorative] = useState(true);
  const [lights, setLights] = useState(false);
  const [retired, setRetired] = useState(false);
  const [panel, setPanel] = useState<"menu" | "browse" | "overview">();
  const [pending, setPending] = useState(0);
  const [tick, setTick] = useState(0);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<HomeScene | null>(null);
  const notify = (message: string) => setToast(message);
  function closeSurface() {
    setArrivalId(undefined);
    setPanel(undefined);
    setSelection(undefined);
    setTrail([]);
    const previousScope = selectionScope.current;
    selectionScope.current = undefined;
    setFilter((current) =>
      previousScope
        ? previousScope
        : current.category === "all" && !current.query
          ? current
          : { ...current, category: "all", query: "" },
    );
  }
  function openPanel(next: "menu" | "browse" | "overview") {
    if (selection) closeSurface();
    setSelection(undefined);
    setPanel(next);
  }
  function returnHome() {
    closeSurface();
    setFilter({ room: "all", category: "all", query: "" });
    scene.current?.reset();
  }
  const interaction = useRef<{
    select: (value: SceneSelection) => void;
    empty: () => void;
  }>({ select: () => {}, empty: () => {} });
  interaction.current = {
    select: (value) => select(value),
    empty: () => (panel || selection ? closeSurface() : openPanel("menu")),
  };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        editing ||
        guestPreview ||
        world ||
        cabinetEdit ||
        photoEdit ||
        modal ||
        hotspotPreview ||
        service ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      )
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (pickingHotspot) {
          setPickingHotspot(false);
          setModal("hotspots");
          return;
        }
        closeSurface();
        return;
      }
      if (
        (event.target as HTMLElement)?.closest(
          "input, textarea, select, [contenteditable=true]",
        )
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        openPanel("browse");
      }
      if (
        event.key.toLowerCase() === "m" ||
        event.key === "ContextMenu" ||
        (event.shiftKey && event.key === "F10")
      ) {
        event.preventDefault();
        openPanel("menu");
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [
    modal,
    service,
    editing,
    guestPreview,
    hotspotPreview,
    pickingHotspot,
    world,
    cabinetEdit,
    photoEdit,
  ]);
  useEffect(() => {
    if (modal) setPanel(undefined);
  }, [modal]);
  useEffect(() => {
    let events: EventSource | undefined;
    let alive = true;
    void initialize()
      .then((initial) => {
        if (!alive) return;
        setState(initial);
        setConnected(true);
        events = new EventSource("/api/events/stream");
        events.addEventListener("state", (event) => {
          const next = JSON.parse((event as MessageEvent).data) as Dashboard;
          setState((previous) =>
            !previous || next.revision >= previous.revision ? next : previous,
          );
          setConnected(true);
        });
        events.onopen = () => setConnected(true);
        events.onerror = () => setConnected(false);
      })
      .catch((e) => setLoadingError(e.message));
    return () => {
      alive = false;
      events?.close();
    };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => installBrowserWebMcp(), []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 7000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    if (editing || guestPreview || !state || !host.current || scene.current)
      return;
    try {
      const instance = new HomeScene(
        host.current,
        (value) => interaction.current.select(value),
        setSceneError,
        () => interaction.current.empty(),
      );
      instance.setHotspotHandler((hotspot) => triggerHotspotPreview(hotspot));
      scene.current = instance;
    } catch {
      setSceneError("WebGL 暂不可用。打开物件列表，仍可查看记录、管理库存。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [Boolean(state), editing, guestPreview]);
  useEffect(() => {
    if (state)
      scene.current?.update(state, {
        ...filter,
        task,
        lights,
        showHotspots,
        activeHotspotId: hotspotPreview?.id,
      });
  }, [state, filter, task, lights, showHotspots, hotspotPreview?.id, editing, guestPreview]);
  useEffect(() => {
    scene.current?.setPresentation(sceneStyle, decorative);
  }, [sceneStyle, decorative, Boolean(state), editing, guestPreview]);
  useEffect(() => {
    if (state) scene.current?.refreshHealth(state);
  }, [state, tick]);
  useEffect(() => {
    scene.current?.select(selection);
  }, [selection, state, editing, guestPreview]);
  useEffect(() => {
    scene.current?.focus(filter.room);
  }, [filter.room, editing, guestPreview]);
  useEffect(() => {
    scene.current?.setView(top ? "top" : "angle");
  }, [top, editing, guestPreview]);
  useEffect(() => {
    if (!scene.current) return;
    if (!pickingHotspot) {
      scene.current.setSurfacePick(undefined);
      return;
    }
    scene.current.setSurfacePick((hit) => {
      setPickingHotspot(false);
      setHotspotPickedHit(hit);
      setModal("hotspots");
    });
  }, [pickingHotspot]);

  function triggerHotspotPreview(hotspot: Hotspot) {
    setPanel(undefined);
    if (hotspot.effect.kind === "variant") {
      const entityRecord = stateRef.current?.home.entities.find(
        (e) => e.id === (hotspot.effect as { entityId: string }).entityId,
      );
      notify(
        `外观彩蛋：「${entityRecord?.name ?? hotspot.effect.entityId}」将在访客端临时切换外观，不改动数据库。`,
      );
      return;
    }
    if (hotspot.effect.kind === "spotlight" && stateRef.current) {
      const targetEntity = hotspot.effect.targetEntityId
        ? stateRef.current.home.entities.find(
            (e) =>
              e.id ===
              (hotspot.effect as { targetEntityId?: string }).targetEntityId,
          )
        : undefined;
      const targetRoom = targetEntity
        ? stateRef.current.home.rooms.find(
            (r) => r.id === targetEntity.locationId,
          )
        : undefined;
      const worldPoint: [number, number, number] | undefined =
        targetEntity && targetRoom
          ? [
              targetRoom.origin[0] + targetEntity.position[0],
              targetRoom.origin[1] + targetEntity.position[1] + 0.25,
              targetRoom.origin[2] + targetEntity.position[2],
            ]
          : resolveHotspotWorldPosition(stateRef.current.home, hotspot);
      if (worldPoint) {
        scene.current?.focusPoint(
          worldPoint,
          hotspot.effect.cameraOffset,
          hotspot.effect.zoom,
        );
      }
    }
    setHotspotPreview(hotspot);
  }
  async function mutate(action: Action, revision?: number) {
    if (!stateRef.current) return;
    setPending((p) => p + 1);
    try {
      await command(action, revision ?? stateRef.current.revision);
      const next = await request<Dashboard>("/state");
      setState((previous) =>
        !previous || next.revision >= previous.revision ? next : previous,
      );
      if (!stateRef.current || next.revision >= stateRef.current.revision)
        stateRef.current = next;
    } catch (e) {
      const latest = await request<Dashboard>("/state").catch(() => undefined);
      if (latest) {
        setState(latest);
        stateRef.current = latest;
      }
      throw e;
    } finally {
      setPending((p) => p - 1);
    }
  }
  function select(value: SceneSelection) {
    setArrivalId(undefined);
    if (!selection)
      selectionScope.current = { ...filter, query: "", category: "all" };
    if (selection && selection.id !== value.id)
      setTrail((t) => [...t, { selection, filter }]);
    setSelection(value);
    setPanel(undefined);
    const item =
      value.kind === "entity"
        ? state?.home.entities.find((e) => e.id === value.id)
        : state?.home.stocks.find((e) => e.id === value.id);
    // Keep scope when the record already belongs to it, including whole-home scope.
    const logical =
      state?.home.rooms.find((r) => r.id === item?.locationId)?.kind !== "room";
    setFilter((f) => {
      const room =
        logical || (f.room !== "all" && f.room !== item?.locationId)
          ? (item?.locationId ?? "all")
          : f.room;
      return room === f.room && !f.query && f.category === "all"
        ? f
        : { ...f, query: "", category: "all", room };
    });
  }
  function captureSaved(value: SceneSelection, isNew: boolean) {
    const latest = stateRef.current;
    const item =
      value.kind === "entity"
        ? latest?.home.entities.find((e) => e.id === value.id)
        : latest?.home.stocks.find((e) => e.id === value.id);
    selectionScope.current = { ...filter, query: "", category: "all" };
    setModal(undefined);
    setPanel(undefined);
    setTrail([]);
    setTask((current) =>
      latest && item && eligible(latest.home, item, current)
        ? current
        : value.kind === "stock"
          ? "inventory"
          : "browse",
    );
    setFilter({ room: item?.locationId ?? "all", category: "all", query: "" });
    setSelection(value);
    setArrivalId(isNew ? value.id : undefined);
    notify(
      isNew
        ? "物品已加入小世界。可以留句话，也可以以后再写。"
        : "模型已更新，原有记录和故事继续保留。",
    );
  }
  function selectItem(item: SpatialItem) {
    select({ kind: "quantity" in item ? "stock" : "entity", id: item.id });
  }
  function backFocus() {
    const previous = trail.at(-1);
    if (previous) {
      setTrail((t) => t.slice(0, -1));
      setSelection(previous.selection);
      setFilter(previous.filter);
    } else closeSurface();
  }
  function changeTask(next: TaskMode) {
    selectionScope.current = undefined;
    setTask(next);
    setSelection(undefined);
    setTrail([]);
    setFilter((f) => ({ ...f, category: "all", query: "" }));
    setPanel(next === "browse" ? undefined : "overview");
  }
  function incidentSelect(subjectId: string) {
    const id =
      state?.home.services.find((s) => s.id === subjectId)?.entityId ??
      subjectId;
    select({ kind: "entity", id });
    setModal(undefined);
  }
  async function demo(recovered = false) {
    const subjectId =
      selection?.kind === "entity"
        ? selection.id
        : state?.home.entities.find(
            (e) => e.scope === "home" && e.lifecycle === "active",
          )?.id;
    if (!subjectId) return;
    try {
      await request("/demo-event", { subjectId, recovered });
      notify(
        recovered
          ? "演示恢复通知已到达。"
          : "演示告警已到达，真实主机没有被探测。",
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (editing && state)
    return (
      <LayoutEditor
        state={state}
        onState={setState}
        onClose={() => {
          setEditing(false);
          setSelection(undefined);
          setFilter({ room: "all", category: "all", query: "" });
        }}
      />
    );
  if (guestPreview)
    return <GuestApp onExitPreview={() => setGuestPreview(false)} />;
  if (!state)
    return (
      <div className="startup">
        <div className="brand-icon">
          <SameRoomLogo size={46} />
        </div>
        <h1>{BRAND_FULL}</h1>
        <p>{loadingError || "正在推门进屋…"}</p>
        {loadingError && (
          <button className="primary" onClick={() => location.reload()}>
            重新连接
          </button>
        )}
      </div>
    );
  const { home } = state;
  const activeEntities = home.entities.filter((e) => e.lifecycle === "active");
  const entity =
    selection?.kind === "entity"
      ? home.entities.find((e) => e.id === selection.id)
      : undefined;
  const selectedStock =
    selection?.kind === "stock"
      ? home.stocks.find((s) => s.id === selection.id)
      : undefined;
  const selectedAsset = home.assets.find(
    (asset) => asset.id === (entity ?? selectedStock)?.assetId,
  );
  const visibleEntities = home.entities.filter(
    (e) =>
      (retired || e.lifecycle === "active") &&
      (task === "browse" || eligible(home, e, task)) &&
      (filter.room === "all" || e.locationId === filter.room) &&
      (filter.category === "all" || e.category === filter.category) &&
      `${e.name} ${e.description} ${e.tags.join(" ")}`
        .toLowerCase()
        .includes(filter.query.toLowerCase()),
  );
  const incidents = state.incidents.filter((i) => i.state !== "resolved");
  const focusedRoom = home.rooms.find((r) => r.id === filter.room);
  const spaceContext = focusedRoom
    ? `${focusedRoom.name} · ${focusedRoom.kind === "remote" ? "逻辑空间" : focusedRoom.kind === "unplaced" ? "位置待确认" : home.schematic ? "示意空间" : "家庭空间"}`
    : !home.rooms.some((r) => r.kind === "room")
      ? "云端与远程节点（不占用家里空间）"
      : "";
  const incidentList = (
    <div className="incident-list">
      {incidents.length ? (
        incidents.map((i) => (
          <div className="incident" key={i.id}>
            <button
              className="incident-target"
              onClick={() => incidentSelect(i.subjectId)}
            >
              <span className="incident-dot" />
              <div>
                <strong>
                  {home.entities.find((e) => e.id === i.subjectId)?.name ??
                    home.services.find((s) => s.id === i.subjectId)?.name ??
                    i.subjectId}
                </strong>
                <p>{i.message}</p>
                <small>
                  {i.demo ? "演示事件 · " : `${i.source} · `}
                  {i.state === "acknowledged" ? "已知悉，待来源恢复" : "待处理"}
                </small>
              </div>
              <ChevronRight size={14} />
            </button>
            {i.state === "open" && (
              <button
                className="text-link"
                onClick={() =>
                  void mutate({ type: "incident.ack", incidentId: i.id }).catch(
                    (e) => notify(e.message),
                  )
                }
              >
                标记已知悉
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="calm-empty">
          <div>
            <Check size={22} />
          </div>
          <strong>这里暂时很安静</strong>
          <p>
            收到新动态时，对应的物件会在屋里亮起提醒你。
          </p>
        </div>
      )}
    </div>
  );
  return (
    <div
      className="dashboard-app"
      data-task={task}
      data-surface={selection ? "details" : (panel ?? "scene")}
    >
      <main className="home-main" aria-label="家庭空间">
        <h1 className="sr-only">{home.name}</h1>
        <div
          className="home-viewport"
          ref={host}
          data-testid="home-viewport"
          onContextMenu={(event) => {
            event.preventDefault();
            openPanel("menu");
          }}
        />
        {(task !== "browse" || selection) && (
          <div className="task-context">
            <button
              onClick={selection ? backFocus : () => openPanel("menu")}
              aria-label={selection ? "返回上一层" : "切换管理任务"}
            >
              <ArrowLeft size={15} />
            </button>
            <button
              onClick={() => {
                setSelection(undefined);
                setTrail([]);
                setPanel("overview");
              }}
            >
              {taskNames[task]}
            </button>
            <span>
              {" "}
              /{" "}
              {entity?.name ??
                selectedStock?.name ??
                focusedRoom?.name ??
                "整个家庭"}
            </span>
          </div>
        )}
        {spaceContext && !selection && task === "browse" && (
          <div className="space-context">
            <button onClick={returnHome} aria-label="返回整个家庭">
              <ArrowLeft size={15} />
            </button>
            <span>{spaceContext}</span>
          </div>
        )}
        {sceneError && (
          <div className="scene-error" role="alert">
            <p>{sceneError}</p>
            <button className="secondary" onClick={() => openPanel("browse")}>
              打开物件列表
            </button>
          </div>
        )}
        {!panel && !selection && task === "browse" && !spaceContext && (
          <div className="workspace-brand-pill" aria-hidden="true">
            <SameRoomLogo size={26} />
            <div>
              <strong>{home.name}</strong>
              <span>我和个人 Agent 的共处空间</span>
            </div>
          </div>
        )}
        <div className="launcher-zone">
          <button
            className="space-launcher"
            aria-label="打开共在中枢"
            aria-haspopup="dialog"
            aria-expanded={Boolean(panel)}
            aria-keyshortcuts="M"
            onClick={() => (panel ? closeSurface() : openPanel("menu"))}
          >
            <SameRoomLogo size={18} />
            <span>共在中枢</span>
          </button>
          {!panel && !selection && (
            <div className="dock-quick-pills" aria-label="快捷切换">
              <button
                type="button"
                className="dock-quick-pill"
                onClick={() => setWorld("cyber")}
              >
                赛博视图
              </button>
              <button
                type="button"
                className="dock-quick-pill"
                onClick={() => setWorld("inventory")}
              >
                库存视图
              </button>
              <button
                type="button"
                className="dock-quick-pill"
                onClick={() => setModal("capture")}
              >
                录入物品
              </button>
              <button
                type="button"
                className="dock-quick-pill"
                onClick={() => setGuestPreview(true)}
              >
                访客视角
              </button>
            </div>
          )}
          <span className="interaction-hint">点物件查看 · 按 M 打开共在中枢</span>
        </div>
      </main>
      {pendingCommand() && !pending && (
        <div className="pending-banner" role="status">
          <span>
            上次修改的响应未确认：{pendingCommand()?.action.type}
            。重试会沿用同一操作编号。
          </span>
          <button
            className="secondary"
            onClick={() => {
              const originalAction = pendingCommand()?.action;
              setPending((p) => p + 1);
              void retryPending()
                .then(async () => {
                  const next = await request<Dashboard>("/state");
                  setState(next);
                  stateRef.current = next;
                  if (originalAction?.type === "object.capture")
                    captureSaved(
                      { kind: "entity", id: originalAction.entity.id },
                      true,
                    );
                  else notify("上次操作已确认。");
                })
                .catch((e) => notify(e.message))
                .finally(() => setPending((p) => p - 1));
            }}
          >
            确认上次操作
          </button>
        </div>
      )}

      {panel === "menu" && (
        <SpacePanel key="menu" title="共在中枢" onClose={closeSurface}>
          <div className="menu-intro">
            <div className="menu-brand-row">
              <SameRoomLogo size={24} />
              <span className="menu-brand-tag">SAMEROOM · 共在</span>
            </div>
            <h3>{home.name}</h3>
            <p>
              {home.schematic
                ? "参考户型 · 摆出你和个人 Agent 共处的房间"
                : "家庭空间 · 物件、设备与状态都在同一张视野里"}
            </p>
          </div>
          <span className="menu-group-label">共视空间与维度</span>
          <div className="task-switch" role="group" aria-label="管理任务">
            {(["browse", "devices", "inventory"] as TaskMode[]).map((t) => (
              <button
                key={t}
                className={task === t ? "active" : ""}
                onClick={() => changeTask(t)}
              >
                {taskNames[t]}
              </button>
            ))}
          </div>
          <section className="world-entry" aria-label="空间视图">
            <button
              onClick={() => {
                closeSurface();
                setWorld("cyber");
              }}
            >
              <Cpu size={20} />
              <span>
                <strong>赛博视图</strong>
                <small>服务连线 · 与个人 Agent 一起看懂屋里的设备</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                closeSurface();
                setWorld("inventory");
              }}
            >
              <Boxes size={20} />
              <span>
                <strong>库存视图</strong>
                <small>走进房间 · 打开柜子看清每一层收了什么</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button onClick={() => setModal("quick")}>
              <Plus size={20} />
              <span>
                <strong>记一件物品</strong>
                <small>来不及拍 3D，先写几句和照片也能放进屋</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </section>
          <span className="menu-group-label">把生活搬进屋里</span>
          <div className="space-actions">
            <button onClick={() => setModal("capture")}>
              <Camera size={18} />
              <span>
                录入物品<small>拍照、找图生成 3D 并摆进房间</small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                setHotspotPickDraft(undefined);
                setHotspotPickedHit(undefined);
                setModal("hotspots");
              }}
            >
              <Sparkles size={18} />
              <span>
                交互光晕点
                <small>
                  {(home.hotspots ?? []).length} 个展示热点 · 信封/相册/彩蛋
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                closeSurface();
                setEditing(true);
              }}
              aria-label="进入布局编辑模式"
            >
              <SlidersHorizontal size={18} />
              <span>
                编辑布局<small>移动、旋转或微调家具尺寸</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
          <span className="menu-group-label">查找、近况与访客视角</span>
          <div className="space-actions">
            <button onClick={() => openPanel("browse")}>
              <Search size={18} />
              <span>
                物件与搜索<small>房间、待摆放物件与远端节点</small>
              </span>
              <kbd>/</kbd>
            </button>
            <button onClick={() => openPanel("overview")}>
              <Bell size={18} />
              <span>
                家庭概览
                <small>
                  日常备品与新动态
                  {incidents.length > 0
                    ? ` · ${incidents.length} 条提醒`
                    : ""}
                </small>
              </span>
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => {
                closeSurface();
                setGuestPreview(true);
              }}
            >
              <Eye size={18} />
              <span>
                访客视角预览<small>站在客人视角看屋子，私密条目会自动收起</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
          <section className="menu-view" aria-label="视角与外观">
            <h3>看空间</h3>
            <div className="camera-toolbar">
              <button
                aria-label="缩小场景"
                onClick={() => scene.current?.zoom(0.85)}
              >
                <Minus size={16} />
              </button>
              <button
                aria-label="放大场景"
                onClick={() => scene.current?.zoom(1.18)}
              >
                <Plus size={16} />
              </button>
              <span />
              <button
                className={!top ? "active" : ""}
                onClick={() => setTop(false)}
              >
                3D
              </button>
              <button
                className={top ? "active" : ""}
                onClick={() => setTop(true)}
              >
                俯视
              </button>
              <span />
              <button
                aria-label="重置家庭视角"
                onClick={() => scene.current?.reset()}
              >
                <RotateCcw size={16} />
              </button>
            </div>
            <div className="scene-options">
              <div
                className="scene-style-switch"
                role="group"
                aria-label="场景风格"
              >
                <button
                  aria-pressed={sceneStyle === "natural"}
                  onClick={() => setSceneStyle("natural")}
                >
                  自然材质
                </button>
                <button
                  aria-pressed={sceneStyle === "soft"}
                  onClick={() => setSceneStyle("soft")}
                >
                  柔和色彩
                </button>
              </div>
              <button
                className="decor-toggle"
                aria-pressed={lights}
                onClick={() => setLights((v) => !v)}
              >
                <Layers size={14} /> 灯具（建筑层）
              </button>
              <button
                className="decor-toggle"
                aria-pressed={showHotspots}
                onClick={() => setShowHotspots((v) => !v)}
              >
                <Sparkles size={14} /> 光晕点
              </button>
              {home.schematic && (
                <button
                  className="decor-toggle"
                  aria-pressed={decorative}
                  onClick={() => setDecorative((v) => !v)}
                  title="显示或收起参考家具，便于查看你添置的物件"
                >
                  <Layers size={14} />
                  参考家具
                </button>
              )}
            </div>

            <p className="menu-help">
              拖动旋转，滚轮或双指缩放。点击物件查看，Esc 收起面板。
            </p>
          </section>
          <div className="menu-utilities">
            <button
              onClick={() => setModal("layout")}
              aria-label="编辑户型与模板"
            >
              <SlidersHorizontal size={16} />
              空间与模板
            </button>
            <button
              onClick={() => setModal("settings")}
              aria-label="连接与设置"
            >
              <Settings size={16} />
              连接与设置
            </button>
            <button onClick={() => setModal("activity")} aria-label="操作记录">
              <Activity size={16} />
              操作记录
            </button>
            <button
              onClick={() => setModal("object")}
              aria-label="添加普通物件"
            >
              <Plus size={16} />
              添加物件
            </button>
            <button
              onClick={() => {
                void logoutAdmin().then(() => window.location.reload());
              }}
              aria-label="退出管理员登录"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
          <div className={`connection ${connected ? "" : "disconnected"}`}>
            <i />
            {connected ? (
              "本地已连接"
            ) : (
              <button className="text-link" onClick={() => location.reload()}>
                连接中断 · 点击重连
              </button>
            )}
            <span>
              记录 v{state.revision}
              {pending > 0 ? " · 正在保存…" : ""}
            </span>
          </div>
        </SpacePanel>
      )}
      {panel === "browse" && (
        <SpacePanel
          key="browse"
          title="物件与搜索"
          onClose={closeSurface}
          onBack={() => openPanel("menu")}
        >
          <div className="task-switch" role="group" aria-label="管理任务">
            {(["browse", "devices", "inventory"] as TaskMode[]).map((t) => (
              <button
                key={t}
                className={task === t ? "active" : ""}
                onClick={() => changeTask(t)}
              >
                {taskNames[t]}
              </button>
            ))}
          </div>
          <div className="sidebar-title">
            <span>我的空间</span>
            <button
              className="icon-button"
              aria-label="编辑空间"
              onClick={() => setModal("layout")}
            >
              <SlidersHorizontal size={15} />
            </button>
          </div>
          <button
            className={`room-item all-rooms ${filter.room === "all" ? "active" : ""}`}
            onClick={returnHome}
          >
            <House size={17} />
            <span>整个家庭</span>
            <small>{activeEntities.length}</small>
          </button>
          <nav className="room-list" aria-label="房间">
            {home.rooms.map((r) => (
              <button
                key={r.id}
                className={`room-item ${filter.room === r.id ? "active" : ""}`}
                onClick={() => {
                  setFilter((f) => ({
                    ...f,
                    room: r.id,
                    category: "all",
                    query: "",
                  }));
                  setPanel(undefined);
                }}
              >
                {r.kind === "remote" ? (
                  <Cloud size={16} />
                ) : r.kind === "unplaced" ? (
                  <MapPin size={16} />
                ) : (
                  <span
                    className="room-swatch"
                    style={{ background: r.color }}
                  />
                )}
                <span>{r.name}</span>
                <small>
                  {activeEntities.filter((e) => e.locationId === r.id).length +
                    home.stocks.filter((s) => s.locationId === r.id).length}
                </small>
              </button>
            ))}
          </nav>
          <div className="sidebar-title spaced">
            <span>找到一件东西</span>
            <button
              className="icon-button"
              aria-label="添加普通物件"
              onClick={() => setModal("object")}
            >
              <Plus size={16} />
            </button>
          </div>
          <label className="search">
            <Search size={15} />
            <input
              placeholder="名称、用途或标签"
              aria-label="搜索物件"
              data-autofocus
              value={filter.query}
              onChange={(e) =>
                setFilter((f) => ({ ...f, query: e.target.value, room: "all" }))
              }
            />
          </label>
          <div className="category-tabs" role="group" aria-label="物品分类">
            {categories.map((c) => (
              <button
                key={c.id}
                className={filter.category === c.id ? "active" : ""}
                onClick={() => setFilter((f) => ({ ...f, category: c.id }))}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="object-list">
            {visibleEntities.map((e) => (
              <button
                key={e.id}
                className={`object-item ${selection?.id === e.id ? "active" : ""}`}
                onClick={() => select({ kind: "entity", id: e.id })}
              >
                <Icon type={e.scope === "remote" ? "remote" : e.category} />
                <span>
                  <strong>{e.name}</strong>
                  <small>
                    {e.lifecycle === "retired"
                      ? "已退役"
                      : e.scope === "remote"
                        ? "远端逻辑节点"
                        : e.placementConfirmed
                          ? home.rooms.find((r) => r.id === e.locationId)?.name
                          : "位置待确认"}
                  </small>
                </span>
                <span
                  className={`health-dot ${observationState(entityObservation(state, e.id))}`}
                />
              </button>
            ))}
            {task !== "devices" &&
              (filter.category === "all" || filter.category === "stock") &&
              home.stocks
                .filter(
                  (s) =>
                    (filter.room === "all" || s.locationId === filter.room) &&
                    s.name.includes(filter.query),
                )
                .map((s) => (
                  <button
                    key={s.id}
                    className={`object-item ${selection?.id === s.id ? "active" : ""}`}
                    onClick={() => select({ kind: "stock", id: s.id })}
                  >
                    <Boxes size={16} />
                    <span>
                      <strong>{s.name}</strong>
                      <small>
                        {s.quantity} {s.unit} · {s.sample ? "示例" : "已记录"}
                      </small>
                    </span>
                  </button>
                ))}
          </div>
          <label className="retired-toggle">
            <input
              type="checkbox"
              checked={retired}
              onChange={(e) => setRetired(e.target.checked)}
            />
            显示退役记录
          </label>
          <div className="sidebar-bottom">
            <span className="tiny-label">SOURCE / 资料来源</span>
            <p>{home.sourceLabel}</p>
            <span>
              当前记录 v{state.revision} {pending > 0 ? "· 正在保存…" : ""}
            </span>
          </div>
        </SpacePanel>
      )}
      {(selection || panel === "overview") && (
        <SpacePanel
          key={selection ? "details" : "overview"}
          title={
            selection
              ? "关于这件东西"
              : task === "browse"
                ? "家庭概览"
                : taskNames[task]
          }
          side={selection ? "right" : "left"}
          onClose={closeSurface}
          onBack={selection ? backFocus : () => openPanel("menu")}
          tools={
            selection && (
              <button
                className="icon-button"
                aria-label="查看所选物件近景"
                title="正面查看（保留环境）"
                onClick={() => scene.current?.inspect()}
              >
                <RotateCcw size={16} />
              </button>
            )
          }
        >
          {entity?.attachment && (
            <button
              className="storage-parent secondary full"
              onClick={() =>
                select({ kind: "entity", id: entity.attachment!.parentId })
              }
            >
              返回{" "}
              {
                home.entities.find((e) => e.id === entity.attachment?.parentId)
                  ?.name
              }{" "}
              {entity.attachment.kind === "storage"
                ? "的收纳空间"
                : "的整体视图"}
            </button>
          )}
          {entity ? (
            <>
              {isStorage(home, entity) && (
                <div className="world-fields">
                  <button
                    className="secondary"
                    onClick={() => setCabinetEdit(entity.id)}
                  >
                    编辑内部空间
                  </button>
                  <button
                    className="secondary"
                    onClick={() => setModal("quick")}
                  >
                    往这里放东西
                  </button>
                </div>
              )}
              <PhotoGallery photos={entity.photos} />
              <button
                className="text-link"
                onClick={() => setPhotoEdit(entity.id)}
              >
                编辑照片
              </button>
              <EntityDetails
                task={task}
                onSelectItem={selectItem}
                onSelectEntity={(id) => select({ kind: "entity", id })}
                key={entity.id}
                entity={entity}
                arrival={arrivalId === entity.id}
                onFinishArrival={closeSurface}
                state={state}
                mutate={mutate}
                notify={notify}
                onService={setService}
                onConfigure={() => setModal("service")}
              />
            </>
          ) : selectedStock ? (
            <>
              <PhotoGallery photos={selectedStock.photos} />
              <button
                className="text-link"
                onClick={() => setPhotoEdit(selectedStock.id)}
              >
                编辑照片
              </button>
              <StockCard
                stock={selectedStock}
                state={state}
                selected
                adjust={(delta) =>
                  void mutate({
                    type: "stock.adjust",
                    stockId: selectedStock.id,
                    delta,
                  }).catch((e) => notify(e.message))
                }
              />
              <p className="muted">调整数量会同步更新场景中的物品。</p>
              <button
                className="secondary full"
                onClick={() => setModal("capture")}
              >
                <Camera size={16} />
                拍摄这个物品的模型
              </button>
              <PlacementPanel
                state={state}
                item={selectedStock}
                mutate={mutate}
              />
            </>
          ) : task !== "browse" ? (
            <TaskOverview
              state={state}
              task={task}
              room={filter.room}
              onSelect={selectItem}
              onAdd={() => setModal("capture")}
            />
          ) : (
            <>
              <div className="summary-metrics">
                <div>
                  <strong>
                    {activeEntities.filter((e) => e.scope === "home").length}
                  </strong>
                  <span>家庭物件</span>
                </div>
                <div>
                  <strong>
                    {activeEntities.filter((e) => e.scope === "remote").length}
                  </strong>
                  <span>远端节点</span>
                </div>
                <div>
                  <strong>
                    {home.stocks.reduce((sum, s) => sum + s.quantity, 0)}
                  </strong>
                  <span>库存件数</span>
                </div>
              </div>
              <div className="panel-heading">
                <h2>
                  <Bell size={16} />
                  需要留意
                </h2>
                <button
                  className="text-link"
                  onClick={() => setModal("alerts")}
                >
                  {incidents.length} 项 <ChevronRight size={14} />
                </button>
              </div>
              {incidentList}
              <div className="panel-heading spaced">
                <h2>
                  <Boxes size={16} />
                  手边的库存
                </h2>
                <button
                  className="icon-button"
                  aria-label="新增库存区域"
                  onClick={() => setModal("stock")}
                >
                  <Plus size={16} />
                </button>
              </div>
              {home.stocks.slice(0, 2).map((s) => (
                <StockCard
                  key={s.id}
                  stock={s}
                  state={state}
                  adjust={(delta) =>
                    void mutate({
                      type: "stock.adjust",
                      stockId: s.id,
                      delta,
                    }).catch((e) => notify(e.message))
                  }
                />
              ))}
              {home.openQuestions.length > 0 && (
                <details className="source-notes">
                  <summary>
                    <CircleHelp size={15} />
                    尚待确认的资料
                  </summary>
                  {home.openQuestions.map((q) => (
                    <p key={q}>{q}</p>
                  ))}
                </details>
              )}
            </>
          )}
          {selection && (
            <details className="model-tools">
              <summary>外观与视角</summary>
              {selectedAsset && (
                <p className="asset-detail-note">
                  {selectedAsset.url
                    ? "三维模型 · 按你记下的尺寸摆放"
                    : selectedAsset.detailUrl
                      ? "近景模型 · 按你记下的尺寸摆放"
                      : "基础几何体 · 可在录入物品中换成真实 3D 模型"}
                </p>
              )}
              {selectedAsset?.source && (
                <ModelAttribution source={selectedAsset.source} />
              )}
              {entity && selectedAsset?.variant && (
                <fieldset className="model-variants" disabled={pending > 0}>
                  <legend>模型外观</legend>
                  <div>
                    {home.assets
                      .filter(
                        (asset) =>
                          asset.variant?.group === selectedAsset.variant!.group,
                      )
                      .map((asset) => (
                        <button
                          key={asset.id}
                          type="button"
                          className="secondary"
                          aria-pressed={asset.id === entity.assetId}
                          disabled={asset.id === entity.assetId}
                          onClick={() =>
                            void mutate({
                              type: "entity.asset",
                              entityId: entity.id,
                              assetId: asset.id,
                            }).catch((error: Error) => notify(error.message))
                          }
                        >
                          {asset.variant!.label}
                        </button>
                      ))}
                  </div>
                </fieldset>
              )}
              {entity && (
                <button
                  className="secondary full"
                  onClick={() => setModal("capture")}
                >
                  <Camera size={15} />
                  生成 / 导入近景模型
                </button>
              )}
            </details>
          )}
          {entity && (
            <EntityGuestSection
              entity={entity}
              mutate={mutate}
              notify={notify}
            />
          )}
          {task !== "inventory" &&
            !selectedStock &&
            (!entity || entity.category !== "object") && (
              <details className="demo-controls">
                <summary>体验演示通知</summary>
                <p>发送明确标注的演示事件，观察物件与待办的变化。</p>
                <div>
                  <button
                    className="secondary"
                    disabled={entity?.lifecycle === "retired"}
                    onClick={() => void demo(false)}
                  >
                    <Bell size={14} />
                    演示告警
                  </button>
                  <button
                    className="secondary"
                    disabled={entity?.lifecycle === "retired"}
                    onClick={() => void demo(true)}
                  >
                    演示恢复
                  </button>
                </div>
              </details>
            )}
        </SpacePanel>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {modal === "capture" && (
        <Capture
          onQuick={() => setModal("quick")}
          state={state}
          mutate={mutate}
          notify={notify}
          onSaved={captureSaved}
          initialTarget={
            entity
              ? `existing:${entity.id}`
              : selectedStock
                ? selectedStock.id
                : "entity"
          }
          onClose={() => setModal(undefined)}
        />
      )}
      {modal === "quick" && (
        <QuickRecord
          state={state}
          mutate={mutate}
          containerId={
            entity && isStorage(home, entity) ? entity.id : undefined
          }
          onClose={() => setModal(undefined)}
          onSaved={(id, stock) =>
            captureSaved({ id, kind: stock ? "stock" : "entity" }, true)
          }
        />
      )}
      {cabinetEdit && home.entities.find((e) => e.id === cabinetEdit) && (
        <CabinetEditor
          state={state}
          container={home.entities.find((e) => e.id === cabinetEdit)!}
          mutate={mutate}
          onClose={() => setCabinetEdit(undefined)}
        />
      )}
      {photoEdit && (
        <PhotoEditor
          state={state}
          itemId={photoEdit}
          mutate={mutate}
          onClose={() => setPhotoEdit(undefined)}
        />
      )}
      {world && (
        <Suspense
          fallback={
            <div className="world-loading" role="status">
              正在打开空间视图…
            </div>
          }
        >
          <WorldWorkspace
            mode={world}
            state={state}
            mutate={mutate}
            sourceScene={scene}
            onClose={() => setWorld(undefined)}
            onService={(id) => {
              setWorld(undefined);
              setService(home.services.find((s) => s.id === id));
            }}
          />
        </Suspense>
      )}
      {modal === "settings" && (
        <ProviderSettings notify={notify} onClose={() => setModal(undefined)} />
      )}
      {modal === "layout" && (
        <LayoutPanel
          state={state}
          mutate={mutate}
          notify={notify}
          onClose={() => {
            setModal(undefined);
            setSelection(undefined);
            setFilter({ room: "all", category: "all", query: "" });
          }}
        />
      )}
      {(modal === "stock" || modal === "object" || modal === "service") && (
        <EntryForm
          kind={modal}
          state={state}
          entity={entity}
          mutate={mutate}
          notify={notify}
          onClose={() => setModal(undefined)}
        />
      )}
      {modal === "activity" && (
        <Modal
          title="操作记录"
          subtitle="界面与 Agent 使用相同的命令和回执。"
          onClose={() => setModal(undefined)}
        >
          <div className="activity-list">
            {state.activity.length ? (
              [...state.activity].reverse().map((r) => (
                <div key={r.operationId}>
                  <span className="badge">{r.actor}</span>
                  <strong>{r.action}</strong>
                  <small>
                    v{r.revision} · {new Date(r.at).toLocaleString()}
                  </small>
                  <code>{JSON.stringify(r.result)}</code>
                </div>
              ))
            ) : (
              <p className="empty">还没有修改记录。</p>
            )}
          </div>
        </Modal>
      )}
      {modal === "alerts" && (
        <Modal
          title="所有通知"
          subtitle="历史记录与实时通知分别处理，未映射的通知保留在这里。"
          onClose={() => setModal(undefined)}
        >
          {incidentList}
          <h3 className="spaced">未映射事件 · {state.unmapped.length}</h3>
          {state.unmapped.map((o, i) => (
            <p className="notice" key={i}>
              {o.source} / {o.subjectId}: {o.message}
            </p>
          ))}
          <h3 className="spaced">
            已恢复 ·{" "}
            {state.incidents.filter((i) => i.state === "resolved").length}
          </h3>
          {state.incidents
            .filter((i) => i.state === "resolved")
            .map((i) => (
              <p className="muted" key={i.id}>
                {i.subjectId} · {i.demo ? "演示" : i.source}
              </p>
            ))}
        </Modal>
      )}
      {service && (
        <ServicePanel service={service} onClose={() => setService(undefined)} />
      )}
      {modal === "hotspots" && (
        <Modal
          wide
          title="交互光晕点管理"
          subtitle="配置标准视图中的游戏感交互光点：信封、相册、外链、内嵌页、导览故事或外观彩蛋。"
          onClose={() => {
            setModal(undefined);
            setHotspotPickDraft(undefined);
            setHotspotPickedHit(undefined);
          }}
        >
          <HotspotManager
            state={state}
            draftToResume={hotspotPickDraft}
            pickedHit={hotspotPickedHit}
            onPickInScene={(draft) => {
              setHotspotPickDraft(draft);
              setModal(undefined);
              setPickingHotspot(true);
            }}
            onCaptureCameraPose={() => scene.current?.getCameraPose()}
            onPreview={(hotspot) => {
              setModal(undefined);
              triggerHotspotPreview(hotspot);
            }}
            mutate={mutate}
            notify={notify}
          />
        </Modal>
      )}
      {pickingHotspot && (
        <div className="picking-banner" role="status">
          <span>请在 3D 场景中点击要放置光晕点的物品表面或房间地面</span>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setPickingHotspot(false);
              setModal("hotspots");
            }}
          >
            取消拾取
          </button>
        </div>
      )}
      {hotspotPreview && (
        <HotspotEffectOverlay
          hotspot={hotspotPreview}
          allHotspots={home.hotspots ?? []}
          onClose={() => {
            if (hotspotPreview.effect.kind === "spotlight") {
              scene.current?.restoreView();
            }
            setHotspotPreview(undefined);
          }}
          onSelectHotspot={(next) => triggerHotspotPreview(next)}
        />
      )}
    </div>
  );
}
