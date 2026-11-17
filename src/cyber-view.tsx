import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  Database,
  Globe,
  Images,
  Layers,
  LayoutGrid,
  List,
  Lock,
  Minus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Server,
  SlidersHorizontal,
  Upload,
  Zap,
} from "lucide-react";
import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import * as THREE from "three";
import "@xyflow/react/dist/style.css";
import type { Dashboard } from "../shared/domain.js";
import {
  cyberSchema,
  graphGroup,
  type BoundaryRole,
  type CyberGraph,
  type CyberNodeSize,
  type ServiceCategory,
} from "../shared/cyber.js";
import {
  classifyCyberNodes,
  filterCyberByCategory,
  isCyberEdgeQuiet,
  listOrderedCategories,
  resolveTopologyRegistry,
  synthesizeDefaultCyberGraph,
  type NodeClassification,
} from "../shared/cyber-arch.js";
import { builtinServiceIcons } from "../shared/icons.js";
import { eligible } from "../shared/spatial.js";
import { request } from "./api.js";
import {
  buildHostArchitecture,
  HostArchitectureFrame,
  orderHostPreviewNodes,
} from "./cyber-host-arch.js";
import { CyberNodeDialog, CyberTaxonomyDialog } from "./cyber-dialogs.js";
import { CyberTopologyView } from "./cyber-topology-view.js";
import { HomeScene } from "./home-scene.js";
import { WorldDialog, type WorldMutate } from "./possession.js";
import {
  HostBadgeIcon,
  ServiceBadgeIcon,
  type IconLibraryEntry,
  type IconsCatalogResponse,
  type ServiceKind,
} from "./service-icon.js";

type PanelSide = "cloud" | "left" | "right" | "bottom";
type HandleSide = "left" | "right" | "top" | "bottom";
type CyberViewMode = "grid" | "list";
type CyberPerspective = "machine" | "topology";

interface CyberInteractionValue {
  hostFocus?: string;
  hoveredServiceNode?: string;
  hasHostFocus: boolean;
  hasEdgeFocus: boolean;
  hoveredEdge?: string;
  activeHosts: Set<string>;
  outsideHosts: Set<string>;
  outsideNodes: Set<string>;
  group: string;
  power: boolean;
  onExpandHost: (hostId: string) => void;
  onSelectServiceNode: (nodeId: string) => void;
}

const DEFAULT_INTERACTION: CyberInteractionValue = {
  hostFocus: undefined,
  hoveredServiceNode: undefined,
  hasHostFocus: false,
  hasEdgeFocus: false,
  activeHosts: new Set(),
  outsideHosts: new Set(),
  outsideNodes: new Set(),
  group: "",
  power: false,
  onExpandHost: () => {},
  onSelectServiceNode: () => {},
};

const CyberInteractionContext =
  createContext<CyberInteractionValue>(DEFAULT_INTERACTION);

function HostPanel({ data }: NodeProps) {
  const ctx = useContext(CyberInteractionContext);
  const hostId = data.hostId ? String(data.hostId) : "";
  const highlighted = hostId ? ctx.activeHosts.has(hostId) : false;
  const outside = hostId ? ctx.outsideHosts.has(hostId) : false;
  const internalEdgeCount = Number(data.internalEdgeCount ?? 0);
  const nodeCount = Number(data.nodeCount ?? 0);
  const cls = [
    "cyber-host",
    data.remote ? "is-cloud" : "",
    !data.remote && !data.placed ? "is-unplaced" : "",
    highlighted ? "is-highlighted" : "",
    outside ? "is-outside-topology" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} style={{ borderColor: String(data.color) }}>
      <header>
        <HostBadgeIcon
          remote={Boolean(data.remote)}
          label={String(data.label)}
          provider={data.provider ? String(data.provider) : undefined}
          assetKind={data.assetKind ? String(data.assetKind) : undefined}
          tags={Array.isArray(data.tags) ? (data.tags as string[]) : undefined}
          color={String(data.color)}
        />
        <strong>{String(data.label)}</strong>
        {(internalEdgeCount > 0 || nodeCount > 0) && hostId && (
          <button
            type="button"
            className="cyber-arch-pill nodrag nopan"
            title={
              internalEdgeCount > 0
                ? `查看机内 ${internalEdgeCount} 条引用的分层隔离架构`
                : `查看主机分层与分类架构（${nodeCount} 组件）`
            }
            onClick={(e) => {
              e.stopPropagation();
              ctx.onExpandHost(hostId);
            }}
          >
            <Layers size={10} />
            <span>
              {internalEdgeCount > 0 ? `分层·${internalEdgeCount}` : "分层"}
            </span>
          </button>
        )}
      </header>
      <small>
        {outside ? `${String(data.subtitle)} · 拓扑外` : String(data.subtitle)}
      </small>
    </div>
  );
}

const BOUNDARY_SHORT_BADGE: Record<BoundaryRole, string> = {
  ingress: "入",
  dns: "DNS",
  mesh: "网",
  egress: "出",
};

function ServiceNode({ data }: NodeProps) {
  const ctx = useContext(CyberInteractionContext);
  const kind = (data.kind as ServiceKind | undefined) ?? "service";
  const viewMode = (data.viewMode as CyberViewMode | undefined) ?? "list";
  const nodeSize = (data.size as CyberNodeSize | undefined) ?? "large";
  const moreHostId = data.more ? String(data.more) : undefined;
  const nodeId = data.nodeId ? String(data.nodeId) : undefined;
  const isMore = Boolean(moreHostId);
  const boundaryRole = data.boundaryRole as BoundaryRole | undefined;
  const catShort = data.categoryShortLabel
    ? String(data.categoryShortLabel)
    : undefined;
  const catColor = data.categoryColor ? String(data.categoryColor) : undefined;
  const isOutside = nodeId ? ctx.outsideNodes.has(nodeId) : false;
  const titleText = data.detailTitle
    ? String(data.detailTitle)
    : String(data.label);
  return (
    <button
      type="button"
      data-node-size={isMore ? undefined : nodeSize}
      className={[
        "cyber-service",
        "nodrag",
        "nopan",
        `cyber-${kind}`,
        !isMore ? `is-size-${nodeSize}` : "",
        boundaryRole ? "is-boundary" : "",
        isOutside ? "is-outside-topology" : "",
        isMore ? "is-more" : `is-${viewMode}`,
      ]
        .filter(Boolean)
        .join(" ")}
      title={titleText}
      onClick={(e) => {
        e.stopPropagation();
        if (moreHostId) {
          ctx.onExpandHost(moreHostId);
        } else if (nodeId) {
          ctx.onSelectServiceNode(nodeId);
        }
      }}
    >
      <Handle id="t-left" type="target" position={Position.Left} />
      <Handle id="s-left" type="source" position={Position.Left} />
      <Handle id="t-right" type="target" position={Position.Right} />
      <Handle id="s-right" type="source" position={Position.Right} />
      <Handle id="t-top" type="target" position={Position.Top} />
      <Handle id="s-top" type="source" position={Position.Top} />
      <Handle id="t-bottom" type="target" position={Position.Bottom} />
      <Handle id="s-bottom" type="source" position={Position.Bottom} />
      {!isMore && (
        <ServiceBadgeIcon
          icon={data.icon ? String(data.icon) : undefined}
          serviceId={data.serviceId ? String(data.serviceId) : undefined}
          label={String(data.label)}
          kind={kind}
          size={viewMode === "grid" ? 22 : 17}
          className="cyber-service-icon"
        />
      )}
      <strong>{String(data.label)}</strong>
      {!isMore && boundaryRole && (
        <span
          className={`cyber-svc-role-pin is-${boundaryRole}`}
          aria-hidden="true"
        >
          {BOUNDARY_SHORT_BADGE[boundaryRole]}
        </span>
      )}
      {!isMore &&
        !boundaryRole &&
        nodeSize !== "small" &&
        viewMode === "list" &&
        catShort && (
          <em
            className="cyber-svc-cat-badge"
            style={catColor ? { color: catColor } : undefined}
          >
            {catShort}
          </em>
        )}
    </button>
  );
}

interface CyberEdgeData {
  curve?: "sameCol" | "skyHoriz" | "skyArch" | "cross" | "bottomArch";
  bow?: number;
  clearX?: number;
  spread?: number;
  sSide?: HandleSide;
  tSide?: HandleSide;
  maxX?: number;
  sHost?: string;
  tHost?: string;
  nodeIds?: string[];
  quiet?: boolean;
  power?: boolean;
  label?: string;
}

function edgeProtocolIcon(label?: string, power?: boolean) {
  if (power) return <Zap size={10} />;
  const text = (label ?? "").toLowerCase();
  if (/sql|db|postgres|redis|data|库/.test(text)) return <Database size={10} />;
  if (/https|tls|ssl|隧道|tunnel|vpn|proxy|出网/.test(text))
    return <Lock size={10} />;
  if (/备份|backup|sync|同步/.test(text)) return <RefreshCw size={10} />;
  if (/dns/.test(text)) return <Globe size={10} />;
  return <ArrowRight size={10} />;
}

