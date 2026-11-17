import { useEffect, useRef, useState } from "react";
import {
  furnitureKinds,
  structuralKinds,
  deviceKinds,
  type Dashboard,
} from "../shared/domain.js";
import { assetFor, isStorage, items, storageGrid } from "../shared/spatial.js";
import { emptyInterior, leaves } from "../shared/compartments.js";
import { CabinetEditor } from "./cabinet-editor.js";
import {
  PhotoEditor,
  PhotoGallery,
  QuickRecord,
  WorldDialog,
  type WorldMutate,
} from "./possession.js";
import { InventoryScene } from "./inventory-scene.js";

const portableFurniture = new Set([
  "keyboard",
  "mouse",
  "microphone",
  "mug",
  "headphones",
]);
const fixedKinds = new Set<string>(
  [...furnitureKinds, ...structuralKinds, ...deviceKinds].filter(
    (kind) => !portableFurniture.has(kind),
  ),
);

export function InventoryWorld({
  state,
  mutate,
  onClose,
  onExample,
}: {
  state: Dashboard;
  mutate: WorldMutate;
  onClose: () => void;
  onExample: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    scene = useRef<InventoryScene | null>(null);
  const [locked, setLocked] = useState(false),
    [selected, setSelected] = useState<string>(),
    [part, setPart] = useState<string>();
  const [edit, setEdit] = useState(false),
    [quick, setQuick] = useState(false),
    [photos, setPhotos] = useState(false),
    [error, setError] = useState(""),
    [target, setTarget] = useState(""),
    [targetPart, setTargetPart] = useState(""),
    [busy, setBusy] = useState(false);
  const all = items(state.home),
    item = all.find((i) => i.id === selected);
  const container =
    item && "category" in item && isStorage(state.home, item)
      ? item
      : undefined;
  const cabinets = state.home.entities.filter(
    (e) =>
      e.lifecycle === "active" &&
      isStorage(state.home, e) &&
      !e.attachment &&
      state.home.rooms.find((r) => r.id === e.locationId)?.kind === "room",
  );
  const containerIds = new Set([
    ...(state.home.storage ?? []).map((s) => s.entityId),
    ...all.flatMap((i) => (i.attachment ? [i.attachment.parentId] : [])),
  ]);
  const uncontained = all.filter((i) =>
    "quantity" in i
      ? i.attachment?.kind !== "storage"
      : i.category === "object" &&
        i.lifecycle === "active" &&
        !i.attachment &&
        !containerIds.has(i.id) &&
        !fixedKinds.has(assetFor(state.home, i).kind),
  );
  const interior = container
    ? (storageGrid(state.home, container.id).interior ?? emptyInterior())
    : undefined;
  const contents = container
    ? all.filter(
        (i) =>
          i.attachment?.kind === "storage" &&
          i.attachment.parentId === container.id &&
          (!part ||
            (i.attachment.compartmentId ?? leaves(interior!)[0].part.id) ===
              part),
      )
    : [];
  useEffect(() => {
    try {
      scene.current = new InventoryScene(
        host.current!,
        (id, compartment) => {
          setSelected(id);
          setPart(compartment);
        },
        setLocked,
      );
    } catch {
      setError("WebGL 暂不可用，请使用收纳位置列表。");
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => scene.current?.update(state.home), [state.home]);
  useEffect(
    () =>
      scene.current?.setPaused(Boolean(selected || edit || quick || photos)),
    [selected, edit, quick, photos],
  );
  async function change(action: Parameters<WorldMutate>[0]) {
    setBusy(true);
    setError("");
    try {
      await mutate(action);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="inventory-world">
      <div
        ref={host}
        className="inventory-viewport"
        data-testid="inventory-viewport"
      />
      <div className="world-toolbar">
        <button onClick={onClose}>← 生活空间</button>
        <div>
          <strong>库存视图</strong>
          <small>透过柜门，看看已经拥有的东西</small>
        </div>
        <button
          onClick={() => {
            setSelected(undefined);
            setQuick(true);
          }}
        >
          记一件物品
        </button>
        <button onClick={onExample}>示例小世界</button>
      </div>
      <div className="inventory-location-bar">
        <label>
          走到这里
          <select
            aria-label="走到收纳位置"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) scene.current?.focus(e.target.value);
            }}
          >
            <option value="" disabled>
              选择柜子 / 抽屉
            </option>
            {cabinets.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => scene.current?.toggleHeight()}>
          切换高度 · 0.4 / 1.6 m
        </button>
        <button
          onClick={() => {
            setSelected(cabinets[0]?.id ?? "__locations");
            setPart(undefined);
          }}
        >
          收纳位置列表
        </button>
        <button onClick={() => setSelected("__uncontained")}>
          待收纳 · {uncontained.length}
        </button>
      </div>
      <div className="walk-help">
        {locked ? "鼠标转向 · Esc 释放鼠标" : "拖动画面转向 · 双击进入鼠标观察"}
        <span>WASD / 方向键移动 · 空格切换高度 · 可穿过墙与家具</span>
      </div>
      <div className="walk-pad" aria-label="移动控制">
        {(["forward", "left", "back", "right"] as const).map((d, i) => (
          <button
            key={d}
            aria-label={["向前移动", "向左移动", "向后移动", "向右移动"][i]}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              scene.current?.walk(d, true);
            }}
            onPointerUp={() => scene.current?.walk(d, false)}
            onPointerCancel={() => scene.current?.walk(d, false)}
          >
            {["↑", "←", "↓", "→"][i]}
          </button>
        ))}
      </div>
      {error && !selected && (
        <p className="world-error" role="alert">
          {error}
        </p>
      )}
      {selected && !edit && !quick && !photos && (
        <WorldDialog
          title={
            item?.name ??
            (selected === "__uncontained" ? "待收纳物品" : "收纳位置")
          }
          onClose={() => setSelected(undefined)}
          busy={busy}
        >
          {selected === "__uncontained" ? (
            <>
              <p className="muted">
                还没有记入柜子或抽屉的物品。选中后可以放进指定隔间。
              </p>
              <div className="inventory-list">
                {uncontained.map((i) => (
                  <button key={i.id} onClick={() => setSelected(i.id)}>
                    <strong>{i.name}</strong>
                    <small>
                      {
                        state.home.rooms.find((r) => r.id === i.locationId)
                          ?.name
                      }
                      {"quantity" in i ? ` · ${i.quantity} ${i.unit}` : ""}
                    </small>
                  </button>
                ))}
              </div>
              {!uncontained.length && (
                <p className="empty">没有待收纳的物品。</p>
              )}
            </>
          ) : container ? (
            <>
              <div className="cabinet-path">
                <span>
                  {
                    state.home.rooms.find((r) => r.id === container.locationId)
                      ?.name
                  }{" "}
                  / {container.name}
                </span>
                <select
                  aria-label="查看隔间"
                  value={part ?? ""}
                  onChange={(e) => setPart(e.target.value || undefined)}
                >
                  <option value="">全部隔间</option>
                  {leaves(interior!).map((r) => (
                    <option key={r.part.id} value={r.part.id}>
                      {r.part.name}
                      {r.part.kind === "drawer" ? " · 抽屉" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="world-fields">
                <button className="secondary" onClick={() => setEdit(true)}>
                  编辑内部空间
                </button>
                <button className="primary" onClick={() => setQuick(true)}>
                  往这里放东西
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    scene.current?.focus(container.id);
                    setSelected(undefined);
                  }}
                >
                  走近这个柜子
                </button>
              </div>
              <div className="inventory-list">
                {contents.map((i) => (
                  <button
                    key={i.id}
                    onClick={() => {
                      setSelected(i.id);
                      setPart(undefined);
                    }}
                  >
                    {i.photos?.[0] ? (
                      <img src={i.photos[0]} alt="" />
                    ) : (
                      <span>◇</span>
                    )}
                    <strong>{i.name}</strong>
                    <small>
                      {"quantity" in i ? `${i.quantity} ${i.unit}` : "一件物品"}{" "}
                      ·{" "}
                      {leaves(interior!).find(
                        (r) => r.part.id === i.attachment?.compartmentId,
                      )?.part.name ?? "整个空间"}
                    </small>
                  </button>
                ))}
              </div>
              {!contents.length && (
                <p className="empty">
                  这里还没有物品。可以先记一个名字，或放几张照片。
                </p>
              )}
              <details>
                <summary>其他收纳位置</summary>
                <div className="world-fields">
                  {cabinets.map((c) => (
                    <button
                      key={c.id}
                      className="secondary"
                      onClick={() => {
                        setSelected(c.id);
                        setPart(undefined);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </details>
            </>
          ) : item ? (
            <>
              <p className="muted">
                {state.home.entities.find(
                  (e) => e.id === item.attachment?.parentId,
                )?.name ??
                  state.home.rooms.find((r) => r.id === item.locationId)
                    ?.name}{" "}
                ·{" "}
                {assetFor(state.home, item).kind === "glb"
                  ? "模型外观"
                  : "文字 / 基础造型"}
              </p>
              <PhotoGallery photos={item.photos} />
              <p className="object-story">{item.notes || "还没有备注。"}</p>
              {"quantity" in item && (
                <div className="inventory-quantity">
                  <button
                    disabled={busy || item.quantity === 0}
                    onClick={() =>
                      void change({
                        type: "stock.adjust",
                        stockId: item.id,
                        delta: -1,
                      })
                    }
                  >
                    −
                  </button>
                  <strong>
                    {item.quantity} {item.unit}
                  </strong>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void change({
                        type: "stock.adjust",
                        stockId: item.id,
                        delta: 1,
                      })
                    }
                  >
                    ＋
                  </button>
                </div>
              )}
              <button className="secondary" onClick={() => setPhotos(true)}>
                编辑照片
              </button>
              <fieldset disabled={busy}>
                <legend>换个位置</legend>
                <label className="field">
                  目标柜子
                  <select
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value);
                      setTargetPart("");
                    }}
                  >
                    <option value="">选择收纳位置</option>
                    {cabinets
                      .filter((c) => c.id !== item.id)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </label>
                {target && (
                  <label className="field">
                    目标隔间
                    <select
                      value={targetPart}
                      onChange={(e) => setTargetPart(e.target.value)}
                    >
                      <option value="">第一个隔间</option>
                      {leaves(
                        storageGrid(state.home, target).interior ??
                          emptyInterior(),
                      ).map((r) => (
                        <option key={r.part.id} value={r.part.id}>
                          {r.part.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  className="primary"
                  disabled={!target}
                  onClick={() =>
                    void change({
                      type: "storage.place",
                      itemId: item.id,
                      containerId: target,
                      ...(targetPart && storageGrid(state.home, target).interior
                        ? { compartmentId: targetPart }
                        : {}),
                    })
                  }
                >
                  确认移动
                </button>
              </fieldset>
              {item.attachment && (
                <button
                  className="text-link"
                  onClick={() => {
                    setSelected(item.attachment!.parentId);
                    setPart(item.attachment?.compartmentId);
                  }}
                >
                  返回所属柜子
                </button>
              )}
            </>
          ) : (
            <div className="world-fields">
              {cabinets.map((c) => (
                <button key={c.id} onClick={() => setSelected(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
        </WorldDialog>
      )}
      {edit && container && (
        <CabinetEditor
          state={state}
          container={container}
          mutate={mutate}
          onClose={() => setEdit(false)}
        />
      )}
      {quick && (
        <QuickRecord
          state={state}
          mutate={mutate}
          containerId={container?.id}
          compartmentId={part}
          onClose={() => setQuick(false)}
          onSaved={(id) => {
            setQuick(false);
            setSelected(id);
            setPart(undefined);
          }}
        />
      )}
      {photos && item && (
        <PhotoEditor
          state={state}
          itemId={item.id}
          mutate={mutate}
          onClose={() => setPhotos(false)}
        />
      )}
    </div>
  );
}
