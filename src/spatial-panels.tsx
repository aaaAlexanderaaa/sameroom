import { useState } from "react";
import { leaves } from "../shared/compartments.js";
import {
  Boxes,
  Cpu,
  Package,
  ArrowUpRight,
  Move,
  RotateCw,
} from "lucide-react";
import {
  eligible,
  isStorage,
  isSurface,
  items,
  assetFor,
  storageGrid,
  planSurface,
  rotate,
  footprint,
  inspectionItems,
  type SpatialItem,
  type TaskMode,
  type Point2,
} from "../shared/spatial.js";
import {
  entityObservation,
  observationState,
  type Action,
  type Dashboard,
  type Entity,
} from "../shared/domain.js";

export const taskNames: Record<TaskMode, string> = {
  browse: "空间浏览",
  devices: "设备管理",
  inventory: "库存管理",
};
type Mutate = (action: Action) => Promise<void>;
export function TaskOverview({
  state,
  task,
  room,
  onSelect,
  onAdd,
}: {
  state: Dashboard;
  task: TaskMode;
  room: string;
  onSelect: (item: SpatialItem) => void;
  onAdd: () => void;
}) {
  const home = state.home;
  const scoped = items(home).filter(
    (i) => (room === "all" || i.locationId === room) && eligible(home, i, task),
  );
  const devices = scoped.filter(
    (i): i is Entity => "category" in i && eligible(home, i, "devices"),
  );
  const stocks = scoped.filter((i) => "quantity" in i);
  const containers = scoped.filter(
    (i): i is Entity => "category" in i && isStorage(home, i),
  );
  const alerts = state.incidents.filter(
    (i) =>
      i.state !== "resolved" &&
      devices.some(
        (d) =>
          i.subjectId === d.id ||
          home.services.some(
            (s) => s.entityId === d.id && s.id === i.subjectId,
          ),
      ),
  );
  const observed = devices.filter((i) =>
    ["up", "down"].includes(observationState(entityObservation(state, i.id))),
  ).length;
  const cards =
    task === "devices"
      ? devices
      : task === "inventory"
        ? [...containers, ...stocks]
        : scoped;
  return (
    <section className="task-overview">
      <span className="tiny-label">
        {room === "all"
          ? "整个家庭"
          : home.rooms.find((r) => r.id === room)?.name}{" "}
        / {taskNames[task]}
      </span>
      <h3>
        {task === "devices"
          ? "设备与服务"
          : task === "inventory"
            ? "每样东西，各有所属"
            : "这个区域有什么"}
      </h3>
      <div className="scope-metrics">
        <div>
          <strong>{cards.length}</strong>
          <span>{task === "devices" ? "台设备" : "项记录"}</span>
        </div>
        <div>
          <strong>
            {task === "devices" ? alerts.length : containers.length}
          </strong>
          <span>{task === "devices" ? "项待关注" : "处收纳空间"}</span>
        </div>
        <div>
          <strong>
            {task === "devices"
              ? home.services.filter((s) =>
                  devices.some((d) => d.id === s.entityId),
                ).length
              : stocks.filter(
                  (s) => "quantity" in s && s.quantity <= s.threshold,
                ).length}
          </strong>
          <span>{task === "devices" ? "个服务" : "项待补货"}</span>
        </div>
      </div>
      <p className="muted">
        {task === "devices"
          ? "点设备查看状态、供电关系与服务。家具只提供位置参照。"
          : task === "inventory"
            ? "点柜子进入收纳格位，点库存调整数量。格位按平时收纳习惯划分。"
            : "选一件物品靠近查看，或切换任务整理设备和库存。"}
      </p>
      {task === "devices" && (
        <p className="observation-coverage">
          {observed} / {devices.length} 台设备有近期观测，其余状态未知或已过期。
        </p>
      )}
      {alerts.map((i) => (
        <button
          className="scope-alert"
          key={i.id}
          onClick={() => {
            const id =
              home.services.find((s) => s.id === i.subjectId)?.entityId ??
              i.subjectId;
            const item = home.entities.find((e) => e.id === id);
            if (item) onSelect(item);
          }}
        >
          <strong>{i.message}</strong>
          <small>
            {i.demo ? "演示事件" : i.source} ·{" "}
            {i.state === "acknowledged" ? "已知悉，待来源恢复" : "待处理"}
          </small>
        </button>
      ))}
      <div className="scope-records">
        {cards.map((item) => (
          <button
            className="scope-record"
            key={item.id}
            onClick={() => onSelect(item)}
          >
            {"quantity" in item ? (
              <Boxes size={19} />
            ) : task === "devices" ? (
              <Cpu size={19} />
            ) : (
              <Package size={19} />
            )}
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.attachment
                  ? home.entities.find(
                      (e) => e.id === item.attachment?.parentId,
                    )?.name
                  : home.rooms.find((r) => r.id === item.locationId)?.name}
              </small>
            </span>
            {"quantity" in item ? (
              <b>
                {item.quantity}
                <small>{item.unit}</small>
              </b>
            ) : (
              <ArrowUpRight size={15} />
            )}
          </button>
        ))}
      </div>
      {!cards.length && <p className="empty">当前范围还没有这类记录。</p>}
      <button className="secondary full" onClick={onAdd}>
        录入物品 / 导入模型
      </button>
    </section>
  );
}

