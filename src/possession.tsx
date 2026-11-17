import { useEffect, useRef, useState, type ReactNode } from "react";
import { v4 as uuid } from "uuid";
import {
  pointInFootprint,
  type Action,
  type Dashboard,
  type Entity,
  type SceneAsset,
  type Stock,
} from "../shared/domain.js";
import { isStorage, items, storageGrid } from "../shared/spatial.js";
import { leaves } from "../shared/compartments.js";
import { pendingCommand, request } from "./api.js";

export type WorldMutate = (action: Action, revision?: number) => Promise<void>;
export function WorldDialog({
  title,
  children,
  onClose,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="world-dialog-backdrop"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        className="world-dialog"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape" && !busy) onClose();
          if (e.key === "Tab") {
            const controls = [
              ...e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
              ),
            ];
            const first = controls[0],
              last = controls.at(-1);
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                document.activeElement === box.current)
            ) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <header>
          <div>
            <span className="tiny-label">HOME ATLAS</span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            aria-label="关闭窗口"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
export function PhotoPicker({
  photos,
  onChange,
  onBusy,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    if (photos.length + files.length > 8) {
      setError("最多保存 8 张照片。");
      return;
    }
    setError("");
    setUploading(true);
    onBusy(true);
    const next = [...photos];
    const selectedFiles = Array.from(files);
    try {
      for (const file of selectedFiles) {
        const body = new FormData();
        body.set("image", file);
        const photo = await request<{ url: string }>("/uploads", body);
        if (!next.includes(photo.url)) next.push(photo.url);
        onChange([...next]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      onBusy(false);
    }
  }
  return (
    <section className="photo-picker">
      <label className="field">
        物品照片（可选，最多 8 张）
        <input
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          disabled={uploading || photos.length >= 8}
          onChange={(e) => {
            void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      <p className="muted">照片直接保存到这件物品，不需要生成模型。</p>
      <div className="possession-photos">
        {photos.map((url, i) => (
          <figure key={url}>
            <img src={url} alt={`物品照片 ${i + 1}`} />
            <button
              type="button"
              disabled={uploading}
              aria-label={`移除照片 ${i + 1}`}
              onClick={() => onChange(photos.filter((p) => p !== url))}
            >
              ×
            </button>
          </figure>
        ))}
      </div>
      {uploading && <p role="status">正在保存照片…</p>}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
    </section>
  );
}
export function PhotoGallery({ photos }: { photos?: string[] }) {
  const [selected, setSelected] = useState<string>();
  return (
    <>
      <div className="possession-photos">
        {photos?.map((url, i) => (
          <button
            className="photo-thumb"
            key={url}
            onClick={() => setSelected(url)}
          >
            <img src={url} alt={`物品照片 ${i + 1}`} />
          </button>
        ))}
      </div>
      {selected && (
        <WorldDialog title="物品照片" onClose={() => setSelected(undefined)}>
          <img className="photo-large" src={selected} alt="物品照片大图" />
        </WorldDialog>
      )}
    </>
  );
}
export function PhotoEditor({
  itemId,
  state,
  mutate,
  onClose,
}: {
  itemId: string;
  state: Dashboard;
  mutate: WorldMutate;
  onClose: () => void;
}) {
  const item = items(state.home).find((i) => i.id === itemId)!;
  const [photos, setPhotos] = useState(item.photos ?? []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(state.revision);
  const pending = pendingCommand();
  const uncertain =
    pending?.action.type === "item.photos" && pending.action.itemId === itemId;
  return (
    <WorldDialog title="编辑物品照片" onClose={onClose} busy={busy}>
      <fieldset disabled={busy || uncertain}>
        <PhotoPicker photos={photos} onChange={setPhotos} onBusy={setBusy} />
      </fieldset>
      {state.revision !== revision && !uncertain && (
        <p className="notice">
          其他记录已更新，照片草稿仍保留。
          <button onClick={() => setRevision(state.revision)}>
            已核对，使用当前版本保存
          </button>
        </p>
      )}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary"
        disabled={busy || (!uncertain && state.revision !== revision)}
        onClick={async () => {
          setBusy(true);
          try {
            await mutate(
              uncertain
                ? pending.action
                : { type: "item.photos", itemId, photos },
              revision,
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {uncertain ? "确认保存结果" : "保存照片"}
      </button>
    </WorldDialog>
  );
}
export function QuickRecord({
  state,
  mutate,
  containerId,
  compartmentId,
  onClose,
  onSaved,
}: {
  state: Dashboard;
  mutate: WorldMutate;
  containerId?: string;
  compartmentId?: string;
  onClose: () => void;
  onSaved: (id: string, stock: boolean) => void;
}) {
  const containers = state.home.entities.filter(
    (e) =>
      isStorage(state.home, e) &&
      e.lifecycle === "active" &&
      state.home.rooms.find((r) => r.id === e.locationId)?.kind === "room",
  );
  const [name, setName] = useState(""),
    [notes, setNotes] = useState(""),
    [photos, setPhotos] = useState<string[]>([]);
  const [container, setContainer] = useState(containerId ?? ""),
    [compartment, setCompartment] = useState(compartmentId ?? "");
  const [location, setLocation] = useState(
    state.home.rooms.find((r) => r.kind === "unplaced")?.id ??
      state.home.rooms.find((r) => r.kind === "room")?.id ??
      "",
  );
  const [kind, setKind] = useState<SceneAsset["kind"]>("label"),
    [stock, setStock] = useState(false),
    [quantity, setQuantity] = useState(1),
    [unit, setUnit] = useState("件");
  const [width, setWidth] = useState(12),
    [height, setHeight] = useState(16),
    [depth, setDepth] = useState(10),
    [dimensions, setDimensions] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = pendingCommand(),
    frozen = pending?.action.type === "item.record";
  const interior = storageGrid(state.home, container).interior;
  async function save() {
    setBusy(true);
    setError("");
    try {
      let action: Extract<Action, { type: "item.record" }>;
      if (frozen) action = pending.action as typeof action;
      else {
        const id = `item-${uuid()}`,
          assetId = `asset-${uuid()}`;
        const parent = containers.find((e) => e.id === container);
        const room = state.home.rooms.find(
          (r) => r.id === (parent?.locationId ?? location),
        )!;
        const asset: SceneAsset = {
          id: assetId,
          name,
          kind,
          width: width / 100,
          height: height / 100,
          depth: depth / 100,
          color: "#b1c3ab",
          provenance: dimensions
            ? "Owner-entered approximate dimensions"
            : "Labelled schematic placeholder; dimensions unmeasured",
        };
        // The required coordinate is only a reference until the owner places it.
        // A concave room's centre can be outside its floor; a boundary vertex is valid.
        const reference: [number, number, number] =
          room.footprint && !pointInFootprint(0, 0, room.footprint)
            ? [room.footprint[0][0], 0, room.footprint[0][1]]
            : [0, 0, 0];
        const base = {
          id,
          name,
          assetId,
          locationId: room.id,
          position: parent?.position ?? reference,
          rotation: 0,
          photos,
          notes,
        };
        const item: Entity | Stock = stock
          ? {
              ...base,
              sku: id,
              unit,
              quantity,
              threshold: 0,
              capacity: 100000,
              sample: false,
            }
          : {
              ...base,
              category: "object",
              scope: "home",
              lifecycle: "active",
              placementConfirmed: Boolean(parent),
              description: dimensions
                ? "大致尺寸已记录"
                : "文字 / 照片记录（暂用基础模型）",
              tags: [],
              source: "user",
              asOf: new Date().toISOString(),
            };
        action = {
          type: "item.record",
          asset,
          item,
          ...(container
            ? {
                containerId: container,
                ...(compartment ? { compartmentId: compartment } : {}),
              }
            : {}),
        };
      }
      await mutate(action);
      onSaved(action.item.id, "quantity" in action.item);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorldDialog title="记下一件物品" onClose={onClose} busy={busy}>
      <p className="muted">
        一个名字，就可以留住它的位置。照片、尺寸和模型都可以慢慢补。
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy || frozen}>
          <label className="field">
            物品名称
            <input
              required
              maxLength={160}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：洗衣凝珠、备用转接头"
            />
          </label>
          <label className="field">
            放在哪里
            <select
              value={container}
              onChange={(e) => {
                setContainer(e.target.value);
                setCompartment("");
              }}
            >
              <option value="">先记录房间 / 待定位</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {container && interior ? (
            <label className="field">
              隔间 / 抽屉
              <select
                value={compartment || leaves(interior)[0].part.id}
                onChange={(e) => setCompartment(e.target.value)}
              >
                {leaves(interior).map((r) => (
                  <option key={r.part.id} value={r.part.id}>
                    {r.part.name}
                    {r.part.kind === "drawer" ? " · 抽屉" : ""}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            !container && (
              <label className="field">
                所在区域
                <select
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                >
                  {state.home.rooms
                    .filter((r) => r.kind !== "remote")
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
                <small>仅记录区域，精确位置保持待确认。</small>
              </label>
            )
          )}
          <label className="check-field">
            <input
              type="checkbox"
              checked={stock}
              onChange={(e) => setStock(e.target.checked)}
            />
            这是需要记录数量的消耗品 / 库存
          </label>
          {stock && (
            <div className="world-fields">
              <label className="field">
                数量
                <input
                  type="number"
                  min={0}
                  max={100000}
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                />
              </label>
              <label className="field">
                单位
                <input
                  required
                  maxLength={30}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                />
              </label>
            </div>
          )}
          <label className="field">
            基础造型
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as SceneAsset["kind"])}
            >
              <option value="label">文字占位</option>
              <option value="box">盒子</option>
              <option value="bottle">瓶罐</option>
              <option value="bag">袋子</option>
            </select>
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={dimensions}
              onChange={(e) => setDimensions(e.target.checked)}
            />
            填写大致尺寸
          </label>
          {dimensions && (
            <div className="world-fields">
              {(
                [
                  ["宽", width, setWidth],
                  ["高", height, setHeight],
                  ["深", depth, setDepth],
                ] as const
              ).map(([label, value, set]) => (
                <label className="field" key={label}>
                  {label}（cm）
                  <input
                    type="number"
                    required
                    min={1}
                    max={1000}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          )}
          <PhotoPicker photos={photos} onChange={setPhotos} onBusy={setBusy} />
          <label className="field">
            故事 / 备注
            <textarea
              maxLength={4000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
        </fieldset>
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {frozen && (
          <p className="notice">上次保存结果待确认，将继续核实同一次录入。</p>
        )}
        <button
          type="submit"
          className="primary full"
          disabled={busy || (!frozen && !name.trim())}
        >
          {busy ? "正在保存…" : frozen ? "确认保存结果" : "保存物品"}
        </button>
      </form>
    </WorldDialog>
  );
}
