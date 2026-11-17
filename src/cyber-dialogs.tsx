import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type {
  ArchLayer,
  BoundaryRole,
  CyberEdgeVisibility,
  CyberGraph,
  CyberNodeSize,
  CyberZoneDef,
  IsolationKind,
} from "../shared/cyber.js";
import {
  ARCH_LAYER_META,
  BOUNDARY_ROLE_META,
  CYBER_NODE_SIZE_META,
  isCyberEdgeQuiet,
  type NodeClassification,
  type ServiceCategoryMeta,
  type TopologyMeta,
} from "../shared/cyber-arch.js";
import type { Dashboard } from "../shared/domain.js";
import { WorldDialog, type WorldMutate } from "./possession.js";
import { ServiceBadgeIcon } from "./service-icon.js";

const SOURCE_LABELS: Record<string, string> = {
  node: "节点显式配置",
  service: "服务记录继承",
  kind: "节点类型推断",
  rule: "规则自动匹配",
  fallback: "默认兜底",
  "host-zone": "按宿主机归属",
  "group-zone": "按拓扑分组归属",
  default: "默认隔离域",
};

function parseCsvTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，\n]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export interface CyberNodeDialogProps {
  node: CyberGraph["nodes"][number];
  graph: CyberGraph;
  state: Dashboard;
  classification?: NodeClassification;
  classifications?: Map<string, NodeClassification>;
  categories: ServiceCategoryMeta[];
  topologies: TopologyMeta[];
  onClose: () => void;
  onOpenService: (serviceId: string) => void;
  onBindIcon: (node: CyberGraph["nodes"][number]) => void;
  mutate: WorldMutate;
}