export function StoragePanel({
  state,
  container,
  mutate,
  onSelect,
}: {
  state: Dashboard;
  container: Entity;
  mutate: Mutate;
  onSelect: (item: SpatialItem) => void;
}) {
  const { home } = state,
    grid = storageGrid(home, container.id);
  const all = items(home),
    contents = all.filter(
      (i) =>
        i.attachment?.kind === "storage" &&
        i.attachment.parentId === container.id,
    );
  const [chosen, setChosen] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [columns, setColumns] = useState(grid.columns),
    [rows, setRows] = useState(grid.rows);
  const candidates = all.filter(
    (i) =>
      i.id !== container.id &&
      (!("scope" in i) ||
        (i.scope === "home" &&
          i.lifecycle === "active" &&
          i.visibility !== "editing")),
  );
  const move = async (id: string, slot: number) => {
    setError("");
    setBusy(true);
    try {
      await mutate({
        type: "storage.place",
        itemId: id,
        containerId: container.id,
        slot,
      });
      setChosen("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (a: Action) => {
    setBusy(true);
    setError("");
    try {
      await mutate(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chosenItem = all.find((i) => i.id === chosen);
  if (grid.interior)
    return (
      <section
        className="storage-panel"
        aria-label={`${container.name}的收纳空间`}
      >
        <p className="muted">{contents.length} 项物品 · 按隔间和抽屉整理</p>
        {leaves(grid.interior).map((region) => (
          <section key={region.part.id}>
            <h4>
              {region.part.name}
              {region.part.kind === "drawer" ? " · 抽屉" : ""}
            </h4>
            <div className="scope-records">
              {contents
                .filter(
                  (i) =>
                    (i.attachment?.compartmentId ??
                      leaves(grid.interior!)[0].part.id) === region.part.id,
                )
                .map((item) => (
                  <button
                    className="scope-record"
                    key={item.id}
                    onClick={() => onSelect(item)}
                  >
                    <span>{item.name}</span>
                    {"quantity" in item && (
                      <b>
                        {item.quantity} {item.unit}
                      </b>
                    )}
                  </button>
                ))}
            </div>
          </section>
        ))}
        <p className="muted">在库存视图中可以走近柜子、拉开抽屉和移动物品。</p>
      </section>
    );
  return (
    <section
      className="storage-panel"
      aria-label={`${container.name}的收纳空间`}
    >
      <div className="storage-heading">
        <div>
          <span className="tiny-label">CONTENTS</span>
          <h3>打开收纳空间</h3>
        </div>
        <span>
          {contents.length} / {grid.columns * grid.rows} 格
        </span>
      </div>
      <p className="muted">
        逻辑格位 ·
        用来整理物品，不推测柜内结构。每格可放一件设备或一组同类库存。
      </p>
      <label className="field">
        选择要收纳 / 移动的物品
        <select
          aria-label="选择收纳物品"
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
        >
          <option value="">选择一项，再点空格位</option>
          {candidates.map((i) => (
            <option value={i.id} key={i.id}>
              {i.name}
              {i.attachment ? " · 已有位置" : ""}
            </option>
          ))}
        </select>
      </label>
      <div
        className="storage-grid"
        style={{ gridTemplateColumns: `repeat(${grid.columns},minmax(0,1fr))` }}
        aria-label="收纳格位"
      >
        {Array.from({ length: grid.columns * grid.rows }, (_, slot) => {
          const item = contents.find((i) => i.attachment?.slot === slot);
          return (
            <button
              key={slot}
              className={`storage-slot ${item ? "filled" : ""} ${item?.id === chosen ? "chosen" : ""}`}
              disabled={busy}
              aria-label={`格位 ${slot + 1}${item ? " " + item.name : " 空闲"}`}
              draggable={Boolean(item)}
              onDragStart={(e) => {
                if (item) e.dataTransfer.setData("text/plain", item.id);
              }}
              onDragOver={(e) => {
                if (!item) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                if (!item && candidates.some((i) => i.id === id))
                  void move(id, slot);
              }}
              onClick={() => {
                if (item) setChosen(item.id);
                else if (chosen) void move(chosen, slot);
              }}
            >
              <small>{String(slot + 1).padStart(2, "0")}</small>
              {item ? (
                <>
                  <Package size={20} />
                  <span>{item.name}</span>
                  {"quantity" in item && <b>×{item.quantity}</b>}
                </>
              ) : (
                <span className="slot-plus">+</span>
              )}
            </button>
          );
        })}
      </div>
      {chosenItem && (
        <div className="slot-actions">
          <p>已选：{chosenItem.name}。点空格即可移动。</p>
          <button className="secondary" onClick={() => onSelect(chosenItem)}>
            查看物品
          </button>
          {chosenItem.attachment?.parentId === container.id && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run({
                  type: "item.release",
                  itemId: chosenItem.id,
                  locationId: container.locationId,
                })
              }
            >
              取出并寻找地面空位
            </button>
          )}
          {"quantity" in chosenItem && (
            <div className="slot-stepper">
              <button
                className="secondary"
                disabled={busy || chosenItem.quantity === 0}
                onClick={() =>
                  void run({
                    type: "stock.adjust",
                    stockId: chosenItem.id,
                    delta: -1,
                  })
                }
              >
                减少一{chosenItem.unit}
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run({
                    type: "stock.adjust",
                    stockId: chosenItem.id,
                    delta: 1,
                  })
                }
              >
                增加一{chosenItem.unit}
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <details className="storage-settings">
        <summary>调整格位数量</summary>
        <div className="two-fields">
          <label className="field">
            列
            <input
              type="number"
              min="1"
              max="8"
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
            />
          </label>
          <label className="field">
            行
            <input
              type="number"
              min="1"
              max="8"
              value={rows}
              onChange={(e) => setRows(Number(e.target.value))}
            />
          </label>
        </div>
        <button
          className="secondary"
          disabled={
            busy ||
            !Number.isInteger(columns) ||
            !Number.isInteger(rows) ||
            columns < 1 ||
            columns > 8 ||
            rows < 1 ||
            rows > 8
          }
          onClick={() =>
            void run({
              type: "storage.configure",
              storage: { entityId: container.id, columns, rows },
            })
          }
        >
          保存格位
        </button>
      </details>
    </section>
  );
}

export function PlacementPanel({
  state,
  item,
  mutate,
}: {
  state: Dashboard;
  item: SpatialItem;
  mutate: Mutate;
}) {
  const { home } = state;
  const supports = home.entities.filter(
    (e) =>
      e.id !== item.id &&
      e.scope === "home" &&
      e.lifecycle === "active" &&
      isSurface(home, e) &&
      home.rooms.find((r) => r.id === e.locationId)?.kind === "room" &&
      e.attachment?.kind !== "storage",
  );
  const [supportId, setSupport] = useState(
    item.attachment?.kind === "surface"
      ? item.attachment.parentId
      : (supports[0]?.id ?? ""),
  );
  const [preferred, setPreferred] = useState<Point2>([0, 0]),
    [quarterTurn, setTurn] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const support = supports.find((s) => s.id === supportId),
    sa = support && assetFor(home, support);
  let plan: ReturnType<typeof planSurface> | undefined,
    reason = "";
  try {
    if (support)
      plan = planSurface(home, item.id, support.id, preferred, quarterTurn);
  } catch (e) {
    reason = (e as Error).message;
  }
  const obstacleItems = support
    ? items(home).filter(
        (i) =>
          i.id !== item.id &&
          i.id !== support.id &&
          i.locationId === support.locationId &&
          i.attachment?.kind !== "storage" &&
          i.position[1] + footprint(home, i)[2] >
            support.position[1] + sa!.height + 0.002 &&
          i.position[1] <
            support.position[1] + sa!.height + footprint(home, item)[2],
      )
    : [];
  return (
    <section className="placement-assist" aria-label="自动避障摆放">
      {"category" in item && (
        <MountPanel home={home} item={item} mutate={mutate} />
      )}
      <h3>
        <Move size={17} /> 放到台面上
      </h3>
      <p className="muted">
        选台面，再点大致位置。会避开已记录物品，保存后随台面移动。
      </p>
      <label className="field">
        目标台面
        <select
          value={supportId}
          onChange={(e) => {
            setSupport(e.target.value);
            setPreferred([0, 0]);
            setError("");
          }}
        >
          <option value="">选择台面</option>
          {supports.map((s) => (
            <option value={s.id} key={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {support && sa && (
        <>
          <svg
            className="surface-map"
            viewBox={`${-sa.width / 2} ${-sa.depth / 2} ${sa.width} ${sa.depth}`}
            role="img"
            aria-label="台面摆放预览"
            onClick={(e) => {
              const matrix = e.currentTarget.getScreenCTM();
              if (matrix) {
                const point = new DOMPoint(
                  e.clientX,
                  e.clientY,
                ).matrixTransform(matrix.inverse());
                setPreferred([point.x, point.y]);
              }
            }}
            preserveAspectRatio="xMidYMid meet"
          >
            {sa.kind === "round-storage-table" ? (
              <ellipse
                cx={0}
                cy={0}
                rx={sa.width / 2}
                ry={sa.depth / 2}
                fill="#e6e2d7"
              />
            ) : (
              <rect
                x={-sa.width / 2}
                y={-sa.depth / 2}
                width={sa.width}
                height={sa.depth}
                fill="#e6e2d7"
              />
            )}
            {obstacleItems.map((o) => {
              const p = rotate(
                  [
                    o.position[0] - support.position[0],
                    o.position[2] - support.position[2],
                  ],
                  -support.rotation,
                ),
                [w, d] = footprint(home, o);
              return (
                <g
                  key={o.id}
                  transform={`translate(${p[0]} ${p[1]}) rotate(${(-((o.rotation ?? 0) - support.rotation) * 180) / Math.PI})`}
                >
                  <rect
                    x={-w / 2}
                    y={-d / 2}
                    width={w}
                    height={d}
                    fill="#9b9d92"
                    stroke="#f7f6f1"
                    strokeWidth=".007"
                  >
                    <title>{o.name}</title>
                  </rect>
                </g>
              );
            })}
            {plan && (
              <rect
                x={plan.local[0] - plan.width / 2}
                y={plan.local[1] - plan.depth / 2}
                width={plan.width}
                height={plan.depth}
                fill="#4a856b"
                stroke="#244c3c"
                strokeWidth=".01"
              >
                <title>{item.name}</title>
              </rect>
            )}
          </svg>
          <div className="placement-legend">
            <span>
              <i />
              现有物品
            </span>
            <span>
              <i />
              新位置预览
            </span>
          </div>
          <button className="secondary" onClick={() => setTurn((v) => !v)}>
            <RotateCw size={15} />
            旋转 90°{quarterTurn ? " · 已旋转" : ""}
          </button>
          {reason && (
            <p className="notice" role="status">
              {reason}
            </p>
          )}
          <button
            className="primary full"
            disabled={!plan || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await mutate({
                  type: "surface.place",
                  itemId: item.id,
                  supportId,
                  preferred,
                  quarterTurn,
                });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认摆放
          </button>
        </>
      )}
      {!supports.length && (
        <p className="empty">
          当前没有已定位的桌面或柜面，可在布局编辑中添加。
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function MountPanel({
  home,
  item,
  mutate,
}: {
  home: Dashboard["home"];
  item: Entity;
  mutate: Mutate;
}) {
  const descendants = inspectionItems(home, item.id);
  const parents = home.entities.filter(
    (e) =>
      !descendants.has(e.id) &&
      e.locationId === item.locationId &&
      e.lifecycle === "active" &&
      e.attachment?.kind !== "storage" &&
      (isSurface(home, e) ||
        isStorage(home, e) ||
        ["monitor-arm", "dual-monitor-arm"].includes(assetFor(home, e).kind)),
  );
  const [parentId, setParent] = useState(item.attachment?.parentId ?? "");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <details className="storage-settings">
      <summary>
        固定在支架或家具上{item.attachment?.kind === "mount" ? " · 已连接" : ""}
      </summary>
      <p className="muted">
        保留现在的位置和高度，随支架或家具一起移动。请先在布局中调整好安装位置。
      </p>
      <label className="field">
        安装到
        <select value={parentId} onChange={(e) => setParent(e.target.value)}>
          <option value="">选择支架或家具</option>
          {parents.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className="secondary"
        disabled={!parentId || busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await mutate({ type: "object.mount", entityId: item.id, parentId });
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        保持当前位置并连接
      </button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
