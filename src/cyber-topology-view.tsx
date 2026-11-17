import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Cpu,
  Globe,
  Layers,
  Network,
  Plus,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import {
  ARCH_LAYER_META,
  buildTopologyViewModel,
  type TopologyNodeItem,
  type TopologyZoneModel,
} from "../shared/cyber-arch.js";
import type { CyberGraph } from "../shared/cyber.js";
import type { Entity, Service } from "../shared/domain.js";
import { ServiceBadgeIcon } from "./service-icon.js";

export interface CyberTopologyViewProps {
  fullGraph: CyberGraph;
  activeGraph: CyberGraph;
  entities: Entity[];
  services: Service[];
  focusLabel: string;
  activeGroup?: string;
  topOffset: number;
  power?: boolean;
  onSelectNode: (node: CyberGraph["nodes"][number]) => void;
  onInspectHost: (hostId: string) => void;
  onAddToTopology?: (node: CyberGraph["nodes"][number]) => void;
  onConfigureTaxonomy?: () => void;
  onResetFilter: () => void;
}

interface NodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
}

interface TopoSvgEdge {
  edge: CyberGraph["edges"][number];
  path: string;
  labelX: number;
  labelY: number;
}

function computeTopoCurve(
  s: NodeBox,
  t: NodeBox,
  index: number,
): Omit<TopoSvgEdge, "edge"> {
  const dx = t.cx - s.cx;
  const dy = t.cy - s.cy;
  const spread = ((index % 5) - 2) * 7;

  let sx = s.cx;
  let sy = s.cy;
  let tx = t.cx;
  let ty = t.cy;

  if (Math.abs(dx) >= Math.abs(dy) * 0.85) {
    sx = dx >= 0 ? s.right : s.x;
    sy = s.cy + spread * 0.35;
    tx = dx >= 0 ? t.x : t.right;
    ty = t.cy - spread * 0.35;
    const pull = Math.min(90, Math.max(28, Math.abs(tx - sx) * 0.42));
    const c1x = sx + (dx >= 0 ? pull : -pull);
    const c2x = tx + (dx >= 0 ? -pull : pull);
    return {
      path: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${sy.toFixed(1)}, ${c2x.toFixed(1)} ${ty.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
      labelX: (sx + 3 * c1x + 3 * c2x + tx) / 8,
      labelY: (sy + ty) / 2,
    };
  }

  sy = dy >= 0 ? s.bottom : s.y;
  sx = s.cx + spread * 0.5;
  ty = dy >= 0 ? t.y : t.bottom;
  tx = t.cx - spread * 0.5;
  const pull = Math.min(72, Math.max(24, Math.abs(ty - sy) * 0.44));
  const c1y = sy + (dy >= 0 ? pull : -pull);
  const c2y = ty + (dy >= 0 ? -pull : pull);
  return {
    path: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${sx.toFixed(1)} ${c1y.toFixed(1)}, ${tx.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
    labelX: (sx + tx) / 2,
    labelY: (sy + 3 * c1y + 3 * c2y + ty) / 8,
  };
}

export function CyberTopologyView({
  fullGraph,
  activeGraph,
  entities,
  services,
  focusLabel,
  activeGroup,
  topOffset,
  power,
  onSelectNode,
  onInspectHost,
  onAddToTopology,
  onConfigureTaxonomy,
  onResetFilter,
}: CyberTopologyViewProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
  const [excludedOpen, setExcludedOpen] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [svgEdges, setSvgEdges] = useState<TopoSvgEdge[]>([]);
  const [nodeBoxes, setNodeBoxes] = useState<Map<string, NodeBox>>(
    () => new Map(),
  );

  const model = useMemo(
    () =>
      buildTopologyViewModel({
        fullGraph,
        activeGraph,
        entities,
        services,
      }),
    [fullGraph, activeGraph, entities, services],
  );

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  const nodeById = useMemo(
    () => new Map(activeGraph.nodes.map((n) => [n.id, n])),
    [activeGraph.nodes],
  );
  const itemById = useMemo(
    () => new Map(model.inTopologyNodes.map((i) => [i.node.id, i])),
    [model.inTopologyNodes],
  );
  const layoutSignature = useMemo(
    () =>
      model.inTopologyNodes
        .map(
          (i) =>
            `${i.node.id}:${i.classification.size}:${i.classification.layer}:${i.classification.zoneId ?? ""}`,
        )
        .join("|"),
    [model.inTopologyNodes],
  );

  const connectedToHover = useMemo(() => {
    const active = new Set<string>();
    if (hoveredNodeId) {
      active.add(hoveredNodeId);
      for (const e of model.activeEdges) {
        if (e.source === hoveredNodeId) active.add(e.target);
        if (e.target === hoveredNodeId) active.add(e.source);
      }
    } else if (hoveredEdgeId) {
      const e = model.activeEdges.find((x) => x.id === hoveredEdgeId);
      if (e) {
        active.add(e.source);
        active.add(e.target);
      }
    }
    return active;
  }, [hoveredNodeId, hoveredEdgeId, model.activeEdges]);

  const measureEdges = useCallback(() => {
    const el = canvasRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    if (cRect.width <= 0 || cRect.height <= 0) return;
    const boxes = new Map<string, NodeBox>();
    for (const [id, nodeEl] of nodeRefs.current.entries()) {
      const r = nodeEl.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const x = r.left - cRect.left;
      const y = r.top - cRect.top;
      boxes.set(id, {
        x,
        y,
        w: r.width,
        h: r.height,
        cx: x + r.width / 2,
        cy: y + r.height / 2,
        right: x + r.width,
        bottom: y + r.height,
      });
    }
    const next: TopoSvgEdge[] = [];
    model.activeEdges.forEach((edge, idx) => {
      if (edge.source === edge.target) return;
      const s = boxes.get(edge.source);
      const t = boxes.get(edge.target);
      if (!s || !t) return;
      next.push({
        edge,
        ...computeTopoCurve(s, t, idx),
      });
    });
    setSvgSize({
      width: Math.ceil(cRect.width),
      height: Math.ceil(cRect.height),
    });
    setNodeBoxes(boxes);
    setSvgEdges(next);
  }, [model.activeEdges]);

  useLayoutEffect(() => {
    measureEdges();
  }, [measureEdges, layoutSignature, excludedOpen]);

  useEffect(() => {
    let raf = requestAnimationFrame(() => measureEdges());
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => measureEdges());
          })
        : undefined;
    if (ro && canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener("resize", measureEdges);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", measureEdges);
    };
  }, [measureEdges, layoutSignature, excludedOpen]);

  const isHighlighting = Boolean(hoveredNodeId || hoveredEdgeId);
  const quietEdgeCount = model.quietEdgeIds.size;
  const visibleEdgeCount = model.activeEdges.length - quietEdgeCount;
  const denseResting = !isHighlighting && visibleEdgeCount > 16;
  const hoveredRoute = hoveredEdgeId
    ? svgEdges.find((x) => x.edge.id === hoveredEdgeId)
    : undefined;
  const hoveredSmallOrMedium =
    hoveredNodeId && !hoveredEdgeId
      ? (() => {
          const item = itemById.get(hoveredNodeId);
          const box = nodeBoxes.get(hoveredNodeId);
          if (!item || !box || item.classification.size === "large") {
            return undefined;
          }
          return { item, box };
        })()
      : undefined;

  const renderNode = (item: TopologyNodeItem, compactPerimeter = false) => {
    const { node, classification: cls, hostId, hostLabel, hostScope } = item;
    const size = cls.size;
    const isLarge = size === "large";
    const isMedium = size === "medium";
    const isSmall = size === "small";
    const svc = node.serviceId ? serviceById.get(node.serviceId) : undefined;
    const isActive = hoveredNodeId === node.id || connectedToHover.has(node.id);
    const isDimmed = isHighlighting && !isActive;
    const hostDisplay = hostScope === "external" ? "外部" : hostLabel;

    return (
      <div
        key={node.id}
        data-topo-node={node.id}
        data-topo-layer={cls.layer}
        data-topo-size={size}
        ref={(el) => {
          if (el) nodeRefs.current.set(node.id, el);
          else nodeRefs.current.delete(node.id);
        }}
        style={
          isLarge ? { borderLeftColor: cls.categoryMeta.color } : undefined
        }
        title={`${node.label} · ${hostDisplay} · ${cls.categoryMeta.label}`}
        className={[
          "cyber-topo-card",
          `is-size-${size}`,
          compactPerimeter ? "is-perimeter" : "",
          `is-kind-${node.kind}`,
          isActive ? "is-active" : "",
          isDimmed ? "is-dimmed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseEnter={() => setHoveredNodeId(node.id)}
        onMouseLeave={() => setHoveredNodeId(undefined)}
      >
        <button
          type="button"
          className="cyber-topo-card-btn"
          aria-label={isSmall ? `${node.label} (${hostDisplay})` : undefined}
          onFocus={() => setHoveredNodeId(node.id)}
          onBlur={() => setHoveredNodeId(undefined)}
          onClick={() => onSelectNode(node)}
        >
          <ServiceBadgeIcon
            icon={node.icon ?? svc?.icon}
            serviceId={svc?.id ?? node.serviceId}
            label={node.label}
            kind={node.kind}
            size={
              isMedium
                ? compactPerimeter
                  ? 20
                  : 22
                : compactPerimeter
                  ? 16
                  : 18
            }
          />
          {!isSmall && (
            <span className="cyber-topo-card-text">
              <strong>{node.label}</strong>
              {isLarge && (
                <small>
                  {cls.boundaryMeta
                    ? cls.boundaryMeta.badge
                    : cls.categoryMeta.label}
                </small>
              )}
            </span>
          )}
        </button>
        {isLarge && (
          <div className="cyber-topo-card-foot">
            {hostScope !== "external" ? (
              <button
                type="button"
                className={`cyber-topo-vm-chip is-${hostScope}`}
                title={`虚拟宿主标签：${hostLabel}（点击打开机内架构）`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInspectHost(hostId);
                }}
              >
                {hostScope === "remote" ? <Cloud size={9} /> : <Cpu size={9} />}
                <span>{hostId}</span>
              </button>
            ) : (
              <span className="cyber-topo-vm-chip is-external">
                <Globe size={9} /> 外部
              </span>
            )}
            <span
              className="cyber-topo-cat-dot"
              style={{ color: cls.categoryMeta.color }}
            >
              {cls.categoryMeta.shortLabel}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderStratumNodes = (
    list: TopologyNodeItem[],
    compactZone: boolean,
  ) => {
    const larges = list.filter((i) => i.classification.size === "large");
    const mediums = list.filter((i) => i.classification.size === "medium");
    const smalls = list.filter((i) => i.classification.size === "small");
    return (
      <>
        {larges.length > 0 && (
          <div
            className={`cyber-topo-card-grid ${compactZone ? "is-compact" : ""}`}
          >
            {larges.map((i) => renderNode(i))}
          </div>
        )}
        {mediums.length > 0 && (
          <div
            className={`cyber-topo-medium-row ${larges.length > 0 ? "has-preceding" : ""}`}
          >
            {mediums.map((i) => renderNode(i))}
          </div>
        )}
        {smalls.length > 0 && (
          <div
            className={`cyber-topo-small-row ${larges.length + mediums.length > 0 ? "has-preceding" : ""}`}
          >
            {smalls.map((i) => renderNode(i))}
          </div>
        )}
      </>
    );
  };

  const primaryZones = useMemo(
    () =>
      model.zones.filter(
        (z) =>
          z.kind === "local" ||
          (z.kind === "custom" &&
            (z.strata.app.length +
              z.strata.infra.length +
              z.strata.middleware.length >
              0 ||
              z.nodeCount === 0)),
      ),
    [model.zones],
  );

  const secondaryZones = useMemo(() => {
    const primaryIds = new Set(primaryZones.map((z) => z.id));
    return model.zones.filter((z) => !primaryIds.has(z.id));
  }, [model.zones, primaryZones]);

  const isSplitColumns = primaryZones.length > 0 && secondaryZones.length > 0;

  const renderPerimeterDock = (
    zone: TopologyZoneModel,
    side: "top" | "bottom",
  ) => {
    const slots =
      side === "top"
        ? (
            [
              {
                key: "ingress",
                label: "入网边界 INGRESS",
                cls: "is-ingress",
                items: zone.perimeter.ingress,
              },
              {
                key: "dns",
                label: "解析边界 DNS",
                cls: "is-dns",
                items: zone.perimeter.dns,
              },
              {
                key: "mesh",
                label: "虚拟边界 MESH",
                cls: "is-mesh",
                items: zone.perimeter.mesh,
              },
            ] as const
          ).filter((s) => s.items.length > 0)
        : (
            [
              {
                key: "egress",
                label: "出网边界 EGRESS",
                cls: "is-egress",
                items: zone.perimeter.egress,
              },
            ] as const
          ).filter((s) => s.items.length > 0);
    if (slots.length === 0) return null;

    return (
      <div className={`cyber-topo-perimeter-dock is-${side}`}>
        {slots.map((slot) => (
          <div key={slot.key} className="cyber-topo-perimeter-slot">
            <span className={`cyber-topo-slot-label ${slot.cls}`}>
              {slot.label}
            </span>
            <div className="cyber-topo-card-row">
              {slot.items.map((item) => renderNode(item, true))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderZone = (zone: TopologyZoneModel) => {
    const hasTopDock =
      zone.perimeter.ingress.length +
        zone.perimeter.dns.length +
        zone.perimeter.mesh.length >
      0;
    const hasBottomDock = zone.perimeter.egress.length > 0;
    const hasStrata =
      zone.strata.app.length +
        zone.strata.infra.length +
        zone.strata.middleware.length >
      0;
    const ZoneIcon =
      zone.kind === "remote"
        ? Cloud
        : zone.kind === "external"
          ? Globe
          : zone.isolation === "virtual"
            ? Layers
            : Shield;

    return (
      <section
        key={zone.id}
        data-zone-id={zone.id}
        data-zone-kind={zone.kind}
        data-isolation={zone.isolation}
        className={[
          "cyber-topo-zone",
          `is-${zone.isolation}`,
          `is-kind-${zone.kind}`,
          hasTopDock ? "has-top-dock" : "",
          hasBottomDock ? "has-bottom-dock" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {renderPerimeterDock(zone, "top")}

        <header className="cyber-topo-zone-head">
          <ZoneIcon size={12} />
          <strong>{zone.label}</strong>
          {(zone.provider || zone.region) && (
            <span className="cyber-topo-zone-meta">
              {[zone.provider, zone.region].filter(Boolean).join(" · ")}
            </span>
          )}
          <span className={`cyber-iso-pill is-${zone.isolation}`}>
            {zone.isolation === "strict"
              ? "实线 · 严格隔离"
              : "虚线 · 虚拟隔离"}
          </span>
          {zone.description && <span>{zone.description}</span>}
          {zone.hostId && (
            <button
              type="button"
              className="cyber-topo-host-link"
              onClick={() => onInspectHost(zone.hostId!)}
            >
              分层图
            </button>
          )}
        </header>

        {hasStrata ? (
          <div className="cyber-topo-strata">
            {(
              [
                ["app", zone.strata.app],
                ["infra", zone.strata.infra],
                ["middleware", zone.strata.middleware],
              ] as const
            ).map(([layerId, list]) => {
              if (list.length === 0) return null;
              const meta = ARCH_LAYER_META[layerId];
              return (
                <section
                  key={layerId}
                  data-isolation={meta.isolation}
                  className={`cyber-topo-subzone is-${meta.isolation}`}
                >
                  <header className="cyber-topo-subzone-head">
                    <strong>{meta.label}</strong>
                    <span className={`cyber-iso-pill is-${meta.isolation}`}>
                      {meta.isolationLabel}
                    </span>
                    <em>{list.length}</em>
                  </header>
                  {renderStratumNodes(
                    list,
                    zone.kind !== "local" && zone.kind !== "custom",
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          zone.nodeCount === 0 && (
            <p className="muted cyber-topo-zone-empty">
              暂无节点归属此隔离域（点击任意节点可指定所属隔离域）。
            </p>
          )
        )}

        {renderPerimeterDock(zone, "bottom")}
      </section>
    );
  };

  return (
    <div
      className="cyber-topo-stage"
      data-perspective="topology"
      style={{ top: topOffset }}
    >
      <div className="cyber-topo-scroll">
        <div className="cyber-topo-header">
          <div className="cyber-topo-title">
            <Network size={15} />
            <strong>
              {power ? "供电拓扑视角" : "拓扑为实视角"} · {focusLabel}
            </strong>
            <span>
              在拓扑内 {model.inTopologyNodes.length} 组件 ·{" "}
              {quietEdgeCount > 0
                ? `${visibleEdgeCount} 条业务流（${quietEdgeCount} 从属悬停显线）`
                : `${model.activeEdges.length} 条流向`}{" "}
              · {model.zones.length} 隔离域
            </span>
            {model.outOfTopologyNodes.length > 0 && (
              <em className="cyber-topo-out-badge">
                拓扑外 {model.outOfTopologyNodes.length} 项
              </em>
            )}
          </div>
          <div className="cyber-topo-legend">
            <span className="is-strict-key">实线 = 严格隔离域</span>
            <span className="is-virtual-key">虚线 = 虚拟隔离域</span>
            <span className="is-vm-key">虚拟标签 = 所属宿主机</span>
            {onConfigureTaxonomy && (
              <button
                type="button"
                className="cyber-topo-reset-btn"
                onClick={onConfigureTaxonomy}
              >
                <SlidersHorizontal size={11} /> 域与分类配置
              </button>
            )}
          </div>
        </div>

        <div
          className={[
            "cyber-topo-canvas",
            !isSplitColumns ? "is-single-col" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          ref={canvasRef}
        >
          {svgSize.width > 0 && svgEdges.length > 0 && (
            <svg
              className="cyber-topo-svg"
              width={svgSize.width}
              height={svgSize.height}
              viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
              aria-hidden="true"
            >
              <defs>
                <marker
                  id="topo-arrow"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto"
                >
                  <path d="M 1 2 L 8 5 L 1 8 z" fill="#7dd3fc" />
                </marker>
                <marker
                  id="topo-arrow-active"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 1 2 L 8 5 L 1 8 z" fill="#f0fdff" />
                </marker>
              </defs>
              {svgEdges.map(({ edge, path }) => {
                const isQuiet = model.quietEdgeIds.has(edge.id);
                const active = hoveredNodeId
                  ? edge.source === hoveredNodeId ||
                    edge.target === hoveredNodeId
                  : hoveredEdgeId === edge.id;
                if (isQuiet && !active) return null;
                const dimmed = isHighlighting && !active;
                return (
                  <g key={edge.id}>
                    <path
                      d={path}
                      className="cyber-topo-edge-hit"
                      onMouseEnter={() => setHoveredEdgeId(edge.id)}
                      onMouseLeave={() => setHoveredEdgeId(undefined)}
                    />
                    <path
                      d={path}
                      className={[
                        "cyber-topo-edge",
                        isQuiet ? "is-quiet-revealed" : "",
                        denseResting && !active ? "is-resting-dense" : "",
                        active ? "is-active" : "",
                        dimmed ? "is-dimmed" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      markerEnd={
                        active ? "url(#topo-arrow-active)" : "url(#topo-arrow)"
                      }
                    />
                  </g>
                );
              })}
            </svg>
          )}

          {hoveredSmallOrMedium &&
            (() => {
              const { box, item } = hoveredSmallOrMedium;
              const alignLeft = box.cx < 96;
              const alignRight = !alignLeft && box.cx > svgSize.width - 96;
              const placeBelow = box.y < 36;
              const xPos = alignLeft
                ? Math.max(8, box.x)
                : alignRight
                  ? Math.min(svgSize.width - 8, box.right)
                  : box.cx;
              const tx = alignLeft ? "0%" : alignRight ? "-100%" : "-50%";
              const ty = placeBelow ? "0%" : "-100%";
              return (
                <div
                  className="cyber-topo-node-tooltip"
                  style={{
                    left: xPos,
                    top: placeBelow ? box.bottom + 6 : box.y - 6,
                    transform: `translate(${tx}, ${ty})`,
                  }}
                >
                  <strong>{item.node.label}</strong>
                  <span>
                    {item.hostScope === "external" ? "外部" : item.hostId} ·{" "}
                    {item.classification.categoryMeta.shortLabel}
                  </span>
                </div>
              );
            })()}

          {hoveredRoute && (
            <div
              className="cyber-arch-edge-tooltip"
              style={{
                left: Math.max(
                  80,
                  Math.min(svgSize.width - 80, hoveredRoute.labelX),
                ),
                top: Math.max(10, hoveredRoute.labelY),
              }}
            >
              <strong>
                {nodeById.get(hoveredRoute.edge.source)?.label} →{" "}
                {nodeById.get(hoveredRoute.edge.target)?.label}
              </strong>
              {hoveredRoute.edge.label && (
                <span>{hoveredRoute.edge.label}</span>
              )}
            </div>
          )}

          {primaryZones.length > 0 && (
            <div className="cyber-topo-main-col">
              {primaryZones.map(renderZone)}
            </div>
          )}

          {secondaryZones.length > 0 && (
            <div className="cyber-topo-right-col">
              {secondaryZones.map(renderZone)}
            </div>
          )}
        </div>

        {model.outOfTopologyNodes.length > 0 && (
          <section className="cyber-topo-excluded">
            <header className="cyber-topo-excluded-head">
              <button
                type="button"
                className="cyber-topo-excluded-toggle"
                onClick={() => setExcludedOpen((v) => !v)}
              >
                {excludedOpen ? (
                  <ChevronDown size={13} />
                ) : (
                  <ChevronRight size={13} />
                )}
                <strong>
                  不在此拓扑中（{model.outOfTopologyNodes.length} 个组件 ·{" "}
                  {model.excludedByHost.length} 台机器）
                </strong>
              </button>
              <button
                type="button"
                className="cyber-topo-reset-btn"
                onClick={onResetFilter}
              >
                显示全部成员
              </button>
            </header>
            {excludedOpen && (
              <div className="cyber-topo-excluded-groups">
                {model.excludedByHost.map((grp) => (
                  <div key={grp.hostId} className="cyber-topo-excluded-host">
                    <div className="cyber-topo-excluded-host-head">
                      <span>{grp.hostLabel}</span>
                      <em>{grp.nodes.length}</em>
                    </div>
                    <div className="cyber-topo-excluded-chips">
                      {grp.nodes.map((item) => (
                        <div
                          key={item.node.id}
                          className="cyber-topo-excluded-chip-wrap"
                        >
                          <button
                            type="button"
                            className="cyber-topo-excluded-chip"
                            onClick={() => onSelectNode(item.node)}
                          >
                            <i
                              style={{
                                background:
                                  item.classification.categoryMeta.color,
                              }}
                            />
                            <span>{item.node.label}</span>
                            <small>
                              {item.classification.categoryMeta.shortLabel}
                            </small>
                          </button>
                          {activeGroup &&
                            onAddToTopology &&
                            !item.node.groups.includes(activeGroup) && (
                              <button
                                type="button"
                                className="cyber-topo-include-btn"
                                title={`将「${item.node.label}」纳入「${activeGroup}」`}
                                onClick={() => onAddToTopology(item.node)}
                              >
                                <Plus size={9} /> 纳入
                              </button>
                            )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