export function CyberNodeDialog({
  node,
  graph,
  state,
  classification,
  classifications,
  categories,
  topologies,
  onClose,
  onOpenService,
  onBindIcon,
  mutate,
}: CyberNodeDialogProps) {
  const svc = node.serviceId
    ? state.home.services.find((s) => s.id === node.serviceId)
    : undefined;
  const [label, setLabel] = useState(node.label);
  const [size, setSize] = useState<"" | CyberNodeSize>(node.size ?? "");
  const [layer, setLayer] = useState<"" | ArchLayer>(node.layer ?? "");
  const [boundary, setBoundary] = useState<"" | BoundaryRole>(
    node.boundary ?? "",
  );
  const [category, setCategory] = useState<string>(node.category ?? "");
  const [zone, setZone] = useState<string>(node.zone ?? "");
  const [groupsText, setGroupsText] = useState(node.groups.join(", "));
  const [peerId, setPeerId] = useState<string>(
    graph.nodes.find((n) => n.id !== node.id)?.id ?? "",
  );
  const [edgeDir, setEdgeDir] = useState<"outbound" | "inbound">("outbound");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [edgeVisibility, setEdgeVisibility] = useState<
    "" | CyberEdgeVisibility
  >("");
  const [edgeGroups, setEdgeGroups] = useState(
    node.groups[0] ? node.groups[0] : "",
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const lastNodeIdRef = useRef(node.id);

  useEffect(() => {
    setLabel(node.label);
    setSize(node.size ?? "");
    setLayer(node.layer ?? "");
    setBoundary(node.boundary ?? "");
    setCategory(node.category ?? "");
    setZone(node.zone ?? "");
    setGroupsText(node.groups.join(", "));
    if (lastNodeIdRef.current !== node.id) {
      lastNodeIdRef.current = node.id;
      setMsg("");
      setErr("");
    }
  }, [node]);

  const relatedEdges = graph.edges.filter(
    (e) => e.source === node.id || e.target === node.id,
  );
  const sameHostEdges = relatedEdges.filter((e) => {
    const sn = graph.nodes.find((n) => n.id === e.source);
    const tn = graph.nodes.find((n) => n.id === e.target);
    return (sn?.host ?? "__external") === (tn?.host ?? "__external");
  });
  const crossHostEdges = relatedEdges.filter((e) => {
    const sn = graph.nodes.find((n) => n.id === e.source);
    const tn = graph.nodes.find((n) => n.id === e.target);
    return (sn?.host ?? "__external") !== (tn?.host ?? "__external");
  });

  const handleSaveNode = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const nextNode: CyberGraph["nodes"][number] = {
        id: node.id,
        label: label.trim() || node.label,
        ...(node.host ? { host: node.host } : {}),
        ...(node.serviceId ? { serviceId: node.serviceId } : {}),
        ...(node.icon ? { icon: node.icon } : {}),
        kind: node.kind,
        ...(size ? { size } : {}),
        ...(layer ? { layer } : {}),
        ...(boundary && (layer === "boundary" || !layer) ? { boundary } : {}),
        ...(category ? { category } : {}),
        ...(zone ? { zone } : {}),
        groups: parseCsvTags(groupsText),
      };
      await mutate({ type: "cyber.node.upsert", node: nextNode });
      setMsg("已保存节点分层与拓扑属性。");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleAddEdge = async () => {
    if (!peerId) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const source = edgeDir === "outbound" ? node.id : peerId;
      const target = edgeDir === "outbound" ? peerId : node.id;
      const id = `e-${source}-${target}-${Date.now().toString(36)}`
        .replace(/[^a-zA-Z0-9_.:-]/g, "-")
        .slice(0, 90);
      await mutate({
        type: "cyber.edge.upsert",
        edge: {
          id,
          source,
          target,
          ...(edgeLabel.trim() ? { label: edgeLabel.trim() } : {}),
          ...(edgeVisibility ? { visibility: edgeVisibility } : {}),
          groups: parseCsvTags(edgeGroups),
        },
      });
      setEdgeLabel("");
      setEdgeVisibility("");
      setMsg("已添加连线。");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCycleEdgeVisibility = async (
    edge: CyberGraph["edges"][number],
  ) => {
    const nextVis: CyberEdgeVisibility | undefined =
      edge.visibility === undefined
        ? "hover"
        : edge.visibility === "hover"
          ? "always"
          : undefined;
    setBusy(true);
    setErr("");
    try {
      await mutate({
        type: "cyber.edge.upsert",
        edge: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          ...(edge.label ? { label: edge.label } : {}),
          ...(nextVis ? { visibility: nextVis } : {}),
          groups: edge.groups,
        },
      });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteEdge = async (edgeId: string) => {
    setBusy(true);
    setErr("");
    try {
      await mutate({ type: "cyber.edge.delete", id: edgeId });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleGroupTag = (tag: string) => {
    const current = new Set(parseCsvTags(groupsText));
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);
    setGroupsText([...current].join(", "));
  };

  const renderEdgeList = (list: typeof relatedEdges) => (
    <ul className="cyber-chosen-edge-list">
      {list.map((e) => {
        const quiet = classifications
          ? isCyberEdgeQuiet(e, classifications)
          : e.visibility === "hover";
        const visLabel =
          e.visibility === "hover"
            ? "仅悬停"
            : e.visibility === "always"
              ? "常驻"
              : quiet
                ? "自动·悬停"
                : "自动·显线";
        return (
          <li key={e.id}>
            <span>
              {graph.nodes.find((n) => n.id === e.source)?.label ?? e.source} →{" "}
              {graph.nodes.find((n) => n.id === e.target)?.label ?? e.target}
              {e.label ? ` · ${e.label}` : ""}
            </span>
            <div className="cyber-edge-row-actions">
              <button
                type="button"
                className={`cyber-inline-vis ${quiet ? "is-quiet" : ""}`}
                title="点击切换连线显隐方式（自动 / 仅悬停 / 常驻）"
                disabled={busy}
                onClick={() => void handleCycleEdgeVisibility(e)}
              >
                {visLabel}
              </button>
              <button
                type="button"
                className="cyber-inline-del"
                title="删除连线"
                disabled={busy}
                onClick={() => void handleDeleteEdge(e.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );

  const declaredZones = graph.zones ?? [];

  return (
    <WorldDialog title={node.label} onClose={onClose} busy={busy}>
      <div className="cyber-chosen-head">
        <ServiceBadgeIcon
          icon={node.icon ?? svc?.icon}
          serviceId={svc?.id ?? node.serviceId}
          label={node.label}
          kind={node.kind}
          size={30}
        />
        <div>
          <p>
            所属主机：
            {state.home.entities.find((h) => h.id === node.host)?.name ??
              "外部服务"}
          </p>
          {classification && (
            <p>
              当前生效：{CYBER_NODE_SIZE_META[classification.size].shortLabel}
              图标 · {classification.layerMeta.label}
              {classification.boundaryMeta
                ? `（${classification.boundaryMeta.badge}）`
                : ""}
              {" · "}
              {classification.categoryMeta.label}
              <small className="cyber-source-hint">
                {" "}
                [{SOURCE_LABELS[classification.layerSource] ?? "规则"}]
              </small>
            </p>
          )}
          <div className="cyber-chosen-actions-inline">
            <button
              type="button"
              className="cyber-topo-reset-btn"
              onClick={() => onBindIcon(node)}
            >
              更换图标
            </button>
            {node.serviceId && (
              <button
                type="button"
                className="primary"
                onClick={() => onOpenService(node.serviceId!)}
              >
                打开服务
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="cyber-node-editor-grid">
        <label className="field">
          名称
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          图标尺寸
          <select
            aria-label="图标尺寸"
            value={size}
            onChange={(e) => setSize(e.target.value as "" | CyberNodeSize)}
          >
            <option value="">
              自动（
              {classification
                ? CYBER_NODE_SIZE_META[classification.size].shortLabel
                : "推断"}
              ）
            </option>
            {(Object.keys(CYBER_NODE_SIZE_META) as CyberNodeSize[]).map((k) => (
              <option key={k} value={k}>
                {CYBER_NODE_SIZE_META[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          架构层级
          <select
            aria-label="节点层级"
            value={layer}
            onChange={(e) => setLayer(e.target.value as "" | ArchLayer)}
          >
            <option value="">
              自动（{classification?.layerMeta.label ?? "推断"}）
            </option>
            {(Object.keys(ARCH_LAYER_META) as ArchLayer[]).map((k) => (
              <option key={k} value={k}>
                {ARCH_LAYER_META[k].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          边界角色
          <select
            aria-label="边界角色"
            value={boundary}
            disabled={Boolean(layer && layer !== "boundary")}
            onChange={(e) => setBoundary(e.target.value as "" | BoundaryRole)}
          >
            <option value="">
              自动（{classification?.boundaryMeta?.label ?? "非边界/推断"}）
            </option>
            {(Object.keys(BOUNDARY_ROLE_META) as BoundaryRole[]).map((k) => (
              <option key={k} value={k}>
                {BOUNDARY_ROLE_META[k].label} ({BOUNDARY_ROLE_META[k].badge})
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          职能分类
          <select
            aria-label="节点职能分类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">
              自动（{classification?.categoryMeta.label ?? "推断"}）
            </option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          所属隔离域
          <select
            aria-label="所属隔离域"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            <option value="">自动归域</option>
            {declaredZones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}（{z.isolation === "strict" ? "严格实线" : "虚拟虚线"}
                ）
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          所属逻辑拓扑（逗号分隔）
          <input
            value={groupsText}
            onChange={(e) => setGroupsText(e.target.value)}
            placeholder="例如：入网, AI工作区"
          />
        </label>
      </div>

      {topologies.length > 0 && (
        <div className="cyber-tag-picker">
          {topologies.map((t) => {
            const active = parseCsvTags(groupsText).includes(t.id);
            return (
              <button
                key={t.id}
                type="button"
                className={`cyber-tag-chip ${active ? "is-active" : ""}`}
                onClick={() => toggleGroupTag(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void handleSaveNode()}
      >
        保存节点属性
      </button>

      {sameHostEdges.length > 0 && (
        <div className="cyber-chosen-group">
          <small className="cyber-chosen-label">
            机内引用（{sameHostEdges.length}）
          </small>
          {renderEdgeList(sameHostEdges)}
        </div>
      )}
      {crossHostEdges.length > 0 && (
        <div className="cyber-chosen-group">
          <small className="cyber-chosen-label">
            跨机连接（{crossHostEdges.length}）
          </small>
          {renderEdgeList(crossHostEdges)}
        </div>
      )}

      {graph.nodes.length > 1 && (
        <div className="cyber-edge-quick-add">
          <small className="cyber-chosen-label">新增引用连线</small>
          <div className="cyber-edge-add-row">
            <select
              value={edgeDir}
              onChange={(e) =>
                setEdgeDir(e.target.value as "outbound" | "inbound")
              }
            >
              <option value="outbound">此节点 →</option>
              <option value="inbound">→ 此节点</option>
            </select>
            <select value={peerId} onChange={(e) => setPeerId(e.target.value)}>
              {graph.nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label} ({n.host ?? "外部"})
                  </option>
                ))}
            </select>
            <input
              value={edgeLabel}
              onChange={(e) => setEdgeLabel(e.target.value)}
              placeholder="关系标签（如 PG / HTTPS）"
            />
            <select
              aria-label="连线展示"
              value={edgeVisibility}
              onChange={(e) =>
                setEdgeVisibility(e.target.value as "" | CyberEdgeVisibility)
              }
            >
              <option value="">自动（随图标尺寸）</option>
              <option value="hover">仅悬停显线</option>
              <option value="always">始终显线</option>
            </select>
            <input
              value={edgeGroups}
              onChange={(e) => setEdgeGroups(e.target.value)}
              placeholder="拓扑分组（可选）"
            />
            <button
              type="button"
              className="cyber-topo-reset-btn"
              disabled={busy}
              onClick={() => void handleAddEdge()}
            >
              <Plus size={12} /> 添加
            </button>
          </div>
        </div>
      )}

      {msg && <p className="notice">{msg}</p>}
      {err && (
        <p className="notice" role="alert">
          {err}
        </p>
      )}
    </WorldDialog>
  );
}

export interface CyberTaxonomyDialogProps {
  graph: CyberGraph;
  state: Dashboard;
  categories: ServiceCategoryMeta[];
  topologies: TopologyMeta[];
  mutate: WorldMutate;
  onClose: () => void;
}

export function CyberTaxonomyDialog({
  graph,
  state,
  topologies,
  mutate,
  onClose,
}: CyberTaxonomyDialogProps) {
  const [tab, setTab] = useState<"zones" | "categories" | "topologies">(
    "zones",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  const [zoneId, setZoneId] = useState("");
  const [zoneLabel, setZoneLabel] = useState("");
  const [zoneIso, setZoneIso] = useState<IsolationKind>("strict");
  const [zoneHosts, setZoneHosts] = useState("");
  const [zoneGroups, setZoneGroups] = useState("");
  const [zoneDesc, setZoneDesc] = useState("");

  const [catId, setCatId] = useState("");
  const [catLabel, setCatLabel] = useState("");
  const [catShort, setCatShort] = useState("");
  const [catColor, setCatColor] = useState("#38bdf8");
  const [catLayer, setCatLayer] = useState<"" | ArchLayer>("infra");

  const [topoId, setTopoId] = useState(topologies[0]?.id ?? "");
  const [topoLabel, setTopoLabel] = useState(topologies[0]?.label ?? "");
  const [topoDesc, setTopoDesc] = useState(topologies[0]?.description ?? "");

  const saveZone = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const id = zoneId.trim();
      const label = zoneLabel.trim();
      if (!id || !label) throw new Error("隔离域 ID 和显示名称不能为空。");
      const hosts = parseCsvTags(zoneHosts);
      const groups = parseCsvTags(zoneGroups);
      const next: CyberZoneDef = {
        id,
        label,
        isolation: zoneIso,
        ...(hosts.length ? { hosts } : {}),
        ...(groups.length ? { groups } : {}),
        ...(zoneDesc.trim() ? { description: zoneDesc.trim() } : {}),
      };
      await mutate({ type: "cyber.zone.upsert", zone: next });
      setZoneId("");
      setZoneLabel("");
      setZoneHosts("");
      setZoneGroups("");
      setZoneDesc("");
      setMsg(`已保存隔离域「${label}」。`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteZone = async (id: string) => {
    setBusy(true);
    setErr("");
    try {
      await mutate({ type: "cyber.zone.delete", id });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveCategory = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const id = catId.trim();
      const label = catLabel.trim();
      if (!id || !label) throw new Error("分类 ID 和显示名称不能为空。");
      await mutate({
        type: "cyber.taxonomy.upsert",
        categories: {
          [id]: {
            label,
            ...(catShort.trim() ? { shortLabel: catShort.trim() } : {}),
            ...(catColor ? { color: catColor } : {}),
            ...(catLayer ? { defaultLayer: catLayer } : {}),
          },
        },
      });
      setCatId("");
      setCatLabel("");
      setCatShort("");
      setMsg(`已注册分类「${label}」。`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const deleteCategory = async (id: string) => {
    setBusy(true);
    setErr("");
    try {
      await mutate({ type: "cyber.taxonomy.upsert", deleteCategories: [id] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveTopology = async () => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const id = topoId.trim();
      const label = topoLabel.trim();
      if (!id || !label) throw new Error("拓扑 ID 和显示名称不能为空。");
      await mutate({
        type: "cyber.taxonomy.upsert",
        topologies: {
          [id]: {
            label,
            ...(topoDesc.trim() ? { description: topoDesc.trim() } : {}),
          },
        },
      });
      setMsg(`已保存逻辑拓扑「${label}」。`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorldDialog title="隔离域、分类与拓扑配置" onClose={onClose} busy={busy}>
      <div className="cyber-view-toggle cyber-tax-tabs">
        <button
          type="button"
          className={tab === "zones" ? "active" : ""}
          onClick={() => setTab("zones")}
        >
          隔离域 ({graph.zones?.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === "categories" ? "active" : ""}
          onClick={() => setTab("categories")}
        >
          自定义分类 ({Object.keys(graph.categories ?? {}).length})
        </button>
        <button
          type="button"
          className={tab === "topologies" ? "active" : ""}
          onClick={() => setTab("topologies")}
        >
          逻辑拓扑 ({topologies.length})
        </button>
      </div>

      {tab === "zones" && (
        <div className="cyber-tax-panel">
          <div className="cyber-tax-list">
            {(graph.zones ?? []).length === 0 ? (
              <p className="muted">
                尚未定义自定义隔离域，当前使用默认本地/Mesh/远端自动域。
              </p>
            ) : (
              (graph.zones ?? []).map((z) => (
                <div key={z.id} className="cyber-tax-item">
                  <div>
                    <strong>{z.label}</strong> <code>{z.id}</code>{" "}
                    <span className={`cyber-iso-pill is-${z.isolation}`}>
                      {z.isolation === "strict" ? "实线严格" : "虚线虚拟"}
                    </span>
                    {z.hosts?.length ? (
                      <small> · 主机: {z.hosts.join(", ")}</small>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="cyber-inline-del"
                    onClick={() => void deleteZone(z.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="cyber-node-editor-grid">
            <label className="field">
              域 ID
              <input
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                placeholder="例如：dmz-edge"
              />
            </label>
            <label className="field">
              显示名称
              <input
                value={zoneLabel}
                onChange={(e) => setZoneLabel(e.target.value)}
                placeholder="例如：家庭 DMZ 隔离域"
              />
            </label>
            <label className="field">
              隔离方式
              <select
                value={zoneIso}
                onChange={(e) => setZoneIso(e.target.value as IsolationKind)}
              >
                <option value="strict">严格隔离（实线）</option>
                <option value="virtual">逻辑/虚拟隔离（虚线）</option>
              </select>
            </label>
            <label className="field">
              匹配主机 ID（可选，逗号分隔）
              <input
                value={zoneHosts}
                onChange={(e) => setZoneHosts(e.target.value)}
                placeholder={state.home.entities
                  .filter((e) => e.category === "host")
                  .map((e) => e.id)
                  .slice(0, 3)
                  .join(", ")}
              />
            </label>
            <label className="field">
              匹配拓扑组（可选）
              <input
                value={zoneGroups}
                onChange={(e) => setZoneGroups(e.target.value)}
                placeholder="例如：DMZ, 出网"
              />
            </label>
            <label className="field">
              说明（可选）
              <input
                value={zoneDesc}
                onChange={(e) => setZoneDesc(e.target.value)}
                placeholder="隔离边界描述"
              />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void saveZone()}
          >
            添加或更新隔离域
          </button>
        </div>
      )}

      {tab === "categories" && (
        <div className="cyber-tax-panel">
          <div className="cyber-tax-list">
            {Object.entries(graph.categories ?? {}).length === 0 ? (
              <p className="muted">当前仅使用 8 类内置职能分类。</p>
            ) : (
              Object.entries(graph.categories ?? {}).map(([id, def]) => (
                <div key={id} className="cyber-tax-item">
                  <div>
                    <i
                      className="cyber-color-dot"
                      style={{ background: def.color ?? "#38bdf8" }}
                    />{" "}
                    <strong>{def.label}</strong> <code>{id}</code>
                    {def.defaultLayer ? (
                      <small>
                        {" "}
                        · 默认 {ARCH_LAYER_META[def.defaultLayer].label}
                      </small>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="cyber-inline-del"
                    onClick={() => void deleteCategory(id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
          <div className="cyber-node-editor-grid">
            <label className="field">
              分类 Key
              <input
                value={catId}
                onChange={(e) => setCatId(e.target.value)}
                placeholder="例如：ai-inference"
              />
            </label>
            <label className="field">
              分类名称
              <input
                value={catLabel}
                onChange={(e) => setCatLabel(e.target.value)}
                placeholder="例如：AI 推理"
              />
            </label>
            <label className="field">
              短标签
              <input
                value={catShort}
                onChange={(e) => setCatShort(e.target.value)}
                placeholder="例如：AI"
              />
            </label>
            <label className="field">
              主题色
              <input
                type="color"
                value={catColor}
                onChange={(e) => setCatColor(e.target.value)}
              />
            </label>
            <label className="field">
              默认层级
              <select
                value={catLayer}
                onChange={(e) => setCatLayer(e.target.value as "" | ArchLayer)}
              >
                <option value="">不限定（自动）</option>
                {(Object.keys(ARCH_LAYER_META) as ArchLayer[]).map((k) => (
                  <option key={k} value={k}>
                    {ARCH_LAYER_META[k].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void saveCategory()}
          >
            注册或更新分类
          </button>
        </div>
      )}

      {tab === "topologies" && (
        <div className="cyber-tax-panel">
          <div className="cyber-tax-list">
            {topologies.map((t) => (
              <button
                key={t.id}
                type="button"
                className="cyber-tax-item is-clickable"
                onClick={() => {
                  setTopoId(t.id);
                  setTopoLabel(t.label);
                  setTopoDesc(t.description ?? "");
                }}
              >
                <div>
                  <strong>{t.label}</strong> <code>{t.id}</code>
                  <small>
                    {" "}
                    · {t.nodeCount} 节点 / {t.edgeCount} 连线
                  </small>
                </div>
              </button>
            ))}
          </div>
          <div className="cyber-node-editor-grid">
            <label className="field">
              拓扑分组 ID
              <input
                value={topoId}
                onChange={(e) => setTopoId(e.target.value)}
                placeholder="例如：入网"
              />
            </label>
            <label className="field">
              显示标题
              <input
                value={topoLabel}
                onChange={(e) => setTopoLabel(e.target.value)}
                placeholder="例如：公网反向代理链路"
              />
            </label>
            <label className="field">
              说明
              <input
                value={topoDesc}
                onChange={(e) => setTopoDesc(e.target.value)}
                placeholder="链路意图描述"
              />
            </label>
          </div>
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void saveTopology()}
          >
            保存拓扑元数据
          </button>
        </div>
      )}

      {msg && <p className="notice">{msg}</p>}
      {err && (
        <p className="notice" role="alert">
          {err}
        </p>
      )}
    </WorldDialog>
  );
}
