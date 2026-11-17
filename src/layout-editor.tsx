import { layoutConflicts } from "../shared/volumes.js";
import { items, followAttachments } from "../shared/spatial.js";
import { useEffect, useRef, useState } from "react";
import { v4 as randomUUID } from "uuid";
import {
  ArrowLeft,
  Check,
  Move,
  RotateCw,
  Undo2,
  Redo2,
  Plus,
} from "lucide-react";
import { HomeScene, type SceneSelection } from "./home-scene.js";
import { command, pendingCommand, request, retryPending } from "./api.js";
import {
  validateTemplate,
  resizedRoom,
  structuralKinds,
  deviceKinds,
  type Dashboard,
  type HomeTemplate,
  type SceneAsset,
} from "../shared/domain.js";
import {
  furnitureNames,
  furnitureSizes,
  layoutChanges,
} from "../shared/layout.js";
import "./layout-editor.css";

function NumberField({
  label,
  value,
  onCommit,
  min = -100,
  max = 100,
  step = 0.1,
  disabled = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(Number(value.toFixed(3))));
  useEffect(() => setText(String(Number(value.toFixed(3)))), [value]);
  function commit() {
    const number = Number(text);
    if (
      !text.trim() ||
      !Number.isFinite(number) ||
      number < min ||
      number > max
    ) {
      setText(String(Number(value.toFixed(3))));
      return;
    }
    if (Math.abs(number - value) > 0.00001) onCommit(number);
  }
  return (
    <label className="field">
      {label}
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function LayoutEditor({
  state,
  onState,
  onClose,
}: {
  state: Dashboard;
  onState: (state: Dashboard) => void;
  onClose: () => void;
}) {
  const [base, setBase] = useState(state);
  const [draft, setDraft] = useState(() => structuredClone(state.home));
  const [selection, setSelection] = useState<SceneSelection>();
  const [roomId, setRoomId] = useState(
    state.home.rooms.find((r) => r.kind === "room")?.id ??
      state.home.rooms[0].id,
  );
  const [mode, setMode] = useState<"translate" | "rotate">("translate");
  const [snap, setSnap] = useState(true),
    [top, setTop] = useState(true);
  const [past, setPast] = useState<HomeTemplate[]>([]),
    [future, setFuture] = useState<HomeTemplate[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const [exitRequested, setExitRequested] = useState(false),
    [sceneError, setSceneError] = useState("");
  const [addKind, setAddKind] = useState<SceneAsset["kind"]>("table");
  const [references, setReferences] = useState<string[]>([]);
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<HomeScene | null>(null);
  const panel = useRef<HTMLElement>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const dirty =
    JSON.stringify(layoutChanges(base.home, draft)) !==
    JSON.stringify({ type: "layout.commit", additions: [], placements: [] });
  const uncertain = Boolean(pendingCommand());
  const stale = state.revision !== base.revision;
  const room = draft.rooms.find((r) => r.id === roomId)!;
  useEffect(() => {
    if (exitRequested || error || status || stale || uncertain)
      panel.current?.scrollTo({ top: 0 });
  }, [exitRequested, error, status, stale, uncertain]);
  const record =
    selection?.kind === "entity"
      ? draft.entities.find((e) => e.id === selection.id)
      : draft.stocks.find((s) => s.id === selection?.id);
  const asset = draft.assets.find((a) => a.id === record?.assetId);
  const conflicts = layoutConflicts(draft, roomId).filter(
    (pair) => !record || pair.some((item) => item.id === record.id),
  );
  function change(edit: (home: HomeTemplate) => void) {
    if (busy || uncertain) return;
    const previous = draftRef.current;
    const next = structuredClone(previous);
    edit(next);
    const directlyMoved = new Set(
      items(next)
        .filter((item) => {
          const old = items(previous).find((i) => i.id === item.id);
          return (
            old &&
            JSON.stringify([item.position, item.rotation, item.locationId]) !==
              JSON.stringify([old.position, old.rotation, old.locationId])
          );
        })
        .map((i) => i.id),
    );
    for (const item of items(next))
      if (directlyMoved.has(item.id)) delete item.attachment;
    followAttachments(next, previous, directlyMoved);
    if (JSON.stringify(next) === JSON.stringify(draftRef.current)) return;
    setPast((history) => [...history.slice(-59), previous]);
    setFuture([]);
    draftRef.current = next;
    setDraft(next);
    setStatus("");
    setError("");
  }
  const changeRef = useRef(change);
  changeRef.current = change;
  function place(
    value: Partial<{
      position: [number, number, number];
      rotation: number;
      locationId: string;
    }>,
  ) {
    const selected = selectionRef.current;
    if (!selected) return;
    change((home) => {
      const item =
        selected.kind === "entity"
          ? home.entities.find((e) => e.id === selected.id)
          : home.stocks.find((s) => s.id === selected.id);
      if (!item) return;
      Object.assign(item, value);
      if ("placementConfirmed" in item)
        item.placementConfirmed =
          home.rooms.find((r) => r.id === item.locationId)?.kind === "room";
    });
  }
  function undo() {
    if (!past.length || busy || uncertain) return;
    setFuture((f) => [draft, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
    setStatus("");
  }
  function redo() {
    if (!future.length || busy || uncertain) return;
    setPast((p) => [...p, draft]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
    setStatus("");
  }
  function exit() {
    if (busy) return;
    if (dirty || uncertain) setExitRequested(true);
    else onClose();
  }
  const keyboard = useRef({ undo, redo, exit });
  keyboard.current = { undo, redo, exit };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input,select,textarea"))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        keyboard.current.exit();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? keyboard.current.redo() : keyboard.current.undo();
      }
    };
    window.addEventListener("keydown", listener);
    void request<{ images: string[] }>("/layout-reference")
      .then((value) => setReferences(value.images))
      .catch(() => {});
    return () => window.removeEventListener("keydown", listener);
  }, []);
  useEffect(() => {
    if (!dirty && !uncertain) return;
    const listener = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, [dirty, uncertain]);
  useEffect(() => {
    try {
      scene.current = new HomeScene(
        host.current!,
        setSelection,
        setSceneError,
        () => setSelection(undefined),
      );
      scene.current.setPresentation("natural", false);
    } catch {
      setSceneError("WebGL 暂不可用，仍可用列表和数值调整布局。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.setEditing(
      busy || uncertain
        ? undefined
        : {
            mode,
            snap,
            onChange: (selected, position, rotation) => {
              changeRef.current((home) => {
                const item =
                  selected.kind === "entity"
                    ? home.entities.find((e) => e.id === selected.id)
                    : home.stocks.find((s) => s.id === selected.id);
                if (!item) return;
                if (
                  item.position.every(
                    (n, i) => Math.abs(n - position[i]) < 0.00001,
                  ) &&
                  Math.abs((item.rotation ?? 0) - rotation) < 0.00001
                )
                  return;
                item.position = position.map(
                  (n) => Math.round(n * 1000) / 1000,
                ) as [number, number, number];
                item.rotation = rotation;
                if ("placementConfirmed" in item)
                  item.placementConfirmed =
                    home.rooms.find((r) => r.id === item.locationId)?.kind ===
                    "room";
              });
            },
          },
    );
  }, [mode, snap, busy, uncertain]);
  useEffect(() => {
    scene.current?.update(
      { ...base, home: draft },
      { room: roomId, category: "all", query: "" },
    );
  }, [draft, roomId, base]);
  useEffect(() => {
    scene.current?.select(selection);
  }, [selection, draft]);
  useEffect(() => {
    scene.current?.setView(top ? "top" : "angle");
  }, [top]);
  function addFurniture() {
    const dimensions = furnitureSizes[addKind]!;
    const id = `furniture-${randomUUID()}`,
      assetId = `asset-${randomUUID()}`;
    change((home) => {
      home.assets.push({
        id: assetId,
        name: furnitureNames[addKind]!,
        kind: addKind,
        width: dimensions[0],
        height: dimensions[1],
        depth: dimensions[2],
        color: "#b8aa91",
        provenance: "User-authored furniture; editable approximate dimensions.",
      });
      home.entities.push({
        id,
        name: furnitureNames[addKind]!,
        category: ([...deviceKinds, "plug"] as readonly string[]).includes(
          addKind,
        )
          ? "device"
          : "object",
        scope: "home",
        lifecycle: "active",
        locationId: roomId,
        position: [0, 0, 0],
        rotation: 0,
        ...((structuralKinds as readonly string[]).includes(addKind)
          ? { visibility: "editing" as const }
          : {}),
        placementConfirmed: room.kind === "room",
        assetId,
        description: "手动添加的物件，尺寸可调整。",
        notes: "",
        tags: ["furniture"],
        source: "user",
        asOf: new Date().toISOString().slice(0, 10),
      });
    });
    setSelection({ kind: "entity", id });
  }
  function resizeAsset(field: "width" | "height" | "depth", value: number) {
    if (!record || !asset) return;
    change((home) => {
      const item =
        selection?.kind === "entity"
          ? home.entities.find((e) => e.id === record.id)!
          : home.stocks.find((s) => s.id === record.id)!;
      const previous = home.assets.find((a) => a.id === item.assetId)!;
      if (base.home.assets.some((a) => a.id === previous.id)) {
        const independent = {
          ...previous,
          id: `asset-${randomUUID()}`,
          [field]: value,
        };
        home.assets.push(independent);
        item.assetId = independent.id;
      } else previous[field] = value;
    });
  }
  function downloadDraft() {
    const link = document.createElement("a");
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
    );
    link.href = url;
    link.download = "layout-draft.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function save(retry = false) {
    setBusy(true);
    setError("");
    try {
      if (retry) await retryPending();
      else {
        validateTemplate(draft);
        await command(layoutChanges(base.home, draft), base.revision);
      }
      const next = await request<Dashboard>("/state");
      onState(next);
      setBase(next);
      setDraft(structuredClone(next.home));
      setPast([]);
      setFuture([]);
      setStatus("布局已保存");
      if (exitRequested) onClose();
    } catch (error) {
      setError((error as Error).message);
      const next = await request<Dashboard>("/state").catch(() => undefined);
      if (next) onState(next);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="layout-editor" data-testid="layout-editor">
      <div
        className="editor-viewport home-viewport"
        ref={host}
        data-testid="edit-viewport"
      />
      <header className="editor-toolbar">
        <button className="secondary" onClick={exit} disabled={busy}>
          <ArrowLeft size={16} />
          退出编辑
        </button>
        <strong>
          布局编辑 <span>{dirty ? "未保存" : "已保存"}</span>
        </strong>
        <div className="editor-history">
          <button
            className="icon-button"
            aria-label="撤销布局修改"
            disabled={!past.length || busy || uncertain}
            onClick={undo}
          >
            <Undo2 size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="重做布局修改"
            disabled={!future.length || busy || uncertain}
            onClick={redo}
          >
            <Redo2 size={18} />
          </button>
        </div>
        <button
          className="primary"
          disabled={busy || (!dirty && !uncertain) || (stale && !uncertain)}
          onClick={() => void save(uncertain)}
        >
          <Check size={16} />
          {busy ? "保存中…" : uncertain ? "确认保存结果" : "保存布局"}
        </button>
      </header>
      <aside className="editor-panel" aria-label="布局编辑工具" ref={panel}>
        {exitRequested && (
          <div className="editor-exit" role="alert">
            <p>
              {uncertain
                ? "保存结果尚未确认，请先确认保存结果。"
                : "这轮调整尚未保存。"}
            </p>
            <div>
              <button
                className="secondary"
                onClick={() => setExitRequested(false)}
              >
                继续编辑
              </button>
              <button
                className="secondary"
                disabled={uncertain || busy}
                onClick={onClose}
              >
                放弃修改并退出
              </button>
            </div>
          </div>
        )}
        {stale && !uncertain && (
          <div className="notice" role="alert">
            记录已有新变化，草稿仍保留。请下载草稿备份后，载入最新记录再调整。
            <button className="text-link" onClick={downloadDraft}>
              下载当前草稿
            </button>
            <button
              className="text-link"
              disabled={busy}
              onClick={() => {
                setBase(state);
                setDraft(structuredClone(state.home));
                setPast([]);
                setFuture([]);
                setSelection(undefined);
                setRoomId(
                  state.home.rooms.find((r) => r.id === roomId)?.id ??
                    state.home.rooms[0].id,
                );
                setError("");
              }}
            >
              放弃草稿并载入最新
            </button>
          </div>
        )}
        {uncertain && (
          <p className="notice" role="status">
            上次保存结果待确认；确认会沿用原操作，不会重复添加家具。
          </p>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="muted" role="status">
            {status}
          </p>
        )}
        {sceneError && <p className="notice">{sceneError}</p>}
        <fieldset disabled={busy || uncertain}>
          <div className="editor-modes">
            <button
              className="secondary"
              aria-pressed={mode === "translate"}
              onClick={() => setMode("translate")}
            >
              <Move size={16} />
              移动
            </button>
            <button
              className="secondary"
              aria-pressed={mode === "rotate"}
              onClick={() => setMode("rotate")}
            >
              <RotateCw size={16} />
              旋转
            </button>
            <button
              className="secondary"
              aria-pressed={top}
              onClick={() => setTop((v) => !v)}
            >
              {top ? "切换 3D" : "切换俯视"}
            </button>
          </div>
          <div className="editor-modes editor-framing">
            <button
              className="secondary"
              disabled={!selection}
              onClick={() => scene.current?.inspect()}
            >
              靠近所选
            </button>
            <button
              className="secondary"
              onClick={() => scene.current?.reset()}
            >
              区域总览
            </button>
          </div>
          {conflicts.length > 0 && (
            <details className="notice" open={Boolean(record)}>
              <summary>体积检查 · {conflicts.length} 处可能相交</summary>
              <p>依据实心部分的估算包络；支架关节等细节仍需结合画面核对。</p>
              {conflicts.map(([a, b]) => (
                <p key={a.id + ":" + b.id}>
                  {a.name} ↔ {b.name}
                </p>
              ))}
            </details>
          )}
          <label className="editor-snap">
            <input
              type="checkbox"
              checked={snap}
              onChange={(e) => setSnap(e.target.checked)}
            />
            吸附：0.1 米 / 15°
          </label>
          <p className="editor-help">
            点击物件，再拖动箭头或旋转环。空白处拖动视角，滚轮 /
            双指缩放。尺寸与摆放可在下方输入。
          </p>
          <label className="field">
            编辑区域
            <select
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value);
                setSelection(undefined);
              }}
            >
              {draft.rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.kind !== "room" ? " · 逻辑区域" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            选择物件
            <select
              value={selection ? `${selection.kind}:${selection.id}` : ""}
              onChange={(e) => {
                const [kind, ...rest] = e.target.value.split(":");
                setSelection(
                  e.target.value
                    ? { kind: kind as "entity" | "stock", id: rest.join(":") }
                    : undefined,
                );
              }}
            >
              <option value="">在场景中点击，或在这里选择</option>
              {draft.entities
                .filter(
                  (e) => e.locationId === roomId && e.lifecycle === "active",
                )
                .map((e) => (
                  <option key={e.id} value={`entity:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              {draft.stocks
                .filter((s) => s.locationId === roomId)
                .map((s) => (
                  <option key={s.id} value={`stock:${s.id}`}>
                    {s.name} · 库存
                  </option>
                ))}
            </select>
          </label>
          {record && asset && (
            <section className="editor-object" key={record.id}>
              <h2>{record.name}</h2>
              <p className="editor-help">
                {"placementConfirmed" in record && !record.placementConfirmed
                  ? "初始摆放待确认；手动移动后记录为已确认。"
                  : "手动布局记录"}
                {"description" in record && record.description
                  ? ` ${record.description}`
                  : ""}
              </p>
              <label className="field">
                放入区域
                <select
                  value={record.locationId}
                  onChange={(e) => {
                    place({
                      locationId: e.target.value,
                      position: [0, record.position[1], 0],
                    });
                    setRoomId(e.target.value);
                  }}
                >
                  {draft.rooms
                    .filter((r) =>
                      "scope" in record && record.scope === "remote"
                        ? r.kind === "remote"
                        : r.kind !== "remote",
                    )
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="two-fields">
                <NumberField
                  label="位置 X（米）"
                  value={record.position[0]}
                  min={-room.size[0] / 2}
                  max={room.size[0] / 2}
                  onCommit={(v) =>
                    place({
                      position: [v, record.position[1], record.position[2]],
                    })
                  }
                />
                <NumberField
                  label="位置 Z（米）"
                  value={record.position[2]}
                  min={-room.size[1] / 2}
                  max={room.size[1] / 2}
                  onCommit={(v) =>
                    place({
                      position: [record.position[0], record.position[1], v],
                    })
                  }
                />
                <NumberField
                  label="离地高度（米）"
                  value={record.position[1]}
                  min={0}
                  max={10}
                  onCommit={(v) =>
                    place({
                      position: [record.position[0], v, record.position[2]],
                    })
                  }
                />
                <NumberField
                  label="旋转角度（度）"
                  value={((record.rotation ?? 0) * 180) / Math.PI}
                  min={-3600}
                  max={3600}
                  step={15}
                  onCommit={(v) => place({ rotation: (v * Math.PI) / 180 })}
                />
              </div>
              <div className="editor-nudge" aria-label="微调位置">
                <button
                  className="secondary"
                  aria-label="向左移动 0.1 米"
                  onClick={() =>
                    place({
                      position: [
                        Math.max(-room.size[0] / 2, record.position[0] - 0.1),
                        record.position[1],
                        record.position[2],
                      ],
                    })
                  }
                >
                  ←
                </button>
                <button
                  className="secondary"
                  aria-label="向前移动 0.1 米"
                  onClick={() =>
                    place({
                      position: [
                        record.position[0],
                        record.position[1],
                        Math.max(-room.size[1] / 2, record.position[2] - 0.1),
                      ],
                    })
                  }
                >
                  ↑
                </button>
                <button
                  className="secondary"
                  aria-label="向后移动 0.1 米"
                  onClick={() =>
                    place({
                      position: [
                        record.position[0],
                        record.position[1],
                        Math.min(room.size[1] / 2, record.position[2] + 0.1),
                      ],
                    })
                  }
                >
                  ↓
                </button>
                <button
                  className="secondary"
                  aria-label="向右移动 0.1 米"
                  onClick={() =>
                    place({
                      position: [
                        Math.min(room.size[0] / 2, record.position[0] + 0.1),
                        record.position[1],
                        record.position[2],
                      ],
                    })
                  }
                >
                  →
                </button>
                <button
                  className="secondary"
                  aria-label="旋转 90 度"
                  onClick={() =>
                    place({ rotation: (record.rotation ?? 0) + Math.PI / 2 })
                  }
                >
                  ↻ 90°
                </button>
              </div>
              <div className="two-fields">
                <NumberField
                  label="物件宽度（米）"
                  value={asset.width}
                  min={0.01}
                  max={10}
                  onCommit={(v) => resizeAsset("width", v)}
                />
                <NumberField
                  label="物件深度（米）"
                  disabled={asset.kind === "glb"}
                  value={asset.depth}
                  min={0.01}
                  max={10}
                  onCommit={(v) => resizeAsset("depth", v)}
                />
                <NumberField
                  label="物件高度（米）"
                  disabled={asset.kind === "glb"}
                  value={asset.height}
                  min={0.01}
                  max={10}
                  onCommit={(v) => resizeAsset("height", v)}
                />
              </div>
              {asset.kind === "glb" && (
                <p className="editor-help">
                  导入模型按宽度等比缩放；调整宽度时，深度和高度会跟着一起变。
                </p>
              )}
            </section>
          )}
          <details className="editor-section">
            <summary>区域尺寸（估算，可调整）</summary>
            <div className="two-fields">
              <NumberField
                label="区域宽度（米）"
                value={room.size[0]}
                min={1}
                max={30}
                onCommit={(v) =>
                  change((h) => {
                    const index = h.rooms.findIndex((r) => r.id === roomId);
                    h.rooms[index] = resizedRoom(h.rooms[index], [
                      v,
                      room.size[1],
                    ]);
                  })
                }
              />
              <NumberField
                label="区域长度（米）"
                value={room.size[1]}
                min={1}
                max={30}
                onCommit={(v) =>
                  change((h) => {
                    const index = h.rooms.findIndex((r) => r.id === roomId);
                    h.rooms[index] = resizedRoom(h.rooms[index], [
                      room.size[0],
                      v,
                    ]);
                  })
                }
              />
            </div>
            <p className="editor-help">
              尺寸表示区域的最大宽、长；调整时边界按比例缩放，物件保持原位。若物件中心越界，请先调整再保存。
            </p>
          </details>
          {room.footprint && (
            <details className="editor-section">
              <summary>边界转角（米）</summary>
              <p className="editor-help">
                沿地面轮廓依次排列，X 为东西方向，Z
                为南北方向。门窗与墙体凸起只在编辑时显示，可从物件列表调整。
              </p>
              {room.footprint.map(([x, z], index) => (
                <div className="two-fields" key={index}>
                  {([0, 1] as const).map((axis) => (
                    <NumberField
                      key={axis}
                      label={`转角 ${index + 1} ${axis === 0 ? "X" : "Z"}`}
                      value={axis === 0 ? x : z}
                      min={-room.size[axis] / 2}
                      max={room.size[axis] / 2}
                      step={0.01}
                      onCommit={(v) =>
                        change((h) => {
                          h.rooms.find((r) => r.id === roomId)!.footprint![
                            index
                          ][axis] = v;
                        })
                      }
                    />
                  ))}
                </div>
              ))}
            </details>
          )}
          {room.kind !== "remote" && (
            <details className="editor-section">
              <summary>添加家具</summary>
              <label className="field">
                家具类型
                <select
                  value={addKind}
                  onChange={(e) =>
                    setAddKind(e.target.value as SceneAsset["kind"])
                  }
                >
                  {Object.entries(furnitureNames).map(([kind, name]) => (
                    <option key={kind} value={kind}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <button className="secondary full" onClick={addFurniture}>
                <Plus size={16} />
                添加到当前区域
              </button>
            </details>
          )}
        </fieldset>
        {references.length > 0 && (
          <details className="editor-section">
            <summary>查看四张实拍参考</summary>
            <p className="editor-help">
              照片仅作摆放参考；尺寸以当前物件记录为准，未实测的部分可继续调整。
            </p>
            <div className="reference-photos">
              {references.map((url, i) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  <img
                    src={url}
                    alt={
                      [
                        "卧室朝窗边工作台",
                        "客厅朝东",
                        "卧室朝衣柜",
                        "客厅柜子与移门",
                      ][i]
                    }
                  />
                </a>
              ))}
            </div>
          </details>
        )}
        <p className="editor-help editor-footnote">
          浏览模式里的参考家具在编辑时先收起来。房间里的实物件和新增家具都可以单独调整，点了保存才会写回记录。
        </p>
      </aside>
    </div>
  );
}