function CyberEdge(props: EdgeProps) {
  const {
    id,
    sourceX: sx,
    sourceY: sy,
    targetX: tx,
    targetY: ty,
    style,
    data,
  } = props;
  const ctx = useContext(CyberInteractionContext);
  const meta = (data ?? {}) as CyberEdgeData;
  let path = "";
  let labelX = (sx + tx) / 2;
  let labelY = (sy + ty) / 2;

  if (meta.curve === "sameCol") {
    const bow = meta.bow ?? 32;
    const ctrlX =
      meta.clearX !== undefined
        ? bow >= 0
          ? Math.max(sx, tx, meta.clearX) + bow
          : Math.min(sx, tx, meta.clearX) + bow
        : sx + bow;
    const c1x = meta.clearX !== undefined ? ctrlX : sx + bow;
    const c2x = meta.clearX !== undefined ? ctrlX : tx + bow;
    path = `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
    labelX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
    labelY = (sy + ty) / 2;
  } else if (meta.curve === "skyArch" || meta.curve === "bottomArch") {
    const lift = meta.bow ?? -34;
    const c1y = sy + lift;
    const c2y = ty + lift;
    path = `M ${sx} ${sy} C ${sx} ${c1y}, ${tx} ${c2y}, ${tx} ${ty}`;
    labelX = (sx + tx) / 2;
    labelY = (sy + 3 * c1y + 3 * c2y + ty) / 8;
  } else if (meta.curve === "skyHoriz") {
    const midX = (sx + tx) / 2;
    const dip = meta.spread ?? 0;
    path = `M ${sx} ${sy} Q ${midX} ${(sy + ty) / 2 + dip}, ${tx} ${ty}`;
    labelX = midX;
    labelY = (sy + ty) / 2 + dip * 0.5;
  } else {
    const sSide = meta.sSide ?? "right";
    const tSide = meta.tSide ?? "left";
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    const pull = Math.min(130, Math.max(42, dist * 0.36));
    const spread = meta.spread ?? 0;
    const vec = (side: HandleSide): [number, number] =>
      side === "left"
        ? [-1, 0]
        : side === "right"
          ? [1, 0]
          : side === "top"
            ? [0, -1]
            : [0, 1];
    const [svx, svy] = vec(sSide);
    const [tvx, tvy] = vec(tSide);
    const c1x = sx + svx * pull + (svx === 0 ? spread * 0.6 : 0);
    const c1y = sy + svy * pull + (svy === 0 ? spread : 0);
    const c2x = tx + tvx * pull + (tvx === 0 ? spread * 0.6 : 0);
    const c2y = ty + tvy * pull + (tvy === 0 ? spread : 0);
    path = `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tx} ${ty}`;
    labelX = (sx + 3 * c1x + 3 * c2x + tx) / 8;
    labelY = (sy + 3 * c1y + 3 * c2y + ty) / 8;
  }
  const safeX = meta.maxX
    ? Math.max(24, Math.min(meta.maxX - 24, labelX))
    : labelX;

  const isQuiet = Boolean(meta.quiet);
  const quietRevealed =
    !isQuiet ||
    ctx.hoveredEdge === id ||
    (ctx.hoveredServiceNode
      ? Boolean(meta.nodeIds?.includes(ctx.hoveredServiceNode))
      : Boolean(
          ctx.hostFocus &&
          (meta.sHost === ctx.hostFocus || meta.tHost === ctx.hostFocus),
        ));
  if (!quietRevealed) return null;

  const hasFilter = ctx.hasHostFocus || ctx.hasEdgeFocus;
  const isServiceMatch = Boolean(
    ctx.hoveredServiceNode && meta.nodeIds?.includes(ctx.hoveredServiceNode),
  );
  const isEdgeActive =
    !hasFilter ||
    ctx.hoveredEdge === id ||
    isServiceMatch ||
    (!ctx.hoveredServiceNode &&
      Boolean(
        ctx.hostFocus &&
        (meta.sHost === ctx.hostFocus || meta.tHost === ctx.hostFocus),
      ));
  const highlighted = Boolean(
    ctx.group || ctx.power || (isEdgeActive && hasFilter),
  );
  const isCalmOverview = !ctx.group && !ctx.power && !hasFilter;
  const isExplicitHighlight =
    ctx.hoveredEdge === id ||
    isServiceMatch ||
    (!ctx.hoveredServiceNode &&
      Boolean(
        ctx.hostFocus &&
        (meta.sHost === ctx.hostFocus || meta.tHost === ctx.hostFocus),
      ));
  const strokeColor = isExplicitHighlight
    ? "#87e8de"
    : ctx.group
      ? "#7bd8cf"
      : ctx.power
        ? "#e0be7b"
        : "#74a5b5";
  const strokeOpacity = !isEdgeActive ? 0.24 : isCalmOverview ? 0.56 : 0.92;
  const shouldAnimate = !ctx.power && !isCalmOverview && isEdgeActive;
  const markerEnd = isExplicitHighlight
    ? "url(#cyber-arrow-active)"
    : ctx.group
      ? "url(#cyber-arrow-group)"
      : ctx.power
        ? "url(#cyber-arrow-power)"
        : "url(#cyber-arrow-base)";
  const iconOnly = Boolean(isCalmOverview && !highlighted);

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth: highlighted ? 1.85 : 1.25,
          opacity: strokeOpacity,
          strokeDasharray: shouldAnimate ? "5" : undefined,
          animation: shouldAnimate
            ? "dashdraw 0.5s linear infinite"
            : undefined,
        }}
        markerEnd={markerEnd}
      />
      {meta.label && (
        <EdgeLabelRenderer>
          <div
            className={`cyber-edge-label ${highlighted ? "is-active" : ""} ${isCalmOverview ? "is-calm" : ""} ${iconOnly ? "is-icon-only" : ""}`}
            title={meta.label}
            aria-label={meta.label}
            style={{
              transform: `translate(-50%, -50%) translate(${safeX}px, ${labelY}px)`,
              opacity: strokeOpacity < 0.25 ? 0.22 : 1,
            }}
          >
            {edgeProtocolIcon(meta.label, meta.power)}
            {!iconOnly && <span>{meta.label}</span>}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { host: HostPanel, service: ServiceNode };
const edgeTypes = { cyber: CyberEdge };
const palette = ["#75cdd7", "#b59bea", "#efbd83", "#8ad4aa", "#ed9ebf"];

function powerGraph(state: Dashboard): CyberGraph {
  const circuits = state.home.electricalCircuits ?? [];
  const ids = [
    ...new Set(
      circuits.flatMap((c) => [
        c.controllerEntityId,
        ...c.channels.flatMap((ch) => ch.entityIds),
      ]),
    ),
  ];
  return {
    version: 1,
    source: "已记录的供电关系 · 非实时读数",
    asOf: "",
    clouds: [],
    nodes: ids.map((id) => ({
      id: `power:${id}`,
      label: state.home.entities.find((e) => e.id === id)!.name,
      host: id,
      kind: "gateway",
      layer: "infra",
      category: "admin",
      groups: [],
    })),
    edges: circuits.flatMap((c) =>
      c.channels.flatMap((ch) =>
        ch.entityIds.map((id) => ({
          id: `power:${c.id}:${ch.id}:${id}`,
          source: `power:${c.controllerEntityId}`,
          target: `power:${id}`,
          label: ch.name,
          groups: [],
        })),
      ),
    ),
  };
}

function sourceGraph(state: Dashboard): CyberGraph {
  return state.home.cyber ?? synthesizeDefaultCyberGraph(state.home, "");
}

interface Panel {
  id: string;
  label: string;
  nodes: CyberGraph["nodes"];
  point: [number, number, number];
  placed: boolean;
  remote: boolean;
  provider: string;
  region: string;
  assetKind?: string;
  tags: string[];
  subtitle: string;
  color: string;
  height: number;
  sideHint: "left" | "right";
  orderKey: number;
  edgeCount: number;
  internalEdgeCount: number;
}

interface PlacedPanel {
  panel: Panel;
  x: number;
  y: number;
  w: number;
  h: number;
  maxRows: number;
  cols: number;
  col: number;
  side: PanelSide;
}

interface Leader {
  id: string;
  x: number;
  y: number;
  px: number;
  py: number;
  color: string;
  label: string;
}

const SERVICE_HEADER_H = 44;
const PHONE_HEADER_H = 40;
const LIST_ROW_H = 26;
const LIST_ROW_STEP = 30;
const GRID_TILE_H = 46;
const GRID_ROW_STEP = 50;

function colsForPanel(
  nodeCount: number,
  viewMode: CyberViewMode,
  phone: boolean,
): number {
  if (viewMode !== "grid") return 1;
  if (phone) return 2;
  return Math.min(3, Math.max(2, nodeCount));
}

function cardHeightFor(
  nodeCount: number,
  maxRows: number,
  viewMode: CyberViewMode,
  cols: number,
  headerH = SERVICE_HEADER_H,
): number {
  if (nodeCount === 0) return 54;
  const capacity = viewMode === "grid" ? maxRows * cols : maxRows;
  const shown = Math.min(nodeCount, capacity);
  const hasMore = nodeCount > shown;
  if (shown === 0) return headerH + 26;
  const rows = viewMode === "grid" ? Math.ceil(shown / cols) : shown;
  const step = viewMode === "grid" ? GRID_ROW_STEP : LIST_ROW_STEP;
  return headerH + rows * step + 6 + (hasMore ? 24 : 0);
}

function computeCyberLayout(
  panels: Panel[],
  width: number,
  height: number,
  viewMode: CyberViewMode,
  chromeBottom?: number,
): {
  placed: PlacedPanel[];
  cardWidth: number;
  skyTop: number;
  skyBottom: number;
  localTop: number;
  stageInsets: { top: number; bottom: number; left: number; right: number };
} {
  const narrow = width <= 800;
  const phone = width <= 520;
  const top = Math.max(chromeBottom ?? (phone ? 184 : narrow ? 156 : 114), 72);
  const bottom = phone ? 114 : narrow ? 74 : 52;
  const margin = phone ? 12 : narrow ? 12 : 20;
  const gap = phone ? 10 : narrow ? 10 : 12;
  const colGap = phone ? 44 : gap;
  const skyGap = phone ? 44 : width >= 880 ? 54 : narrow ? 14 : 34;
  const cardWidth = phone
    ? Math.floor((width - margin * 2 - colGap) / 2)
    : narrow
      ? 186
      : 204;
  const panelCols = (nodeCount: number) =>
    colsForPanel(nodeCount, viewMode, phone);

  const remotePanels = panels
    .filter((p) => p.remote)
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) ||
        a.region.localeCompare(b.region) ||
        a.label.localeCompare(b.label) ||
        a.id.localeCompare(b.id),
    );
  const localPanels = panels
    .filter((p) => !p.remote)
    .sort(
      (a, b) =>
        Number(b.placed) - Number(a.placed) ||
        a.orderKey - b.orderKey ||
        a.id.localeCompare(b.id),
    );

  const placed: PlacedPanel[] = [];
  let cursorY = top;

  if (phone) {
    // Phones: 2-col compact clouds in the upper sky, open 3D stage in middle, 2-col local tray at bottom.
    const sortedClouds = [...remotePanels].sort(
      (a, b) => b.edgeCount - a.edgeCount || a.id.localeCompare(b.id),
    );
    const phoneRowH = viewMode === "grid" ? 88 : 74;
    const cloudRowsMax = Math.max(
      0,
      Math.floor((height - top - bottom - 220) / (phoneRowH + 8)),
    );
    const maxClouds = Math.min(sortedClouds.length, cloudRowsMax * 2);
    const phoneClouds = sortedClouds.slice(0, maxClouds);
    for (let i = 0; i < phoneClouds.length; i += 2) {
      const row = phoneClouds.slice(i, i + 2);
      const rowW = row.length * cardWidth + (row.length - 1) * colGap;
      const startX = Math.round((width - rowW) / 2);
      let rowH = 0;
      row.forEach((panel, idx) => {
        const cols = panelCols(panel.nodes.length);
        const h = Math.min(
          phoneRowH,
          cardHeightFor(panel.nodes.length, 1, viewMode, cols, PHONE_HEADER_H),
        );
        placed.push({
          panel,
          x: startX + idx * (cardWidth + colGap),
          y: cursorY,
          w: cardWidth,
          h,
          maxRows: 1,
          cols,
          col: idx,
          side: "cloud",
        });
        rowH = Math.max(rowH, h);
      });
      cursorY += rowH + gap;
    }

    const skyBottom = phoneClouds.length ? cursorY - gap : top;
    const minStageH = Math.min(250, Math.max(180, Math.round(height * 0.31)));
    const stageTop = phoneClouds.length ? skyBottom + 12 : top;
    const maxLocalZone = Math.max(0, height - bottom - (stageTop + minStageH));

    const sortedLocals = [...localPanels].sort(
      (a, b) =>
        Number(b.edgeCount > 0) - Number(a.edgeCount > 0) ||
        b.edgeCount - a.edgeCount ||
        Number(b.placed) - Number(a.placed) ||
        a.id.localeCompare(b.id),
    );
    const rowHeight = phoneRowH;
    const localRows: Panel[][] = [];
    for (let i = 0; i < sortedLocals.length; i += 2) {
      const nextRows = localRows.length + 1;
      if (nextRows * rowHeight + (nextRows - 1) * gap > maxLocalZone) break;
      localRows.push(sortedLocals.slice(i, i + 2));
    }
    const localTotalH =
      localRows.length > 0
        ? localRows.length * rowHeight + (localRows.length - 1) * gap
        : 0;
    const localStartY = height - bottom - localTotalH;
    localRows.forEach((row, rIdx) => {
      const rowW = row.length * cardWidth + (row.length - 1) * colGap;
      const startX = Math.round((width - rowW) / 2);
      const y = localStartY + rIdx * (rowHeight + gap);
      row.forEach((panel, cIdx) => {
        const cols = panelCols(panel.nodes.length);
        const h = Math.min(
          rowHeight,
          cardHeightFor(panel.nodes.length, 1, viewMode, cols, PHONE_HEADER_H),
        );
        placed.push({
          panel,
          x: startX + cIdx * (cardWidth + colGap),
          y,
          w: cardWidth,
          h,
          maxRows: 1,
          cols,
          col: cIdx,
          side: "bottom",
        });
      });
    });

    const stageBottom = localRows.length ? height - localStartY + 12 : bottom;
    return {
      placed,
      cardWidth,
      skyTop: top,
      skyBottom,
      localTop: localRows.length ? localStartY : skyBottom,
      stageInsets: { top: stageTop, bottom: stageBottom, left: 0, right: 0 },
    };
  }

  // Desktop & tablet: Cloud / External cards float calmly in the centered upper sky band.
  const cloudRowCap =
    viewMode === "grid"
      ? remotePanels.length > 4
        ? 1
        : 3
      : remotePanels.length > 4
        ? 2
        : 6;
  if (remotePanels.length) {
    const perRow = Math.max(
      1,
      Math.floor((width - margin * 2 + skyGap) / (cardWidth + skyGap)),
    );
    for (let i = 0; i < remotePanels.length; i += perRow) {
      const row = remotePanels.slice(i, i + perRow);
      const rowWidth = row.length * cardWidth + (row.length - 1) * skyGap;
      const startX = Math.round((width - rowWidth) / 2);
      let rowMaxH = 0;
      row.forEach((panel, idx) => {
        const cols = panelCols(panel.nodes.length);
        const h = Math.min(
          cardHeightFor(panel.nodes.length, cloudRowCap, viewMode, cols),
          Math.max(56, height - top - bottom),
        );
        if (cursorY + h <= height - bottom) {
          placed.push({
            panel,
            x: startX + idx * (cardWidth + skyGap),
            y: cursorY,
            w: cardWidth,
            h,
            maxRows: cloudRowCap,
            cols,
            col: idx,
            side: "cloud",
          });
          rowMaxH = Math.max(rowMaxH, h);
        }
      });
      if (rowMaxH > 0) cursorY += rowMaxH + gap;
    }
  }

  const skyBottom = remotePanels.length ? cursorY - gap : top;
  const localTop = remotePanels.length ? skyBottom + (narrow ? 16 : 22) : top;
  const availableH = Math.max(64, height - localTop - bottom);

  // Adaptive row cap: preserve uncluttered 1-col flanks around the 3D scene as density grows.
  const canTwoFlankCols = width >= cardWidth * 4 + margin * 2 + gap * 3 + 260;

  const splitAndPack = (rowCap: number, maxCols: number) => {
    const leftQueue: Panel[] = [];
    const rightQueue: Panel[] = [];
    let leftH = 0;
    let rightH = 0;
    const mixedSides = localPanels.some(
      (p) => p.placed && p.sideHint !== localPanels[0]?.sideHint,
    );
    for (const panel of localPanels) {
      const ph = Math.min(
        cardHeightFor(
          panel.nodes.length,
          rowCap,
          viewMode,
          panelCols(panel.nodes.length),
        ),
        availableH,
      );
      const goLeft =
        panel.placed && mixedSides
          ? panel.sideHint === "left"
          : leftH <= rightH;
      if (goLeft) {
        leftQueue.push(panel);
        leftH += ph + gap;
      } else {
        rightQueue.push(panel);
        rightH += ph + gap;
      }
    }
    const lastH = (q: Panel[]) => {
      const p = q.at(-1);
      return p
        ? Math.min(
            cardHeightFor(
              p.nodes.length,
              rowCap,
              viewMode,
              panelCols(p.nodes.length),
            ),
            availableH,
          )
        : 0;
    };
    while (
      leftH > availableH &&
      rightH + lastH(leftQueue) <= availableH &&
      leftQueue.length > 1
    ) {
      const moved = leftQueue.pop()!;
      const mh = Math.min(
        cardHeightFor(
          moved.nodes.length,
          rowCap,
          viewMode,
          panelCols(moved.nodes.length),
        ),
        availableH,
      );
      leftH -= mh + gap;
      rightQueue.push(moved);
      rightH += mh + gap;
    }
    while (
      rightH > availableH &&
      leftH + lastH(rightQueue) <= availableH &&
      rightQueue.length > 1
    ) {
      const moved = rightQueue.pop()!;
      const mh = Math.min(
        cardHeightFor(
          moved.nodes.length,
          rowCap,
          viewMode,
          panelCols(moved.nodes.length),
        ),
        availableH,
      );
      rightH -= mh + gap;
      leftQueue.push(moved);
      leftH += mh + gap;
    }

    const packSide = (items: Panel[], side: "left" | "right") => {
      const itemsPlaced: PlacedPanel[] = [];
      let col = 0;
      let y = localTop;
      let dropped = 0;
      for (const panel of items) {
        const cols = panelCols(panel.nodes.length);
        const h = Math.min(
          cardHeightFor(panel.nodes.length, rowCap, viewMode, cols),
          availableH,
        );
        if (y + h > height - bottom) {
          col++;
          y = localTop;
        }
        if (col >= maxCols) {
          dropped++;
          continue;
        }
        const x =
          side === "left"
            ? margin + col * (cardWidth + gap)
            : width - margin - cardWidth - col * (cardWidth + gap);
        if (x < margin || x + cardWidth > width - margin) {
          dropped++;
          continue;
        }
        itemsPlaced.push({
          panel,
          x,
          y,
          w: cardWidth,
          h,
          maxRows: rowCap,
          cols,
          col,
          side,
        });
        y += h + gap;
      }
      return { itemsPlaced, dropped };
    };

    const leftRes = packSide(leftQueue, "left");
    const rightRes = packSide(rightQueue, "right");
    return {
      items: [...leftRes.itemsPlaced, ...rightRes.itemsPlaced],
      dropped: leftRes.dropped + rightRes.dropped,
    };
  };

  const initialCap = viewMode === "grid" ? 3 : 6;
  const fallbackCaps = viewMode === "grid" ? [2, 1, 0] : [4, 3, 2, 1, 0];
  let best = splitAndPack(initialCap, 1);
  if (best.dropped > 0) {
    for (const cap of fallbackCaps) {
      const candidate = splitAndPack(cap, 1);
      best = candidate;
      if (candidate.dropped === 0) break;
    }
  }
  if (best.dropped > 0 && canTwoFlankCols) {
    for (const cap of [2, 1, 0]) {
      const candidate = splitAndPack(cap, 2);
      if (candidate.dropped < best.dropped || candidate.dropped === 0) {
        best = candidate;
      }
      if (candidate.dropped === 0) break;
    }
  }

  placed.push(...best.items);
  const leftCards = best.items.filter((p) => p.side === "left");
  const rightCards = best.items.filter((p) => p.side === "right");
  const leftInset = leftCards.length
    ? Math.max(...leftCards.map((c) => c.x + c.w)) + 14
    : 0;
  const rightInset = rightCards.length
    ? width - Math.min(...rightCards.map((c) => c.x)) + 14
    : 0;
  return {
    placed,
    cardWidth,
    skyTop: top,
    skyBottom,
    localTop,
    stageInsets: {
      top: remotePanels.length ? skyBottom + 14 : top + 6,
      bottom: bottom + 6,
      left: leftInset,
      right: rightInset,
    },
  };
}

export function CyberView({
  state,
  scene,
  mutate,
  onClose,
  onExample,
  onService,
  selectedHostId,
  onSelectEntity,
}: {
  state: Dashboard;
  scene: RefObject<HomeScene | null>;
  mutate: WorldMutate;
  onClose: () => void;
  onExample: () => void;
  onService: (id: string) => void;
  selectedHostId?: string;
  onSelectEntity?: (id?: string) => void;
}) {
  const [viewMode, setViewMode] = useState<CyberViewMode>(() => {
    try {
      return localStorage.getItem("home-atlas.cyber-view-mode") === "list"
        ? "list"
        : "grid";
    } catch {
      return "grid";
    }
  });
  const switchViewMode = (mode: CyberViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem("home-atlas.cyber-view-mode", mode);
    } catch {
      /* ignore storage errors */
    }
  };
  const [perspective, setPerspective] = useState<CyberPerspective>(() => {
    try {
      return localStorage.getItem("home-atlas.cyber-perspective") === "topology"
        ? "topology"
        : "machine";
    } catch {
      return "machine";
    }
  });
  const switchPerspective = (next: CyberPerspective) => {
    setPerspective(next);
    try {
      localStorage.setItem("home-atlas.cyber-perspective", next);
    } catch {
      /* ignore storage errors */
    }
  };
  const [power, setPower] = useState(false);
  const [group, setGroup] = useState(""),
    [categoryFilter, setCategoryFilter] = useState<ServiceCategory | "">(""),
    [contrastOutside, setContrastOutside] = useState(false),
    [hostFilter, setHostFilter] = useState(""),
    [importing, setImporting] = useState(false),
    [taxonomyOpen, setTaxonomyOpen] = useState(false),
    [iconLibraryOpen, setIconLibraryOpen] = useState(false),
    [iconCatalog, setIconCatalog] = useState<IconsCatalogResponse>(),
    [iconUploadName, setIconUploadName] = useState(""),
    [iconBusy, setIconBusy] = useState(false),
    [iconMsg, setIconMsg] = useState(""),
    [targetIconNodeId, setTargetIconNodeId] = useState(""),
    [input, setInput] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [hoveredHost, setHoveredHost] = useState<string>();
  const [hoveredServiceNode, setHoveredServiceNode] = useState<string>();
  const [hoveredEdge, setHoveredEdge] = useState<string>();
  const [nodes, setNodes] = useState<Node[]>([]),
    [edges, setEdges] = useState<Edge[]>([]),
    [leaders, setLeaders] = useState<Leader[]>([]),
    [skyBand, setSkyBand] = useState<{ top: number; bottom: number }>(),
    [chromeBottom, setChromeBottom] = useState<number>(),
    [size, setSize] = useState({ width: 1440, height: 960 });
  const [chosen, setChosen] = useState<CyberGraph["nodes"][number]>(),
    [hostDetails, setHostDetails] = useState<string>();
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [renderedViewMode, setRenderedViewMode] =
    useState<CyberViewMode>(viewMode);
  const layer = useRef<HTMLDivElement>(null);
  const chromeRef = useRef<HTMLDivElement>(null);

  const baseGraph = useMemo(() => sourceGraph(state), [state.home]);
  const graph = useMemo(
    () => (power ? powerGraph(state) : baseGraph),
    [state.home, power, baseGraph],
  );
  const resolvedCategories = useMemo(
    () => listOrderedCategories(graph.categories),
    [graph.categories],
  );
  const resolvedTopologies = useMemo(
    () => resolveTopologyRegistry(baseGraph),
    [baseGraph],
  );
  const nodeClassifications = useMemo(
    () =>
      classifyCyberNodes(graph.nodes, graph.edges, state.home.services, {
        categories: graph.categories,
        zones: graph.zones,
      }) as Map<string, NodeClassification>,
    [
      graph.nodes,
      graph.edges,
      state.home.services,
      graph.categories,
      graph.zones,
    ],
  );
  const activeChosen = chosen
    ? graph.nodes.find((n) => n.id === chosen.id)
    : undefined;
  const activeFilter = Boolean(group || categoryFilter || hostFilter);
  const groupFiltered = useMemo(() => graphGroup(graph, group), [graph, group]);
  const categoryFiltered = useMemo(
    () =>
      filterCyberByCategory(groupFiltered, categoryFilter, nodeClassifications),
    [groupFiltered, categoryFilter, nodeClassifications],
  );
  const filtered = useMemo(() => {
    if (!hostFilter) return categoryFiltered;
    const hostEdges = categoryFiltered.edges.filter((e) => {
      const sNode = categoryFiltered.nodes.find((n) => n.id === e.source);
      const tNode = categoryFiltered.nodes.find((n) => n.id === e.target);
      return (
        (sNode?.host ?? "__external") === hostFilter ||
        (tNode?.host ?? "__external") === hostFilter
      );
    });
    const keepIds = new Set(
      categoryFiltered.nodes
        .filter((n) => (n.host ?? "__external") === hostFilter)
        .map((n) => n.id),
    );
    for (const e of hostEdges) {
      keepIds.add(e.source);
      keepIds.add(e.target);
    }
    return {
      ...categoryFiltered,
      nodes: categoryFiltered.nodes.filter((n) => keepIds.has(n.id)),
      edges: hostEdges,
    };
  }, [categoryFiltered, hostFilter]);

  const showContrast =
    contrastOutside &&
    perspective === "machine" &&
    Boolean(group || categoryFilter);
  const displayGraph = useMemo(
    () => (showContrast ? { ...graph, edges: filtered.edges } : filtered),
    [showContrast, graph, filtered],
  );
  const activeNodeIds = useMemo(
    () => new Set(filtered.nodes.map((n) => n.id)),
    [filtered.nodes],
  );
  const outsideNodes = useMemo(() => {
    const out = new Set<string>();
    if (!showContrast) return out;
    for (const n of graph.nodes) {
      if (!activeNodeIds.has(n.id)) out.add(n.id);
    }
    return out;
  }, [showContrast, graph.nodes, activeNodeIds]);

  const panels = useMemo(() => {
    const physical = state.home.rooms.filter((r) => r.kind === "room");
    const centerX =
      physical.reduce((sum, r) => sum + r.origin[0], 0) /
      Math.max(1, physical.length);
    const centerZ =
      physical.reduce((sum, r) => sum + r.origin[2], 0) /
      Math.max(1, physical.length);
    const hostIds = [
      ...new Set(displayGraph.nodes.map((n) => n.host ?? "__external")),
    ];
    if ((!group && !categoryFilter && !power) || showContrast)
      for (const h of state.home.entities.filter(
        (e) => e.category === "host" && e.lifecycle === "active",
      ))
        if (!hostIds.includes(h.id)) hostIds.push(h.id);
    const providers = [...new Set(graph.clouds.map((c) => c.provider))];
    const nodeHostMap = new Map(
      displayGraph.nodes.map((n) => [n.id, n.host ?? "__external"]),
    );
    const edgeCounts = new Map<string, number>();
    const internalEdgeCounts = new Map<string, number>();
    for (const e of displayGraph.edges) {
      const sHost = nodeHostMap.get(e.source) ?? "__external";
      const tHost = nodeHostMap.get(e.target) ?? "__external";
      if (sHost === tHost) {
        internalEdgeCounts.set(sHost, (internalEdgeCounts.get(sHost) ?? 0) + 1);
      } else {
        edgeCounts.set(sHost, (edgeCounts.get(sHost) ?? 0) + 1);
        edgeCounts.set(tHost, (edgeCounts.get(tHost) ?? 0) + 1);
      }
    }

    return hostIds
      .filter((id) => !hostFilter || hostFilter === id)
      .map((id, index): Panel => {
        const host = state.home.entities.find((e) => e.id === id),
          room = state.home.rooms.find((r) => r.id === host?.locationId),
          asset = state.home.assets.find((a) => a.id === host?.assetId);
        const cloud = graph.clouds.find((c) => c.host === id),
          remote = host?.scope === "remote" || id === "__external";
        const placedInRoom = Boolean(!remote && host && room?.kind === "room");
        const point: [number, number, number] =
          placedInRoom && host && room
            ? [
                room.origin[0] + host.position[0],
                room.origin[1] + host.position[1] + (asset?.height ?? 0.2),
                room.origin[2] + host.position[2],
              ]
            : [centerX, 0, centerZ];
        const rawChildren = displayGraph.nodes.filter(
          (n) => (n.host ?? "__external") === id,
        );
        const children = orderHostPreviewNodes(
          rawChildren,
          displayGraph.edges,
          state.home.services,
          { categories: graph.categories, zones: graph.zones },
        );
        return {
          id,
          label: host?.name ?? "外部服务",
          nodes: children,
          point,
          placed: placedInRoom,
          remote,
          provider: cloud?.provider ?? (id === "__external" ? "外部" : "云端"),
          region: cloud?.region ?? "逻辑位置",
          assetKind: asset?.kind,
          tags: host?.tags ?? [],
          subtitle: cloud
            ? `${cloud.provider} · ${cloud.region}`
            : remote
              ? "远端逻辑节点"
              : room?.kind === "unplaced" || !placedInRoom
                ? children.length
                  ? `${children.length} 个服务 · 位置待确认`
                  : "位置待确认"
                : `${children.length} 个服务 · ${room?.name ?? "物理空间"}`,
          color: remote
            ? palette[
                Math.max(0, providers.indexOf(cloud?.provider ?? "")) %
                  palette.length
              ]
            : palette[index % palette.length],
          height: cardHeightFor(
            children.length,
            viewMode === "grid" ? 3 : 6,
            viewMode,
            viewMode === "grid" ? 3 : 1,
          ),
          sideHint: point[0] <= centerX ? "left" : "right",
          orderKey: point[2],
          edgeCount: edgeCounts.get(id) ?? 0,
          internalEdgeCount: internalEdgeCounts.get(id) ?? 0,
        };
      });
  }, [
    state.home,
    displayGraph,
    graph.clouds,
    group,
    categoryFilter,
    showContrast,
    hostFilter,
    power,
    viewMode,
  ]);

  const layout = useMemo(
    () =>
      computeCyberLayout(
        panels,
        size.width,
        size.height,
        viewMode,
        chromeBottom,
      ),
    [panels, size.width, size.height, viewMode, chromeBottom],
  );

  useEffect(() => {
    const element = layer.current!;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      const chrome = chromeRef.current;
      if (chrome) {
        setChromeBottom(chrome.offsetTop + chrome.offsetHeight + 10);
      }
    };
    const ro = new ResizeObserver(measure);
    ro.observe(element);
    if (chromeRef.current) ro.observe(chromeRef.current);
    measure();
    return () => ro.disconnect();
  }, [resolvedTopologies.length, power, viewMode, perspective, activeFilter]);

  // Frame the 3D spatial room cleanly inside the open stage (below clouds, clear of flanks & trays).
  useEffect(() => {
    if (perspective === "topology") {
      scene.current?.setCyber(true, { top: 0, bottom: 0, left: 0, right: 0 });
    } else {
      scene.current?.setCyber(true, layout.stageInsets);
    }
  }, [layout.stageInsets, perspective, scene]);

  // Forward wheel/pinch scrolling over cards, edges, and chrome to the 3D WebGL canvas.
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      const canvas = scene.current?.renderer.domElement;
      if (!canvas) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          ".cyber-modal, .world-dialog, .cyber-host-frame-backdrop, .cyber-host-frame, .cyber-topo-stage, dialog, select, textarea, input",
        )
      )
        return;
      if (event.target === canvas) return;
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
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [scene]);

  const handleExpandHost = useCallback((hostId: string) => {
    setHostDetails(hostId);
  }, []);

  const handleSelectServiceNode = useCallback(
    (nodeId: string) => {
      const node = graph.nodes.find((g) => g.id === nodeId);
      if (node) setChosen(node);
    },
    [graph.nodes],
  );

  const outsideHosts = useMemo(() => {
    const out = new Set<string>();
    if (!showContrast) return out;
    const activeHostSet = new Set(
      filtered.nodes.map((n) => n.host ?? "__external"),
    );
    for (const p of panels) {
      if (!activeHostSet.has(p.id)) out.add(p.id);
    }
    return out;
  }, [showContrast, filtered.nodes, panels]);

  const interactionValue = useMemo<CyberInteractionValue>(() => {
    const hostFocus = hoveredHost ?? selectedHostId;
    const nodeHostMap = new Map(
      displayGraph.nodes.map((n) => [n.id, n.host ?? "__external"]),
    );
    const activeHosts = new Set<string>();
    if (hostFocus) {
      activeHosts.add(hostFocus);
      for (const e of displayGraph.edges) {
        const sh = nodeHostMap.get(e.source) ?? "__external";
        const th = nodeHostMap.get(e.target) ?? "__external";
        if (sh === hostFocus) activeHosts.add(th);
        if (th === hostFocus) activeHosts.add(sh);
      }
    } else if (hoveredEdge) {
      const renderedEdge = edges.find((e) => e.id === hoveredEdge);
      const edgeMeta = renderedEdge?.data as CyberEdgeData | undefined;
      if (edgeMeta?.sHost) activeHosts.add(edgeMeta.sHost);
      if (edgeMeta?.tHost) activeHosts.add(edgeMeta.tHost);
      if (!edgeMeta) {
        const rawEdge = displayGraph.edges.find((e) => e.id === hoveredEdge);
        if (rawEdge) {
          activeHosts.add(nodeHostMap.get(rawEdge.source) ?? "__external");
          activeHosts.add(nodeHostMap.get(rawEdge.target) ?? "__external");
        }
      }
    }
    return {
      hostFocus,
      hoveredServiceNode,
      hasHostFocus: Boolean(hostFocus),
      hasEdgeFocus: Boolean(hoveredEdge),
      hoveredEdge,
      activeHosts,
      outsideHosts,
      outsideNodes,
      group,
      power,
      onExpandHost: handleExpandHost,
      onSelectServiceNode: handleSelectServiceNode,
    };
  }, [
    hoveredHost,
    hoveredServiceNode,
    selectedHostId,
    hoveredEdge,
    displayGraph,
    edges,
    outsideHosts,
    outsideNodes,
    group,
    power,
    handleExpandHost,
    handleSelectServiceNode,
  ]);

  // Build stable React Flow nodes & edges whenever layout, graph, or ELK order changes
  // (never on orbit or hover, so hover never resets React Flow node dimensions during clicks).
  useEffect(() => {
    if (perspective === "topology") {
      setNodes([]);
      setEdges([]);
      setSkyBand(undefined);
      return;
    }
    let alive = true;
    const childOrder = new Map<string, number>();
    const elkCap = viewMode === "grid" ? 9 : 6;
    const hostArchByHost = new Map<
      string,
      ReturnType<typeof buildHostArchitecture>
    >();

    for (const p of panels) {
      if (p.nodes.length <= 1) continue;
      const arch = buildHostArchitecture(
        p.id,
        displayGraph.nodes,
        displayGraph.edges,
        state.home.services,
        { categories: graph.categories, zones: graph.zones },
      );
      hostArchByHost.set(p.id, arch);
      const subset = p.nodes.slice(0, elkCap);
      const previewIndex = new Map(subset.map((n, i) => [n.id, i]));
      const connectedSet = new Set(
        arch.internalEdges.flatMap((e) => [e.source, e.target]),
      );
      const syncSorted = [...subset].sort((a, b) => {
        const aConn = connectedSet.has(a.id) ? 0 : 1;
        const bConn = connectedSet.has(b.id) ? 0 : 1;
        const aLayer = aConn === 0 ? (arch.nodeLayer.get(a.id) ?? 0) : 99;
        const bLayer = bConn === 0 ? (arch.nodeLayer.get(b.id) ?? 0) : 99;
        if (aLayer !== bLayer) return aLayer - bLayer;
        return (previewIndex.get(a.id) ?? 0) - (previewIndex.get(b.id) ?? 0);
      });
      syncSorted.forEach((n, i) => childOrder.set(n.id, i));
    }

    const buildFlow = () => {
      if (!alive) return;
      const nextNodes: Node[] = [];
      const placementByHost = new Map<string, PlacedPanel>();

      const servicesById = new Map(state.home.services.map((s) => [s.id, s]));
      const phone = size.width <= 520;

      for (const item of layout.placed) {
        const { panel, x, y, w, h, maxRows, cols, side } = item;
        placementByHost.set(panel.id, item);
        const parentId = `host:${panel.id}`;
        nextNodes.push({
          id: parentId,
          type: "host",
          position: { x, y },
          style: { width: w, height: h },
          data: {
            hostId: panel.id,
            label: panel.label,
            subtitle: panel.subtitle,
            color: panel.color,
            remote: panel.remote,
            placed: panel.placed,
            provider: panel.provider,
            assetKind: panel.assetKind,
            tags: panel.tags,
            internalEdgeCount: panel.internalEdgeCount,
            nodeCount: panel.nodes.length,
          },
          draggable: false,
          selectable: false,
        });
        const capacity = viewMode === "grid" ? maxRows * cols : maxRows;
        const visibleCount = Math.min(panel.nodes.length, capacity);
        const sortedChildren = [...panel.nodes.slice(0, visibleCount)].sort(
          (a, b) => (childOrder.get(a.id) ?? 0) - (childOrder.get(b.id) ?? 0),
        );
        const headerH = phone ? PHONE_HEADER_H : SERVICE_HEADER_H;
        const padX = phone ? 8 : 10;
        const gridGap = 6;
        const tileW =
          viewMode === "grid"
            ? Math.floor((w - padX * 2 - (cols - 1) * gridGap) / cols)
            : w - 20;
        const tileH =
          viewMode === "grid"
            ? phone
              ? Math.min(36, Math.max(30, h - headerH - 6))
              : GRID_TILE_H
            : phone
              ? Math.min(LIST_ROW_H, Math.max(22, h - headerH - 4))
              : LIST_ROW_H;
        const rowStep = viewMode === "grid" ? GRID_ROW_STEP : LIST_ROW_STEP;
        const shownRows =
          viewMode === "grid"
            ? Math.ceil(visibleCount / Math.max(1, cols))
            : visibleCount;

        for (const [i, n] of sortedChildren.entries()) {
          const gridCol = viewMode === "grid" ? i % cols : 0;
          const gridRow = viewMode === "grid" ? Math.floor(i / cols) : i;
          const resolvedService = n.serviceId
            ? servicesById.get(n.serviceId)
            : undefined;
          const cls = nodeClassifications.get(n.id);
          nextNodes.push({
            id: `node:${n.id}`,
            type: "service",
            parentId,
            extent: "parent",
            position: {
              x:
                viewMode === "grid" ? padX + gridCol * (tileW + gridGap) : padX,
              y: headerH + gridRow * rowStep,
            },
            style: { width: tileW, height: tileH },
            data: {
              label: n.label,
              kind: n.kind,
              icon: n.icon ?? resolvedService?.icon,
              serviceId: n.serviceId,
              viewMode,
              nodeId: n.id,
              hostId: panel.id,
              side,
              size: cls?.size ?? "large",
              boundaryRole: cls?.boundaryRole,
              categoryShortLabel: cls?.categoryMeta.shortLabel,
              categoryColor: cls?.categoryMeta.color,
              detailTitle: cls
                ? `${n.label} · ${cls.layerMeta.label}${cls.boundaryMeta ? `(${cls.boundaryMeta.label})` : ""} · ${cls.categoryMeta.label}`
                : n.label,
            },
            draggable: false,
            selectable: false,
            focusable: false,
          });
        }
        const canFitMore =
          visibleCount === 0 || h >= headerH + shownRows * rowStep + 22;
        if (panel.nodes.length > visibleCount && canFitMore) {
          nextNodes.push({
            id: `more:${panel.id}`,
            type: "service",
            parentId,
            position: { x: padX, y: h - 27 },
            style: { width: w - padX * 2, height: 22 },
            data: {
              label:
                visibleCount === 0
                  ? `${panel.nodes.length} 个服务 · 展开`
                  : `另有 ${panel.nodes.length - visibleCount} 个服务 · 展开`,
              kind: "service",
              more: panel.id,
              viewMode: "list",
              hostId: panel.id,
              side,
            },
            draggable: false,
            selectable: false,
            focusable: false,
          });
        }
      }

      const visible = new Set(nextNodes.map((n) => n.id));
      const nodeHostMap = new Map(
        displayGraph.nodes.map((n) => [n.id, n.host ?? "__external"]),
      );
      const representative = (id: string) =>
        visible.has(`node:${id}`)
          ? `node:${id}`
          : visible.has(`more:${nodeHostMap.get(id) ?? "__external"}`)
            ? `more:${nodeHostMap.get(id) ?? "__external"}`
            : undefined;

      const hasCloud = layout.placed.some((p) => p.side === "cloud");
      setSkyBand(
        hasCloud
          ? { top: layout.skyTop - 10, bottom: layout.skyBottom + 12 }
          : undefined,
      );
      setNodes((prev) => {
        if (prev.length !== nextNodes.length) return nextNodes;
        const prevById = new Map(prev.map((p) => [p.id, p]));
        let changed = false;
        const merged = nextNodes.map((n) => {
          const old = prevById.get(n.id);
          if (
            old &&
            old.type === n.type &&
            old.parentId === n.parentId &&
            old.position.x === n.position.x &&
            old.position.y === n.position.y &&
            old.style?.width === n.style?.width &&
            old.style?.height === n.style?.height &&
            old.data.label === n.data.label &&
            old.data.icon === n.data.icon &&
            old.data.viewMode === n.data.viewMode &&
            old.data.internalEdgeCount === n.data.internalEdgeCount &&
            old.data.nodeCount === n.data.nodeCount &&
            old.data.size === n.data.size &&
            old.data.boundaryRole === n.data.boundaryRole &&
            old.data.categoryShortLabel === n.data.categoryShortLabel
          ) {
            return old;
          }
          changed = true;
          return n;
        });
        return changed ? merged : prev;
      });
      setLayoutWidth(size.width);
      setRenderedViewMode(viewMode);

      // Assign semantic curved cross-host edge routing and bundle collapsed duplicates.
      const sameSideCounter = new Map<string, number>();
      const crossCounter = new Map<string, number>();

      interface EdgeSpec {
        id: string;
        source: string;
        target: string;
        sHost: string;
        tHost: string;
        nodeIds: string[];
        quiet: boolean;
        label?: string;
      }

      const edgeSpecs: EdgeSpec[] = [];
      const collapsedBundles = new Map<string, EdgeSpec[]>();

      for (const e of displayGraph.edges) {
        const source = representative(e.source);
        const target = representative(e.target);
        if (!source || !target) continue;
        const sHost = nodeHostMap.get(e.source) ?? "__external";
        const tHost = nodeHostMap.get(e.target) ?? "__external";
        // Intra-host self-references stay inside HostArchitectureFrame instead of spanning the scene.
        if (sHost === tHost) continue;
        const quiet = isCyberEdgeQuiet(e, nodeClassifications);

        if (source.startsWith("more:") || target.startsWith("more:")) {
          const key = `${source}|${target}|${quiet ? "q" : "v"}`;
          const list = collapsedBundles.get(key) ?? [];
          list.push({
            id: e.id,
            source,
            target,
            sHost,
            tHost,
            nodeIds: [e.source, e.target],
            quiet,
            label: e.label,
          });
          collapsedBundles.set(key, list);
        } else {
          edgeSpecs.push({
            id: e.id,
            source,
            target,
            sHost,
            tHost,
            nodeIds: [e.source, e.target],
            quiet,
            label: e.label,
          });
        }
      }

      for (const [key, items] of collapsedBundles) {
        if (items.length === 1) {
          edgeSpecs.push(items[0]);
        } else {
          const first = items[0];
          const labels = [
            ...new Set(items.map((item) => item.label?.trim()).filter(Boolean)),
          ] as string[];
          const label =
            labels.length === 1
              ? `${labels[0]} ×${items.length}`
              : labels.length > 1
                ? `${labels.slice(0, 2).join(" / ")} ×${items.length}`
                : `${items.length} 条连接`;
          edgeSpecs.push({
            id: `bundle:${key}`,
            source: first.source,
            target: first.target,
            sHost: first.sHost,
            tHost: first.tHost,
            nodeIds: [...new Set(items.flatMap((i) => i.nodeIds))],
            quiet: items.every((i) => i.quiet),
            label,
          });
        }
      }

      const nextEdges: Edge[] = [];
      for (const e of edgeSpecs) {
        const sCard = placementByHost.get(e.sHost);
        const tCard = placementByHost.get(e.tHost);
        if (!sCard || !tCard) continue;

        let sSide: HandleSide = "right";
        let tSide: HandleSide = "left";
        let curve: CyberEdgeData["curve"] = "cross";
        let bow = 0;
        let spread = 0;
        let clearX: number | undefined;

        if (sCard.side === "cloud" && tCard.side === "cloud") {
          const sameRow = Math.abs(sCard.y - tCard.y) < 20;
          const colDist = Math.abs(sCard.col - tCard.col);
          if (sameRow && colDist === 1) {
            sSide = sCard.x <= tCard.x ? "right" : "left";
            tSide = sCard.x <= tCard.x ? "left" : "right";
            curve = "skyHoriz";
            const k = `sky:${Math.min(sCard.col, tCard.col)}:${Math.max(sCard.col, tCard.col)}`;
            const idx = sameSideCounter.get(k) ?? 0;
            sameSideCounter.set(k, idx + 1);
            spread = idx === 0 ? 0 : (idx % 2 === 1 ? 1 : -1) * (8 + idx * 5);
          } else {
            sSide = "bottom";
            tSide = "bottom";
            curve = "skyArch";
            const idx = sameSideCounter.get("skyArch") ?? 0;
            sameSideCounter.set("skyArch", idx + 1);
            bow = 20 + idx * 14;
          }
        } else if (
          (sCard.side === "left" || sCard.side === "right") &&
          sCard.side === tCard.side &&
          sCard.col === tCard.col
        ) {
          const dir = sCard.side === "left" ? 1 : -1;
          sSide = sCard.side === "left" ? "right" : "left";
          tSide = sSide;
          curve = "sameCol";
          clearX =
            sCard.side === "left" ? sCard.x + sCard.w + 18 : sCard.x - 18;
          const k = `${sCard.side}:${sCard.col}`;
          const idx = sameSideCounter.get(k) ?? 0;
          sameSideCounter.set(k, idx + 1);
          bow = dir * (28 + idx * 24);
        } else if (sCard.side === "bottom" && tCard.side === "bottom") {
          if (sCard.col === tCard.col) {
            const dir = sCard.col === 0 ? 1 : -1;
            sSide = sCard.col === 0 ? "right" : "left";
            tSide = sSide;
            curve = "sameCol";
            const k = `bottom:${sCard.col}`;
            const idx = sameSideCounter.get(k) ?? 0;
            sameSideCounter.set(k, idx + 1);
            bow = dir * (16 + idx * 10);
          } else {
            sSide = sCard.col === 0 ? "right" : "left";
            tSide = tCard.col === 0 ? "right" : "left";
            curve = "cross";
            const idx = sameSideCounter.get("bottomCross") ?? 0;
            sameSideCounter.set("bottomCross", idx + 1);
            spread =
              idx === 0
                ? -14
                : (idx % 2 === 1 ? 1 : -1) * (12 + Math.ceil(idx / 2) * 14);
          }
        } else {
          const pickHandle = (
            card: PlacedPanel,
            other: PlacedPanel,
          ): HandleSide => {
            if (card.side === "cloud") return "bottom";
            if (card.side === "bottom")
              return card.col === 0 ? "right" : "left";
            if (card.side === "left") return "right";
            if (card.side === "right") return "left";
            return card.x <= other.x ? "right" : "left";
          };
          sSide = pickHandle(sCard, tCard);
          tSide = pickHandle(tCard, sCard);
          const ck = [sCard.side, tCard.side].sort().join(":");
          const idx = crossCounter.get(ck) ?? 0;
          crossCounter.set(ck, idx + 1);
          spread =
            idx === 0 ? 0 : (idx % 2 === 1 ? 1 : -1) * Math.ceil(idx / 2) * 20;
        }

        nextEdges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: `s-${sSide}`,
          targetHandle: `t-${tSide}`,
          type: "cyber",
          data: {
            curve,
            bow,
            clearX,
            spread,
            sSide,
            tSide,
            maxX: size.width,
            sHost: e.sHost,
            tHost: e.tHost,
            nodeIds: e.nodeIds,
            quiet: e.quiet,
            power,
            label: e.label,
          } satisfies CyberEdgeData,
        });
      }
      setEdges((prev) => {
        if (prev.length !== nextEdges.length) return nextEdges;
        const prevById = new Map(prev.map((p) => [p.id, p]));
        for (const e of nextEdges) {
          const old = prevById.get(e.id);
          const oldData = old?.data as CyberEdgeData | undefined;
          const nextData = e.data as CyberEdgeData | undefined;
          if (
            !old ||
            old.source !== e.source ||
            old.target !== e.target ||
            old.sourceHandle !== e.sourceHandle ||
            old.targetHandle !== e.targetHandle ||
            Boolean(oldData?.quiet) !== Boolean(nextData?.quiet) ||
            (oldData?.nodeIds ?? []).join(",") !==
              (nextData?.nodeIds ?? []).join(",")
          ) {
            return nextEdges;
          }
        }
        return prev;
      });
    };

    buildFlow();

    const elk = new ELK({ workerUrl: elkWorkerUrl, algorithms: ["layered"] });
    void Promise.all(
      panels
        .filter((p) => p.nodes.length > 1)
        .map(async (p) => {
          const subset = p.nodes.slice(0, elkCap);
          const ids = new Set(subset.map((n) => n.id));
          const previewIndex = new Map(subset.map((n, i) => [n.id, i]));
          const arch =
            hostArchByHost.get(p.id) ??
            buildHostArchitecture(
              p.id,
              displayGraph.nodes,
              displayGraph.edges,
              state.home.services,
              { categories: graph.categories, zones: graph.zones },
            );
          const dagEdges = arch.dagEdges.filter(
            (e) => ids.has(e.source) && ids.has(e.target),
          );
          if (dagEdges.length === 0) return false;
          const connectedSet = new Set(
            dagEdges.flatMap((e) => [e.source, e.target]),
          );
          const result = await elk.layout({
            id: p.id,
            layoutOptions: {
              "elk.algorithm": "layered",
              "elk.direction": "DOWN",
              "elk.spacing.nodeNode": "8",
              "elk.padding": "[top=0,left=0,bottom=0,right=0]",
            },
            children: subset.map((n) => ({
              id: n.id,
              width: 200,
              height: LIST_ROW_H,
            })),
            edges: dagEdges.map((e) => ({
              id: e.id,
              sources: [e.source],
              targets: [e.target],
            })),
          });
          if (!alive) return false;
          const sorted = [...(result.children ?? [])].sort((a, b) => {
            const aConn = connectedSet.has(a.id) ? 0 : 1;
            const bConn = connectedSet.has(b.id) ? 0 : 1;
            if (aConn !== bConn) return aConn - bConn;
            const yDiff = Math.round(a.y ?? 0) - Math.round(b.y ?? 0);
            if (aConn === 0 && yDiff !== 0) return yDiff;
            return (
              (previewIndex.get(a.id) ?? 0) - (previewIndex.get(b.id) ?? 0)
            );
          });
          let changed = false;
          sorted.forEach((n, i) => {
            if (childOrder.get(n.id) !== i) {
              changed = true;
              childOrder.set(n.id, i);
            }
          });
          return changed;
        }),
    )
      .then((flags) => {
        if (flags.some(Boolean)) buildFlow();
      })
      .catch(() => {});

    return () => {
      alive = false;
      elk.terminateWorker();
    };
  }, [
    layout,
    panels,
    displayGraph,
    nodeClassifications,
    state.home.services,
    graph.categories,
    graph.zones,
    size.width,
    viewMode,
    perspective,
    group,
    categoryFilter,
    showContrast,
    power,
  ]);

  // Only update thin SVG leader lines on 3D camera orbit — cards never move!
  useEffect(() => {
    let alive = true;
    const updateLeaders = () => {
      const current = scene.current;
      if (!current || !alive) return;
      const nextLeaders: Leader[] = [];
      for (const item of layout.placed) {
        const { panel, x, y, w, side } = item;
        if (panel.remote || !panel.placed) continue;
        const anchor = current.project(panel.point);
        if (!anchor.visible) continue;
        const ax = Math.max(8, Math.min(size.width - 8, anchor.x));
        const ay = Math.max(
          layout.stageInsets.top - 6,
          Math.min(size.height - 20, anchor.y),
        );
        const px =
          side === "left"
            ? x + w
            : side === "right"
              ? x
              : side === "bottom"
                ? x + w / 2
                : x + w / 2 <= ax
                  ? x + w
                  : x;
        const py = side === "bottom" ? y : y + 20;
        nextLeaders.push({
          id: panel.id,
          x: ax,
          y: ay,
          px,
          py,
          color: panel.color,
          label: panel.label,
        });
      }
      setLeaders(nextLeaders);
    };
    const host = scene.current?.host;
    host?.addEventListener("scene-frame", updateLeaders);
    updateLeaders();
    return () => {
      alive = false;
      host?.removeEventListener("scene-frame", updateLeaders);
    };
  }, [layout, size.width, size.height, scene]);

  // Render cyber room blueprint pads/outlines and physical anchor beacons for local machines.
  useEffect(() => {
    const current = scene.current;
    if (!current) return;
    const beaconRoot = new THREE.Group();
    current.scene.add(beaconRoot);
    for (const room of state.home.rooms.filter((r) => r.kind === "room")) {
      const [rw, rd] = room.size;
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(rw, rd),
        new THREE.MeshBasicMaterial({
          color: "#0e222d",
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(room.origin[0], room.origin[1] + 0.008, room.origin[2]);
      beaconRoot.add(pad);

      const frameGeo = new THREE.EdgesGeometry(
        new THREE.BoxGeometry(rw, 0.02, rd),
      );
      const frame = new THREE.LineSegments(
        frameGeo,
        new THREE.LineBasicMaterial({
          color: "#4ebbd0",
          transparent: true,
          opacity: 0.52,
        }),
      );
      frame.position.set(
        room.origin[0],
        room.origin[1] + 0.015,
        room.origin[2],
      );
      beaconRoot.add(frame);
    }
    for (const panel of panels.filter((p) => !p.remote && p.placed)) {
      const anchor = new THREE.Group();
      anchor.position.set(...panel.point);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.14, 0.19, 32),
        new THREE.MeshBasicMaterial({
          color: panel.color,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      anchor.add(ring);
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 16, 12),
        new THREE.MeshBasicMaterial({ color: panel.color }),
      );
      dot.position.y = 0.08;
      anchor.add(dot);
      beaconRoot.add(anchor);
    }
    current.invalidate();
    return () => {
      current.scene.remove(beaconRoot);
      beaconRoot.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            m.dispose();
        }
      });
      current.invalidate();
    };
  }, [panels, state.home.rooms, scene]);

  const openIconLibrary = async (forNode?: CyberGraph["nodes"][number]) => {
    setIconLibraryOpen(true);
    setIconMsg("");
    if (forNode) {
      setTargetIconNodeId(forNode.id);
    } else if (
      (!targetIconNodeId ||
        !graph.nodes.some((n) => n.id === targetIconNodeId)) &&
      graph.nodes.length
    ) {
      setTargetIconNodeId(graph.nodes[0].id);
    }
    try {
      setIconCatalog(await request<IconsCatalogResponse>("/icons"));
    } catch (e) {
      setIconMsg((e as Error).message);
    }
  };

  const assignIconToNode = async (iconRef: string) => {
    const node = graph.nodes.find((n) => n.id === targetIconNodeId);
    if (!node) {
      setIconMsg("请先选择一个节点，再点击图标应用。");
      return;
    }
    setIconBusy(true);
    setIconMsg("");
    try {
      if (state.home.cyber || !node.serviceId) {
        await mutate({
          type: "cyber.node.upsert",
          node: { ...node, icon: iconRef },
        });
      }
      if (node.serviceId) {
        const svc = state.home.services.find((s) => s.id === node.serviceId);
        if (svc) {
          await mutate({
            type: "service.upsert",
            service: { ...svc, icon: iconRef },
          });
        }
      }
      setIconMsg(`已将图标绑定到「${node.label}」。`);
    } catch (e) {
      setIconMsg((e as Error).message);
    } finally {
      setIconBusy(false);
    }
  };

  const visibleHosts = nodes.filter((n) => n.type === "host").length;
  const activeFocusLabel = [
    power ? "供电" : group || categoryFilter ? "" : "全量拓扑",
    group
      ? (resolvedTopologies.find((t) => t.id === group)?.label ?? group)
      : "",
    categoryFilter
      ? (resolvedCategories.find((c) => c.id === categoryFilter)?.label ??
        categoryFilter)
      : "",
    hostFilter
      ? (state.home.entities.find((e) => e.id === hostFilter)?.name ??
        hostFilter)
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <CyberInteractionContext.Provider value={interactionValue}>
      <div
        className="cyber-overlay"
        ref={layer}
        data-panels={visibleHosts}
        data-edges={
          perspective === "topology" ? filtered.edges.length : edges.length
        }
        data-layout-width={layoutWidth}
        data-view-mode={renderedViewMode}
        data-perspective={perspective}
      >
        <svg
          className="cyber-marker-defs"
          width="0"
          height="0"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="cyber-arrow-base"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#74a5b5" />
            </marker>
            <marker
              id="cyber-arrow-active"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#87e8de" />
            </marker>
            <marker
              id="cyber-arrow-group"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#7bd8cf" />
            </marker>
            <marker
              id="cyber-arrow-power"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M 1 2 L 8 5 L 1 8 z" fill="#e0be7b" />
            </marker>
          </defs>
        </svg>
        {perspective === "machine" && skyBand && (
          <div
            className="cyber-sky-band"
            style={{ top: skyBand.top, height: skyBand.bottom - skyBand.top }}
            aria-hidden="true"
          />
        )}
        <div className="cyber-chrome" ref={chromeRef}>
          <div className="world-toolbar cyber-toolbar">
            <button onClick={onClose}>← 生活空间</button>
            <div>
              <strong>赛博视图</strong>
              <small>
                {graph.source}
                {graph.asOf
                  ? ` · ${new Date(graph.asOf).toLocaleString()}`
                  : ""}{" "}
                · 路径示意
              </small>
            </div>
            <div className="cyber-toolbar-actions">
              {perspective === "machine" && (
                <div
                  className="cyber-zoom-actions"
                  role="group"
                  aria-label="视角缩放"
                >
                  <button
                    type="button"
                    className="cyber-zoom-btn"
                    aria-label="缩小视角"
                    title="缩小视角"
                    onClick={() => scene.current?.zoom(1 / 1.35)}
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    type="button"
                    className="cyber-zoom-btn"
                    aria-label="放大视角"
                    title="放大视角"
                    onClick={() => scene.current?.zoom(1.35)}
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    type="button"
                    className="cyber-zoom-btn"
                    aria-label="重置视角"
                    title="重置视角"
                    onClick={() => {
                      onSelectEntity?.(undefined);
                      scene.current?.reset();
                      scene.current?.setCyber(true, layout.stageInsets);
                    }}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              )}
              <div
                className="cyber-view-toggle cyber-perspective-toggle"
                role="group"
                aria-label="主视角切换"
              >
                <button
                  type="button"
                  className={perspective === "machine" ? "active" : ""}
                  aria-label="机器视角"
                  aria-pressed={perspective === "machine"}
                  title="以物理机器为主体，以逻辑连线为虚拟"
                  onClick={() => switchPerspective("machine")}
                >
                  <Cpu size={13} />
                  <span>机器为实</span>
                </button>
                <button
                  type="button"
                  className={perspective === "topology" ? "active" : ""}
                  aria-label="拓扑视角"
                  aria-pressed={perspective === "topology"}
                  title="以逻辑拓扑与隔离域为主体，机器退为虚拟标签"
                  onClick={() => switchPerspective("topology")}
                >
                  <Network size={13} />
                  <span>拓扑为实</span>
                </button>
              </div>
              {perspective === "machine" && (
                <div
                  className="cyber-view-toggle"
                  role="group"
                  aria-label="服务展示方式"
                >
                  <button
                    type="button"
                    className={viewMode === "grid" ? "active" : ""}
                    aria-label="网格视图"
                    aria-pressed={viewMode === "grid"}
                    title="Dashy 网格图标视图"
                    onClick={() => switchViewMode("grid")}
                  >
                    <LayoutGrid size={13} />
                    <span>网格</span>
                  </button>
                  <button
                    type="button"
                    className={viewMode === "list" ? "active" : ""}
                    aria-label="列表视图"
                    aria-pressed={viewMode === "list"}
                    title="Dashy 列表图标视图"
                    onClick={() => switchViewMode("list")}
                  >
                    <List size={13} />
                    <span>列表</span>
                  </button>
                </div>
              )}
              <button type="button" onClick={() => setTaxonomyOpen(true)}>
                <SlidersHorizontal size={13} />
                <span>域与分类</span>
              </button>
              <button type="button" onClick={() => void openIconLibrary()}>
                <Images size={13} />
                <span>图标库</span>
              </button>
              <button
                onClick={() => {
                  setInput(JSON.stringify(baseGraph, null, 2));
                  setError("");
                  setImporting(true);
                }}
              >
                导入 HomeLab 图
              </button>
              <button onClick={onExample}>示例小世界</button>
            </div>
          </div>
          <div className="cyber-subbar">
            <div className="cyber-filters">
              <button
                className={!group && !categoryFilter && !power ? "active" : ""}
                onClick={() => {
                  setPower(false);
                  setGroup("");
                  setCategoryFilter("");
                  setHostFilter("");
                  setContrastOutside(false);
                }}
              >
                全部关系
              </button>
              {Boolean(state.home.electricalCircuits?.length) && (
                <button
                  className={power ? "active" : ""}
                  onClick={() => {
                    setPower(true);
                    setGroup("");
                    setCategoryFilter("");
                    setHostFilter("");
                  }}
                >
                  供电
                </button>
              )}
              {resolvedTopologies.map((topo) => (
                <button
                  className={!power && group === topo.id ? "active" : ""}
                  key={topo.id}
                  title={topo.description}
                  onClick={() => {
                    setPower(false);
                    setGroup(topo.id);
                    setHostFilter("");
                  }}
                >
                  {topo.label}
                </button>
              ))}
            </div>
            <div className="cyber-host-picker">
              {perspective === "machine" && (group || categoryFilter) && (
                <button
                  type="button"
                  className={`cyber-contrast-btn ${contrastOutside ? "active" : ""}`}
                  aria-pressed={contrastOutside}
                  title="保留拓扑外主机与服务并淡化对照"
                  onClick={() => setContrastOutside((v) => !v)}
                >
                  对比拓扑外
                </button>
              )}
              <select
                aria-label="职能分类"
                value={categoryFilter}
                onChange={(e) => {
                  setPower(false);
                  setCategoryFilter(e.target.value as ServiceCategory | "");
                }}
              >
                <option value="">全部分类</option>
                {resolvedCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="聚焦主机"
                value={hostFilter}
                onChange={(e) => setHostFilter(e.target.value)}
              >
                <option value="">全部主机</option>
                {[
                  ...new Set([
                    ...graph.nodes.map((n) => n.host ?? "__external"),
                    ...(!power
                      ? state.home.entities
                          .filter(
                            (e) =>
                              e.category === "host" && e.lifecycle === "active",
                          )
                          .map((e) => e.id)
                      : []),
                  ]),
                ].map((id) => (
                  <option value={id} key={id}>
                    {state.home.entities.find((e) => e.id === id)?.name ??
                      "外部服务"}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {perspective === "machine" ? (
          <>
            <svg className="cyber-leaders" aria-hidden="true">
              {leaders.map((l) => {
                const leaderFocus = hoveredHost ?? selectedHostId;
                const highlighted = leaderFocus === l.id;
                const dimmed = Boolean(leaderFocus && !highlighted);
                const isVertical =
                  Math.abs(l.y - l.py) > Math.abs(l.x - l.px) * 1.4;
                const midX = (l.px + l.x) / 2;
                const midY = (l.py + l.y) / 2;
                const d = isVertical
                  ? `M ${l.px} ${l.py} C ${l.px} ${midY}, ${l.x} ${midY}, ${l.x} ${l.y}`
                  : `M ${l.px} ${l.py} C ${midX} ${l.py}, ${midX} ${l.y}, ${l.x} ${l.y}`;
                return (
                  <g key={l.id}>
                    <path
                      d={d}
                      stroke={l.color}
                      strokeOpacity={highlighted ? 0.95 : dimmed ? 0.12 : 0.42}
                      strokeDasharray="2 3"
                      fill="none"
                      strokeWidth={highlighted ? 1.9 : 1.1}
                    />
                    <circle
                      cx={l.x}
                      cy={l.y}
                      r={highlighted ? 5.5 : 3.5}
                      fill={l.color}
                      fillOpacity={highlighted ? 0.95 : dimmed ? 0.18 : 0.5}
                      stroke={l.color}
                      strokeOpacity={dimmed ? 0.25 : 0.9}
                    />
                  </g>
                );
              })}
            </svg>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              panOnDrag={false}
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              preventScrolling={false}
              minZoom={1}
              maxZoom={1}
              viewport={{ x: 0, y: 0, zoom: 1 }}
              onNodeMouseEnter={(_, n) => {
                const id = n.data.hostId ? String(n.data.hostId) : undefined;
                if (id) setHoveredHost(id);
                setHoveredServiceNode(
                  n.type === "service" && n.data.nodeId
                    ? String(n.data.nodeId)
                    : undefined,
                );
              }}
              onNodeMouseLeave={() => {
                setHoveredHost(undefined);
                setHoveredServiceNode(undefined);
              }}
              onEdgeMouseEnter={(_, e) => setHoveredEdge(e.id)}
              onEdgeMouseLeave={() => setHoveredEdge(undefined)}
              onNodeClick={(_, n) => {
                if (n.type === "host" && n.data.hostId) {
                  setHostDetails(String(n.data.hostId));
                  return;
                }
                if (n.type !== "service") return;
                if (n.data.more) {
                  setHostDetails(String(n.data.more));
                  return;
                }
                const node = graph.nodes.find((g) => g.id === n.data.nodeId);
                if (node) setChosen(node);
              }}
            />
            <div className="cyber-legend">
              <span>
                <Cloud size={12} /> 上方：云端 / 外部服务
              </span>
              <span>
                <Server size={12} /> 细线：机器物理锚点
              </span>
              <span>
                <ArrowRight size={12} />{" "}
                {power
                  ? "已记录的供电连接"
                  : "已记录的数据路径（悬停查看协议）"}
              </span>
              {visibleHosts < panels.length && (
                <span>
                  当前显示 {visibleHosts}/{panels.length} 台 ·
                  用上方主机选择聚焦
                </span>
              )}
              {!graph.edges.length && (
                <span>尚未提供虚拟连接，可导入 HomeLab 图或查看示例</span>
              )}
            </div>
          </>
        ) : (
          <CyberTopologyView
            fullGraph={graph}
            activeGraph={filtered}
            entities={state.home.entities}
            services={state.home.services}
            focusLabel={activeFocusLabel}
            activeGroup={group}
            topOffset={chromeBottom ?? 108}
            power={power}
            onSelectNode={(node) => setChosen(node)}
            onInspectHost={(hostId) => setHostDetails(hostId)}
            onAddToTopology={(node) => {
              if (!group || node.groups.includes(group)) return;
              void mutate({
                type: "cyber.node.upsert",
                node: { ...node, groups: [...node.groups, group] },
              });
            }}
            onConfigureTaxonomy={() => setTaxonomyOpen(true)}
            onResetFilter={() => {
              setPower(false);
              setGroup("");
              setCategoryFilter("");
              setHostFilter("");
            }}
          />
        )}
        {hostDetails &&
          (() => {
            const detailPanel = panels.find((p) => p.id === hostDetails);
            const targetEntity = state.home.entities.find(
              (e) => e.id === hostDetails,
            );
            const cloud = graph.clouds.find((c) => c.host === hostDetails);
            const focusEligible = Boolean(
              onSelectEntity &&
              targetEntity &&
              targetEntity.scope === "home" &&
              eligible(state.home, targetEntity, "devices"),
            );
            return (
              <HostArchitectureFrame
                hostId={hostDetails}
                hostLabel={
                  detailPanel?.label ?? targetEntity?.name ?? "外部服务"
                }
                hostSubtitle={
                  detailPanel?.subtitle ??
                  (cloud ? `${cloud.provider} · ${cloud.region}` : undefined)
                }
                hostColor={detailPanel?.color ?? "#75cdd7"}
                remote={
                  detailPanel?.remote ??
                  (targetEntity?.scope === "remote" ||
                    hostDetails === "__external")
                }
                provider={detailPanel?.provider ?? cloud?.provider}
                assetKind={detailPanel?.assetKind}
                tags={detailPanel?.tags ?? targetEntity?.tags}
                allNodes={graph.nodes}
                allEdges={graph.edges}
                services={state.home.services}
                entities={state.home.entities}
                categories={graph.categories}
                zones={graph.zones}
                onSelectNode={(node) => setChosen(node)}
                onFocus3d={
                  focusEligible && targetEntity
                    ? () => {
                        setHostDetails(undefined);
                        onSelectEntity?.(targetEntity.id);
                      }
                    : undefined
                }
                onClose={() => setHostDetails(undefined)}
              />
            );
          })()}
        {activeChosen && (
          <CyberNodeDialog
            node={activeChosen}
            graph={graph}
            state={state}
            classification={nodeClassifications.get(activeChosen.id)}
            classifications={nodeClassifications}
            categories={resolvedCategories}
            topologies={resolvedTopologies}
            onClose={() => setChosen(undefined)}
            onOpenService={(serviceId) => onService(serviceId)}
            onBindIcon={(node) => void openIconLibrary(node)}
            mutate={mutate}
          />
        )}
        {taxonomyOpen && (
          <CyberTaxonomyDialog
            graph={graph}
            state={state}
            categories={resolvedCategories}
            topologies={resolvedTopologies}
            mutate={mutate}
            onClose={() => setTaxonomyOpen(false)}
          />
        )}
        {iconLibraryOpen && (
          <WorldDialog
            title="服务图标与本地图片资源库"
            onClose={() => setIconLibraryOpen(false)}
            busy={iconBusy}
          >
            <p className="muted">
              内置图标位于本地服务静态资源；自定义上传图标独立保存于{" "}
              <code>data/icon-library/</code> 并通过{" "}
              <code>/api/icons/&lt;sha256&gt;</code> 引用。
            </p>
            <div className="cyber-icon-upload">
              <label className="field">
                图标名称（可选）
                <input
                  value={iconUploadName}
                  onChange={(e) => setIconUploadName(e.target.value)}
                  placeholder="例如：Immich / Jellyfin"
                />
              </label>
              <label className="cyber-upload-btn">
                <Upload size={14} />
                <span>上传图片到独立资源库（PNG/SVG/WebP/JPG）</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setIconBusy(true);
                    setIconMsg("");
                    try {
                      const form = new FormData();
                      form.append("image", file, file.name);
                      if (iconUploadName.trim()) {
                        form.append("name", iconUploadName.trim());
                      }
                      const created = await request<IconLibraryEntry>(
                        "/icons",
                        form,
                      );
                      setIconUploadName("");
                      setIconCatalog(
                        await request<IconsCatalogResponse>("/icons"),
                      );
                      setIconMsg(`已保存「${created.name}」：${created.url}`);
                    } catch (err) {
                      setIconMsg((err as Error).message);
                    } finally {
                      setIconBusy(false);
                    }
                  }}
                />
              </label>
            </div>
            {graph.nodes.length > 0 && (
              <label className="field">
                点击下方图标可直接绑定到组件节点
                <select
                  aria-label="绑定目标节点"
                  value={targetIconNodeId}
                  onChange={(e) => setTargetIconNodeId(e.target.value)}
                >
                  {graph.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label} ({n.host ?? "外部"} · {n.id})
                    </option>
                  ))}
                </select>
              </label>
            )}
            {iconMsg && (
              <p className="notice" role="status">
                {iconMsg}
              </p>
            )}
            <div className="cyber-icon-section">
              <strong>
                本地独立图片资源库 ({iconCatalog?.library.length ?? 0})
              </strong>
              {iconCatalog?.library.length ? (
                <div className="cyber-icon-grid">
                  {iconCatalog.library.map((item) => {
                    const targetNode = graph.nodes.find(
                      (n) => n.id === targetIconNodeId,
                    );
                    const targetSvc = targetNode?.serviceId
                      ? state.home.services.find(
                          (s) => s.id === targetNode.serviceId,
                        )
                      : undefined;
                    const active =
                      (targetNode?.icon ?? targetSvc?.icon) === item.url;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        className={`cyber-icon-pick ${active ? "active" : ""}`}
                        title={`${item.name} · ${item.url}`}
                        onClick={() => void assignIconToNode(item.url)}
                      >
                        <img src={item.url} alt="" width={26} height={26} />
                        <span>{item.name}</span>
                        {active && (
                          <Check size={12} className="cyber-icon-ok" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="muted">暂未上传自定义图标图片。</p>
              )}
            </div>
            <div className="cyber-icon-section">
              <strong>
                内置服务图标库 (
                {(iconCatalog?.builtin ?? builtinServiceIcons).length})
              </strong>
              <div className="cyber-icon-grid">
                {(iconCatalog?.builtin ?? builtinServiceIcons).map((item) => {
                  const targetNode = graph.nodes.find(
                    (n) => n.id === targetIconNodeId,
                  );
                  const targetSvc = targetNode?.serviceId
                    ? state.home.services.find(
                        (s) => s.id === targetNode.serviceId,
                      )
                    : undefined;
                  const active =
                    (targetNode?.icon ?? targetSvc?.icon) === item.key;
                  return (
                    <button
                      type="button"
                      key={item.key}
                      className={`cyber-icon-pick ${active ? "active" : ""}`}
                      title={`${item.name} · key: ${item.key}`}
                      onClick={() => void assignIconToNode(item.key)}
                    >
                      <img src={item.url} alt="" width={26} height={26} />
                      <span>{item.name}</span>
                      {active && <Check size={12} className="cyber-icon-ok" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </WorldDialog>
        )}
        {importing && (
          <WorldDialog
            title="导入 HomeLab 关系图"
            onClose={() => setImporting(false)}
            busy={busy}
          >
            <p className="muted">
              提供 nodes、edges、分组及主机 ID，平台自动布局。仅更新关系图。
            </p>
            <label className="field">
              读取 JSON 文件
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    if (f.size > 2 * 1024 * 1024) {
                      setError("文件最多 2 MiB。");
                      return;
                    }
                    setInput(await f.text());
                  }
                }}
              />
            </label>
            <label className="field">
              关系图 JSON
              <textarea
                rows={12}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder='{"version":1,"source":"homelab","asOf":"...","nodes":[],"edges":[]}'
              />
            </label>
            {error && (
              <p className="notice" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const parsed = cyberSchema.parse(JSON.parse(input));
                  await mutate({ type: "cyber.replace", graph: parsed });
                  setImporting(false);
                  setPower(false);
                  setGroup("");
                  setCategoryFilter("");
                  setHostFilter("");
                  setContrastOutside(false);
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              校验并保存关系图
            </button>
          </WorldDialog>
        )}
      </div>
    </CyberInteractionContext.Provider>
  );
}
