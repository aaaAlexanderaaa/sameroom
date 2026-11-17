import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import type { Dashboard, Entity } from "../shared/domain.js";
import {
  emptyInterior,
  mergeRegion,
  regions,
  splitRegion,
  type Interior,
} from "../shared/compartments.js";
import { assetFor, storageGrid } from "../shared/spatial.js";
import { pendingCommand } from "./api.js";
import { WorldDialog, type WorldMutate } from "./possession.js";

function formatCabinetNumber(value: number) {
  return String(Math.round(value * 10) / 10);
}

function CabinetNumberField({
  label,
  ariaLabel,
  resetKey,
  value,
  min,
  max,
  step,
  onLiveChange,
}: {
  label: string;
  ariaLabel: string;
  resetKey: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onLiveChange: (value: number, recordUndo: boolean) => void;
}) {
  const [text, setText] = useState(() => formatCabinetNumber(value));
  const focused = useRef(false);
  const pushedUndo = useRef(false);
  const lastResetKey = useRef(resetKey);

  useEffect(() => {
    if (lastResetKey.current !== resetKey) {
      lastResetKey.current = resetKey;
      focused.current = false;
      pushedUndo.current = false;
      setText(formatCabinetNumber(value));
      return;
    }
    if (!focused.current) setText(formatCabinetNumber(value));
  }, [value, resetKey]);

  function commit() {
    focused.current = false;
    const raw = text.trim();
    const parsed = Number(raw);
    if (!raw || !Number.isFinite(parsed)) {
      pushedUndo.current = false;
      setText(formatCabinetNumber(value));
      return;
    }
    const clamped = Math.max(min, Math.min(max, parsed));
    if (Math.abs(clamped - value) > 0.05) {
      onLiveChange(clamped, !pushedUndo.current);
    }
    pushedUndo.current = false;
    setText(formatCabinetNumber(clamped));
  }

  return (
    <label className="field">
      {label}
      <input
        aria-label={ariaLabel}
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        onFocus={() => {
          focused.current = true;
          pushedUndo.current = false;
        }}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          const trimmed = next.trim();
          const parsed = Number(trimmed);
          if (
            trimmed &&
            Number.isFinite(parsed) &&
            parsed >= min &&
            parsed <= max
          ) {
            onLiveChange(parsed, !pushedUndo.current);
            pushedUndo.current = true;
          }
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}

export function CabinetEditor({
  state,
  container,
  mutate,
  onClose,
}: {
  state: Dashboard;
  container: Entity;
  mutate: WorldMutate;
  onClose: () => void;
}) {
  const initial = useRef(
    storageGrid(state.home, container.id).interior ?? emptyInterior(),
  );
  const [draft, setDraft] = useState<Interior>(
    structuredClone(initial.current),
  );
  const [selected, setSelected] = useState(draft.root),
    [past, setPast] = useState<Interior[]>([]),
    [future, setFuture] = useState<Interior[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [closing, setClosing] = useState(false);
  const [revision, setRevision] = useState(state.revision);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ id: string; before: Interior } | undefined>(undefined);
  const appearance = assetFor(state.home, container),
    all = regions(draft),
    current = all.find((r) => r.part.id === selected) ?? all[0];
  const divider = current.part.split
    ? current
    : all.find((r) => r.part.id === current.parent);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current),
    uncertain = pendingCommand()?.action.type === "storage.configure";
  function change(next: Interior) {
    if (busy || uncertain) return;
    setPast((p) => [...p, draft].slice(-50));
    setFuture([]);
    setDraft(next);
  }
  function ratio(value: number, recordUndo = true) {
    if (!divider?.part.split || busy || uncertain) return;
    const next = structuredClone(draft);
    next.parts.find((p) => p.id === divider.part.id)!.split!.ratio = Math.max(
      0.08,
      Math.min(0.92, value),
    );
    if (recordUndo) change(next);
    else setDraft(next);
  }
  const span =
    divider?.part.split?.axis === "x"
      ? divider.width * appearance.width * 100
      : (divider?.height ?? 1) * appearance.height * 100;
  async function save() {
    setBusy(true);
    setError("");
    try {
      const pending = pendingCommand();
      await mutate(
        pending?.action.type === "storage.configure"
          ? pending.action
          : {
              type: "storage.configure",
              storage: {
                ...storageGrid(state.home, container.id),
                interior: draft,
              },
            },
        revision,
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorldDialog
      title={`${container.name} · 编辑内部空间`}
      busy={busy}
      onClose={() => (dirty ? setClosing(true) : onClose())}
    >
      <p className="muted">
        柜子正面 · 点一格分隔，拖动分隔线调整。上方就是柜子的上层。
      </p>
      <div className="cabinet-editor">
        <svg
          ref={svg}
          className="cabinet-plan"
          viewBox="0 0 600 600"
          preserveAspectRatio="none"
          role="group"
          aria-label="柜内二维分区"
          style={{ aspectRatio: appearance.width / appearance.height }}
          onPointerMove={(e) => {
            if (!drag.current || !svg.current || busy || uncertain) return;
            const bounds = svg.current.getBoundingClientRect(),
              target = all.find((r) => r.part.id === drag.current!.id)!;
            const axis = target.part.split!.axis,
              p =
                axis === "x"
                  ? (e.clientX - bounds.left) / bounds.width
                  : (e.clientY - bounds.top) / bounds.height;
            const value =
              (p - (axis === "x" ? target.x : target.y)) /
              (axis === "x" ? target.width : target.height);
            const next = structuredClone(draft);
            next.parts.find((p) => p.id === target.part.id)!.split!.ratio =
              Math.max(0.08, Math.min(0.92, value));
            setDraft(next);
          }}
          onPointerUp={() => {
            if (drag.current) {
              const before = drag.current.before;
              setPast((p) => [...p, before].slice(-50));
              setFuture([]);
              drag.current = undefined;
            }
          }}
          onPointerCancel={() => {
            if (drag.current) {
              setDraft(drag.current.before);
              drag.current = undefined;
            }
          }}
        >
          {all
            .filter((r) => !r.part.split)
            .map((r) => (
              <g
                key={r.part.id}
                role="button"
                tabIndex={0}
                aria-label={`选择隔间 ${r.part.name}`}
                onClick={() => setSelected(r.part.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setSelected(r.part.id);
                }}
              >
                <rect
                  x={r.x * 600 + 2}
                  y={r.y * 600 + 2}
                  width={r.width * 600 - 4}
                  height={r.height * 600 - 4}
                  rx={5}
                  fill={
                    selected === r.part.id
                      ? "#c9dfce"
                      : r.part.kind === "drawer"
                        ? "#e8d8bd"
                        : "#f1eee5"
                  }
                  stroke={selected === r.part.id ? "#416454" : "#aaa99b"}
                  strokeWidth={selected === r.part.id ? 4 : 1}
                />
                <text
                  x={(r.x + r.width / 2) * 600}
                  y={(r.y + r.height / 2) * 600}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={18}
                >
                  {r.part.name.slice(0, 12)}
                </text>
                {r.part.kind === "drawer" && (
                  <line
                    x1={(r.x + r.width * 0.35) * 600}
                    x2={(r.x + r.width * 0.65) * 600}
                    y1={(r.y + r.height * 0.75) * 600}
                    y2={(r.y + r.height * 0.75) * 600}
                    stroke="#947f5f"
                    strokeWidth={6}
                  />
                )}
              </g>
            ))}
          {all
            .filter((r) => r.part.split)
            .map((r) => {
              const s = r.part.split!,
                x = (r.x + r.width * s.ratio) * 600,
                y = (r.y + r.height * s.ratio) * 600;
              return (
                <line
                  key={r.part.id}
                  className="cabinet-divider"
                  role="slider"
                  tabIndex={0}
                  aria-label={`分隔线 ${r.part.name}`}
                  aria-valuemin={8}
                  aria-valuemax={92}
                  aria-valuenow={Math.round(s.ratio * 100)}
                  x1={s.axis === "x" ? x : r.x * 600}
                  x2={s.axis === "x" ? x : (r.x + r.width) * 600}
                  y1={s.axis === "y" ? y : r.y * 600}
                  y2={s.axis === "y" ? y : (r.y + r.height) * 600}
                  onPointerDown={(e) => {
                    if (busy || uncertain) return;
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = {
                      id: r.part.id,
                      before: structuredClone(draft),
                    };
                    setSelected(r.part.id);
                  }}
                  onKeyDown={(e) => {
                    if (busy || uncertain) return;
                    if (
                      [
                        "ArrowLeft",
                        "ArrowDown",
                        "ArrowRight",
                        "ArrowUp",
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      const next = structuredClone(draft);
                      next.parts.find((p) => p.id === r.part.id)!.split!.ratio =
                        Math.max(
                          0.08,
                          Math.min(
                            0.92,
                            s.ratio +
                              (["ArrowLeft", "ArrowUp"].includes(e.key)
                                ? -0.02
                                : 0.02),
                          ),
                        );
                      change(next);
                    }
                  }}
                />
              );
            })}
        </svg>
        <fieldset disabled={busy || uncertain} className="cabinet-fields">
          <label className="field">
            区域名称
            <input
              maxLength={80}
              value={current.part.name}
              onChange={(e) => {
                const next = structuredClone(draft);
                next.parts.find((p) => p.id === current.part.id)!.name =
                  e.target.value;
                change(next);
              }}
            />
          </label>
          {!current.part.split && (
            <>
              <label className="field">
                区域类型
                <select
                  value={current.part.kind}
                  onChange={(e) => {
                    const next = structuredClone(draft);
                    next.parts.find((p) => p.id === current.part.id)!.kind = e
                      .target.value as "shelf" | "drawer";
                    change(next);
                  }}
                >
                  <option value="shelf">开放隔间</option>
                  <option value="drawer">抽屉</option>
                </select>
              </label>
              <div className="world-fields">
                {(["y", "x"] as const).map((axis) => (
                  <button
                    type="button"
                    className="secondary"
                    key={axis}
                    disabled={draft.parts.length >= 63}
                    onClick={() => {
                      const first = `c-${uuid()}`,
                        second = `c-${uuid()}`;
                      change(
                        splitRegion(
                          draft,
                          current.part.id,
                          axis,
                          first,
                          second,
                        ),
                      );
                      setSelected(first);
                    }}
                  >
                    {axis === "y" ? "上下分隔" : "左右分隔"}
                  </button>
                ))}
              </div>
            </>
          )}
          {divider?.part.split && (
            <>
              <CabinetNumberField
                label={`${divider.part.split.axis === "x" ? "左侧占比" : "上方占比"}（%）`}
                ariaLabel="分隔比例"
                resetKey={divider.part.id}
                value={divider.part.split.ratio * 100}
                min={8}
                max={92}
                step={1}
                onLiveChange={(v, recordUndo) => ratio(v / 100, recordUndo)}
              />
              <CabinetNumberField
                label={`${divider.part.split.axis === "x" ? "距区域左侧" : "距区域顶部"}（cm）`}
                ariaLabel="分隔距离"
                resetKey={divider.part.id}
                value={divider.part.split.ratio * span}
                min={span * 0.08}
                max={span * 0.92}
                step={1}
                onLiveChange={(v, recordUndo) => ratio(v / span, recordUndo)}
              />
              <small>
                输入占比支持 8%–92%，失去焦点或按回车生效；要恢复整格请点合并。
              </small>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  change(mergeRegion(draft, divider.part.id));
                  setSelected(divider.part.id);
                }}
              >
                合并这两部分
              </button>
            </>
          )}
          <small>
            柜体约 {Math.round(appearance.width * 100)} ×{" "}
            {Math.round(appearance.height * 100)}{" "}
            cm。分区随柜体同比例变化，物品记录会保留。
          </small>
          <div className="world-fields">
            <button
              className="secondary"
              type="button"
              disabled={!past.length}
              onClick={() => {
                setFuture((f) => [draft, ...f]);
                setDraft(past.at(-1)!);
                setPast((p) => p.slice(0, -1));
                setSelected(draft.root);
              }}
            >
              撤销
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!future.length}
              onClick={() => {
                setPast((p) => [...p, draft]);
                setDraft(future[0]);
                setFuture((f) => f.slice(1));
                setSelected(draft.root);
              }}
            >
              重做
            </button>
          </div>
        </fieldset>
      </div>
      {state.revision !== revision && !uncertain && (
        <p className="notice">
          其他记录已更新。草稿仍保留。
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
      {closing && (
        <div className="notice">
          内部空间尚未保存。
          <button onClick={() => setClosing(false)}>继续编辑</button>
          <button onClick={onClose}>放弃修改并退出</button>
        </div>
      )}
      <button
        className="primary full"
        disabled={
          busy ||
          (!uncertain && state.revision !== revision) ||
          draft.parts.some((p) => !p.name.trim())
        }
        onClick={() => void save()}
      >
        {busy ? "正在保存…" : uncertain ? "确认保存结果" : "保存内部空间"}
      </button>
    </WorldDialog>
  );
}
