import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Code2,
  Copy,
  Crosshair,
  GitBranch,
  Layers,
  List,
  RefreshCw,
  Shield,
  X,
} from "lucide-react";
import {
  buildHostArchitecture,
  hostArchitectureToMermaid,
  isCyberEdgeQuiet,
  type CyberEdge,
  type CyberNode,
} from "../shared/cyber-arch.js";
import type {
  CyberCategoryDef,
  CyberZoneDef,
  ServiceCategory,
} from "../shared/cyber.js";
import type { Dashboard } from "../shared/domain.js";
import { HostBadgeIcon, ServiceBadgeIcon } from "./service-icon.js";

export {
  buildHostArchitecture,
  hostArchitectureToMermaid,
  orderHostPreviewNodes,
} from "../shared/cyber-arch.js";

type FrameTab = "layers" | "list" | "mermaid";

interface MeasuredNodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  right: number;
  bottom: number;
  tier: number;
  row: number;
  lastRowInTier: boolean;
}

interface TierBounds {
  top: number;
  bottom: number;
}

interface RoutedEdge {
  edge: CyberEdge;
  kind: "dag" | "feedback" | "same-tier" | "self";
  path: string;
  anchorX: number;
  anchorY: number;
  labelX: number;
  labelY: number;
}

interface BusJunctionDot {
  x: number;
  y: number;
  edgeId: string;
  source: string;
  target: string;
}

export interface HostArchitectureFrameProps {
  hostId: string;
  hostLabel: string;
  hostSubtitle?: string;
  hostColor: string;
  remote?: boolean;
  provider?: string;
  assetKind?: string;
  tags?: string[];
  allNodes: CyberNode[];
  allEdges: CyberEdge[];
  services: Dashboard["home"]["services"];
  entities?: Dashboard["home"]["entities"];
  categories?: Record<string, CyberCategoryDef>;
  zones?: CyberZoneDef[];
  onSelectNode: (node: CyberNode) => void;
  onFocus3d?: () => void;
  onClose: () => void;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function spreadOffset(index: number, total: number, step: number): number {
  if (total <= 1) return 0;
  return (index - (total - 1) / 2) * step;
}

function buildRoundedOrthoPath(
  rawPoints: Array<{ x: number; y: number }>,
  radius = 6,
): string {
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of rawPoints) {
    const prev = pts[pts.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > 0.75) {
      pts.push(p);
    }
  }
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
  if (pts.length === 2) {
    return `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L ${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`;
  }

  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const d1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const d2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    const r = Math.min(radius, d1 / 2, d2 / 2);
    if (r < 1) {
      d += ` L ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
      continue;
    }
    const ux1 = (curr.x - prev.x) / d1;
    const uy1 = (curr.y - prev.y) / d1;
    const ux2 = (next.x - curr.x) / d2;
    const uy2 = (next.y - curr.y) / d2;
    const p1x = curr.x - ux1 * r;
    const p1y = curr.y - uy1 * r;
    const p2x = curr.x + ux2 * r;
    const p2y = curr.y + uy2 * r;
    d += ` L ${p1x.toFixed(1)} ${p1y.toFixed(1)} Q ${curr.x.toFixed(1)} ${curr.y.toFixed(1)} ${p2x.toFixed(1)} ${p2y.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

function computeArchRoutes(
  dagEdges: CyberEdge[],
  feedbackEdges: CyberEdge[],
  nodeRects: Map<string, MeasuredNodeRect>,
  tierBounds: Map<number, TierBounds>,
  canvasWidth: number,
): { routes: RoutedEdge[]; busDots: BusJunctionDot[] } {
  const routes: RoutedEdge[] = [];
  const busDots: BusJunctionDot[] = [];
  const allInternal = [
    ...dagEdges.map((edge) => ({ edge, isFeedback: false })),
    ...feedbackEdges.map((edge) => ({ edge, isFeedback: true })),
  ];

  const outBySource = new Map<string, CyberEdge[]>();
  const inByTarget = new Map<string, CyberEdge[]>();
  const dagFanoutCount = new Map<string, number>();
  for (const { edge, isFeedback } of allInternal) {
    if (edge.source === edge.target) continue;
    const outs = outBySource.get(edge.source) ?? [];
    outs.push(edge);
    outBySource.set(edge.source, outs);
    const ins = inByTarget.get(edge.target) ?? [];
    ins.push(edge);
    inByTarget.set(edge.target, ins);

    const sr = nodeRects.get(edge.source);
    const tr = nodeRects.get(edge.target);
    if (!isFeedback && sr && tr && sr.tier < tr.tier) {
      const fk = `${edge.source}->${tr.tier}`;
      dagFanoutCount.set(fk, (dagFanoutCount.get(fk) ?? 0) + 1);
    }
  }
  for (const list of outBySource.values()) {
    list.sort(
      (a, b) =>
        (nodeRects.get(a.target)?.cx ?? 0) - (nodeRects.get(b.target)?.cx ?? 0),
    );
  }
  for (const list of inByTarget.values()) {
    list.sort(
      (a, b) =>
        (nodeRects.get(a.source)?.cx ?? 0) - (nodeRects.get(b.source)?.cx ?? 0),
    );
  }

  let feedbackIdx = 0;
  let sameTierIdx = 0;
  let skipTierIdx = 0;
  let selfIdx = 0;

  for (const { edge, isFeedback } of allInternal) {
    const s = nodeRects.get(edge.source);
    const t = nodeRects.get(edge.target);
    if (!s || !t) continue;

    if (edge.source === edge.target) {
      const k = selfIdx++;
      const rx = s.right - 12;
      const ry = s.y;
      const loopR = 14 + (k % 3) * 5;
      const path = `M ${rx.toFixed(1)} ${ry.toFixed(1)} C ${rx.toFixed(1)} ${(ry - loopR * 1.4).toFixed(1)}, ${(s.right + loopR).toFixed(1)} ${(ry - loopR * 1.4).toFixed(1)}, ${(s.right + loopR).toFixed(1)} ${(ry + loopR * 0.4).toFixed(1)} C ${(s.right + loopR).toFixed(1)} ${(ry + loopR).toFixed(1)}, ${(s.right + 2).toFixed(1)} ${(ry + 10).toFixed(1)}, ${s.right.toFixed(1)} ${(ry + 12).toFixed(1)}`;
      routes.push({
        edge,
        kind: "self",
        path,
        anchorX: s.right + loopR * 0.5,
        anchorY: ry - loopR * 0.8,
        labelX: s.right + loopR + 6,
        labelY: ry - loopR * 0.4,
      });
      continue;
    }

    const sOuts = outBySource.get(edge.source) ?? [edge];
    const tIns = inByTarget.get(edge.target) ?? [edge];
    const outRank = Math.max(
      0,
      sOuts.findIndex((e) => e.id === edge.id),
    );
    const inRank = Math.max(
      0,
      tIns.findIndex((e) => e.id === edge.id),
    );

    if (isFeedback || s.tier > t.tier) {
      const k = feedbackIdx++;
      const laneX = clamp(12 + (k % 4) * 5, 8, Math.max(14, t.x - 12));
      const sy = s.cy + spreadOffset(outRank, sOuts.length, 3);
      const ty = t.cy + spreadOffset(inRank, tIns.length, 3);
      const pts = [
        { x: s.x, y: sy },
        { x: laneX, y: sy },
        { x: laneX, y: ty },
        { x: t.x, y: ty },
      ];
      routes.push({
        edge,
        kind: "feedback",
        path: buildRoundedOrthoPath(pts, 8),
        anchorX: laneX,
        anchorY: (sy + ty) / 2,
        labelX: laneX + 8,
        labelY: clamp(
          (sy + ty) / 2,
          Math.min(sy, ty) + 10,
          Math.max(sy, ty) - 10,
        ),
      });
      continue;
    }

    if (s.tier === t.tier) {
      const k = sameTierIdx++;
      const gapY = Math.min(s.y, t.y) - 8 - (k % 3) * 3;
      const sx = s.cx + spreadOffset(outRank, sOuts.length, 4);
      const tx = t.cx + spreadOffset(inRank, tIns.length, 4);
      const pts = [
        { x: sx, y: s.y },
        { x: sx, y: gapY },
        { x: tx, y: gapY },
        { x: tx, y: t.y },
      ];
      routes.push({
        edge,
        kind: "same-tier",
        path: buildRoundedOrthoPath(pts, 6),
        anchorX: (sx + tx) / 2,
        anchorY: gapY,
        labelX: (sx + tx) / 2,
        labelY: gapY - 6,
      });
      continue;
    }

    // Group high-fanout downward streams onto a unified horizontal trunk bus without striping.
    const fanoutCount = dagFanoutCount.get(`${edge.source}->${t.tier}`) ?? 1;
    const sharedTrunk = fanoutCount >= 3;
    const sx = sharedTrunk
      ? s.cx
      : s.cx +
        spreadOffset(
          outRank,
          sOuts.length,
          Math.max(4, Math.min(7, (s.w * 0.45) / Math.max(1, sOuts.length))),
        );
    const upperTier = tierBounds.get(s.tier);
    const nextTier = tierBounds.get(s.tier + 1);
    const busSpread = sharedTrunk
      ? 0
      : spreadOffset(
          outRank,
          sOuts.length,
          Math.min(1.8, 8 / Math.max(1, sOuts.length)),
        );
    const firstBusY =
      upperTier && nextTier
        ? (upperTier.bottom + nextTier.top) / 2 + busSpread
        : s.bottom + 9;

    const pts: Array<{ x: number; y: number }> = [{ x: sx, y: s.bottom }];
    if (!s.lastRowInTier) {
      const rowDropY = s.bottom + 5;
      const rightGutterX = s.right + 7;
      pts.push(
        { x: sx, y: rowDropY },
        { x: rightGutterX, y: rowDropY },
        { x: rightGutterX, y: firstBusY },
      );
    } else {
      pts.push({ x: sx, y: firstBusY });
    }

    const prevTier = tierBounds.get(t.tier - 1);
    const targetTier = tierBounds.get(t.tier);
    let targetBusY =
      t.tier === s.tier + 1
        ? firstBusY
        : prevTier && targetTier
          ? (prevTier.bottom + targetTier.top) / 2
          : t.y - 10;

    if (t.tier - s.tier > 1) {
      const k = skipTierIdx++;
      const rightLaneX = Math.max(s.right + 10, canvasWidth - 10 - (k % 3) * 4);
      pts.push(
        { x: rightLaneX, y: firstBusY },
        { x: rightLaneX, y: targetBusY },
      );
    }

    if (t.row === 0) {
      const tx =
        t.cx +
        spreadOffset(
          inRank,
          tIns.length,
          Math.min(7, (t.w * 0.36) / Math.max(1, tIns.length)),
        );
      pts.push({ x: tx, y: targetBusY }, { x: tx, y: t.y });
      if (sharedTrunk && Math.abs(tx - sx) > 8) {
        busDots.push({
          x: tx,
          y: targetBusY,
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        });
      }
      routes.push({
        edge,
        kind: "dag",
        path: buildRoundedOrthoPath(pts, sharedTrunk ? 3 : 6),
        anchorX: tx,
        anchorY: (targetBusY + t.y) / 2,
        labelX: tx,
        labelY: targetBusY - 5,
      });
    } else {
      const gutterX = t.x - 8 - (inRank % 3) * 2;
      const ty = t.cy + spreadOffset(inRank, tIns.length, 4);
      if (sharedTrunk) {
        busDots.push({
          x: gutterX,
          y: targetBusY,
          edgeId: edge.id,
          source: edge.source,
          target: edge.target,
        });
      }
      pts.push(
        { x: gutterX, y: targetBusY },
        { x: gutterX, y: ty },
        { x: t.x, y: ty },
      );
      routes.push({
        edge,
        kind: "dag",
        path: buildRoundedOrthoPath(pts, sharedTrunk ? 3 : 5),
        anchorX: gutterX,
        anchorY: ty,
        labelX: clamp(t.x - 6, 48, canvasWidth - 48),
        labelY: ty - 12,
      });
    }
  }

  return { routes, busDots };
}

export function HostArchitectureFrame({
  hostId,
  hostLabel,
  hostSubtitle,
  hostColor,
  remote,
  provider,
  assetKind,
  tags,
  allNodes,
  allEdges,
  services,
  entities,
  categories,
  zones,
  onSelectNode,
  onFocus3d,
  onClose,
}: HostArchitectureFrameProps) {
  const [tab, setTab] = useState<FrameTab>("layers");
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | "">(
    "",
  );
  const [hoveredNodeId, setHoveredNodeId] = useState<string>();
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>();
  const [copiedMermaid, setCopiedMermaid] = useState(false);

  const canvasRef = useRef<HTMLDivElement>(null);
  const tierRefs = useRef(new Map<string, HTMLElement>());
  const nodeRefs = useRef(new Map<string, HTMLButtonElement>());
  const [svgSize, setSvgSize] = useState({ width: 0, height: 0 });
  const [routeResult, setRouteResult] = useState<{
    routes: RoutedEdge[];
    busDots: BusJunctionDot[];
    nodeRects: Map<string, MeasuredNodeRect>;
  }>({ routes: [], busDots: [], nodeRects: new Map() });
  const routes = routeResult.routes;
  const busDots = routeResult.busDots;
  const nodeRects = routeResult.nodeRects;

  const arch = useMemo(
    () =>
      buildHostArchitecture(hostId, allNodes, allEdges, services, {
        categories,
        zones,
      }),
    [hostId, allNodes, allEdges, services, categories, zones],
  );
  const quietEdgeIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of arch.internalEdges) {
      if (isCyberEdgeQuiet(e, arch.classifications)) set.add(e.id);
    }
    return set;
  }, [arch]);

  const mermaidSource = useMemo(
    () => hostArchitectureToMermaid(hostLabel, arch),
    [hostLabel, arch],
  );

  const serviceById = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  const entityNameById = useMemo(
    () => new Map((entities ?? []).map((e) => [e.id, e.name])),
    [entities],
  );
  const nodeById = useMemo(
    () => new Map(arch.nodes.map((n) => [n.id, n])),
    [arch.nodes],
  );

  const presentCategories = useMemo(() => {
    const counts = new Map<ServiceCategory, number>();
    for (const node of arch.nodes) {
      const cat = arch.classifications.get(node.id)?.category;
      if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return arch.categories
      .filter((c) => (counts.get(c.id) ?? 0) > 0)
      .map((c) => ({ ...c, count: counts.get(c.id) ?? 0 }));
  }, [arch]);

  const internalRelations = useMemo(() => {
    const byNode = new Map<
      string,
      {
        incoming: CyberEdge[];
        outgoing: CyberEdge[];
        feedback: CyberEdge[];
      }
    >();
    for (const node of arch.nodes) {
      byNode.set(node.id, { incoming: [], outgoing: [], feedback: [] });
    }
    const fbIds = new Set(arch.feedbackEdges.map((e) => e.id));
    for (const edge of arch.internalEdges) {
      byNode.get(edge.source)?.outgoing.push(edge);
      byNode.get(edge.target)?.incoming.push(edge);
      if (fbIds.has(edge.id)) {
        byNode.get(edge.source)?.feedback.push(edge);
        byNode.get(edge.target)?.feedback.push(edge);
      }
    }
    return byNode;
  }, [arch]);

  const activeNodeSet = useMemo(() => {
    const active = new Set<string>();
    if (hoveredNodeId) {
      active.add(hoveredNodeId);
      for (const e of arch.internalEdges) {
        if (e.source === hoveredNodeId) active.add(e.target);
        if (e.target === hoveredNodeId) active.add(e.source);
      }
    } else if (hoveredEdgeId) {
      const edge = arch.internalEdges.find((e) => e.id === hoveredEdgeId);
      if (edge) {
        active.add(edge.source);
        active.add(edge.target);
      }
    } else if (categoryFilter) {
      for (const n of arch.nodes) {
        if (arch.classifications.get(n.id)?.category === categoryFilter) {
          active.add(n.id);
        }
      }
    }
    return active;
  }, [hoveredNodeId, hoveredEdgeId, categoryFilter, arch]);

  const interiorTiers = arch.tiers.filter((t) => !t.isBoundary);
  const topBoundaryNodes = (arch.boundaryTier?.nodes ?? []).filter(
    (n) => arch.classifications.get(n.id)?.boundaryRole !== "egress",
  );
  const bottomBoundaryNodes = (arch.boundaryTier?.nodes ?? []).filter(
    (n) => arch.classifications.get(n.id)?.boundaryRole === "egress",
  );

  const visualTiers = useMemo(() => {
    const slots: Array<{ key: string; nodes: CyberNode[] }> = [];
    if (topBoundaryNodes.length > 0) {
      slots.push({ key: "tier-boundary-top", nodes: topBoundaryNodes });
    }
    for (const tier of interiorTiers) {
      slots.push({ key: tier.id, nodes: tier.nodes });
    }
    if (bottomBoundaryNodes.length > 0) {
      slots.push({ key: "tier-boundary-bottom", nodes: bottomBoundaryNodes });
    }
    return slots;
  }, [topBoundaryNodes, interiorTiers, bottomBoundaryNodes]);

  const measureAndRoute = useCallback(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl || tab !== "layers") return;

    const cRect = canvasEl.getBoundingClientRect();
    if (cRect.width <= 0 || cRect.height <= 0) return;

    const tierBounds = new Map<number, TierBounds>();
    const nodeRects = new Map<string, MeasuredNodeRect>();

    visualTiers.forEach((slot, tierIndex) => {
      const tierEl = tierRefs.current.get(slot.key);
      if (tierEl) {
        const tRect = tierEl.getBoundingClientRect();
        tierBounds.set(tierIndex, {
          top: tRect.top - cRect.top,
          bottom: tRect.bottom - cRect.top,
        });
      }

      const boxes: Array<{
        id: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }> = [];
      for (const node of slot.nodes) {
        const btn = nodeRefs.current.get(node.id);
        if (!btn) continue;
        const nRect = btn.getBoundingClientRect();
        boxes.push({
          id: node.id,
          x: nRect.left - cRect.left,
          y: nRect.top - cRect.top,
          w: nRect.width,
          h: nRect.height,
        });
      }

      const rowCenters: number[] = [];
      for (const b of boxes) {
        const existing = rowCenters.findIndex((ry) => Math.abs(ry - b.y) < 12);
        if (existing === -1) rowCenters.push(b.y);
      }
      rowCenters.sort((a, b) => a - b);

      const maxRow = Math.max(0, rowCenters.length - 1);
      for (const b of boxes) {
        let row = 0;
        let bestDist = Infinity;
        rowCenters.forEach((ry, idx) => {
          const dist = Math.abs(ry - b.y);
          if (dist < bestDist) {
            bestDist = dist;
            row = idx;
          }
        });
        nodeRects.set(b.id, {
          ...b,
          cx: b.x + b.w / 2,
          cy: b.y + b.h / 2,
          right: b.x + b.w,
          bottom: b.y + b.h,
          tier: tierIndex,
          row,
          lastRowInTier: row === maxRow,
        });
      }
    });

    setSvgSize({
      width: Math.ceil(cRect.width),
      height: Math.ceil(cRect.height),
    });
    const computed = computeArchRoutes(
      arch.dagEdges,
      arch.feedbackEdges,
      nodeRects,
      tierBounds,
      cRect.width,
    );
    setRouteResult({
      ...computed,
      nodeRects,
    });
  }, [visualTiers, arch.dagEdges, arch.feedbackEdges, tab]);

  useEffect(() => {
    if (tab !== "layers") return;
    let raf = requestAnimationFrame(() => measureAndRoute());
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => measureAndRoute());
          })
        : undefined;
    if (ro && canvasRef.current) ro.observe(canvasRef.current);
    const onResize = () => measureAndRoute();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [measureAndRoute, tab]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector(".world-dialog-backdrop")
      ) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const handleCopyMermaid = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(mermaidSource);
      setCopiedMermaid(true);
      window.setTimeout(() => setCopiedMermaid(false), 1800);
    } catch {
      setCopiedMermaid(false);
    }
  }, [mermaidSource]);

  const inboundCross = arch.crossLinks.filter(
    (link) => link.direction === "inbound",
  );
  const outboundCross = arch.crossLinks.filter(
    (link) => link.direction === "outbound",
  );
  const hoveredEdgeRoute = hoveredEdgeId
    ? routes.find((r) => r.edge.id === hoveredEdgeId)
    : undefined;
  const isHighlighting = Boolean(
    hoveredNodeId || hoveredEdgeId || categoryFilter,
  );
  const hoveredCompactNode =
    hoveredNodeId && !hoveredEdgeId
      ? (() => {
          const node = nodeById.get(hoveredNodeId);
          const cls = arch.classifications.get(hoveredNodeId);
          const rect = nodeRects.get(hoveredNodeId);
          if (!node || !cls || !rect || cls.size === "large") return undefined;
          return { node, cls, rect };
        })()
      : undefined;

  const renderNodeCard = (node: CyberNode, onPerimeter = false) => {
    const svc = node.serviceId ? serviceById.get(node.serviceId) : undefined;
    const cls = arch.classifications.get(node.id)!;
    const size = cls.size;
    const isLarge = size === "large";
    const isMedium = size === "medium";
    const isSmall = size === "small";
    const rel = internalRelations.get(node.id);
    const inCount = rel?.incoming.length ?? 0;
    const outCount = rel?.outgoing.length ?? 0;
    const active = hoveredNodeId === node.id || activeNodeSet.has(node.id);
    const dimmed = isHighlighting && !active;

    let relBadge: string | undefined;
    if (hoveredNodeId && hoveredNodeId !== node.id) {
      const outEdge = arch.internalEdges.find(
        (e) => e.source === hoveredNodeId && e.target === node.id,
      );
      const inEdge = arch.internalEdges.find(
        (e) => e.target === hoveredNodeId && e.source === node.id,
      );
      if (outEdge) relBadge = `← ${outEdge.label || "被调用"}`;
      else if (inEdge) relBadge = `→ ${inEdge.label || "调用"}`;
    }

    return (
      <button
        key={node.id}
        type="button"
        data-arch-node={node.id}
        data-arch-layer={cls.layer}
        data-arch-category={cls.category}
        data-arch-size={size}
        aria-label={
          isSmall ? `${node.label} (${cls.categoryMeta.label})` : undefined
        }
        title={`${node.label} · ${cls.categoryMeta.label}`}
        ref={(el) => {
          if (el) nodeRefs.current.set(node.id, el);
          else nodeRefs.current.delete(node.id);
        }}
        style={
          isLarge ? { borderLeftColor: cls.categoryMeta.color } : undefined
        }
        className={[
          "cyber-arch-node",
          `is-size-${size}`,
          `is-kind-${node.kind}`,
          onPerimeter ? "is-perimeter-node" : "",
          active ? "is-active" : "",
          dimmed ? "is-dimmed" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        onMouseEnter={() => setHoveredNodeId(node.id)}
        onMouseLeave={() => setHoveredNodeId(undefined)}
        onFocus={() => setHoveredNodeId(node.id)}
        onBlur={() => setHoveredNodeId(undefined)}
        onClick={() => onSelectNode(node)}
      >
        <div className="cyber-arch-node-main">
          <ServiceBadgeIcon
            icon={node.icon ?? svc?.icon}
            serviceId={svc?.id ?? node.serviceId}
            label={node.label}
            kind={node.kind}
            size={isMedium ? (onPerimeter ? 18 : 20) : 16}
          />
          {!isSmall && (
            <div className="cyber-arch-node-text">
              <strong>{node.label}</strong>
            </div>
          )}
          {isLarge && cls.boundaryMeta && (
            <span
              className={`cyber-boundary-gate is-${cls.boundaryMeta.id}`}
              style={{ borderColor: cls.boundaryMeta.color }}
            >
              {cls.boundaryMeta.label}
            </span>
          )}
        </div>
        {isLarge &&
          (relBadge ||
            inCount > 0 ||
            outCount > 0 ||
            rel?.feedback.some((f) => f.source === node.id) ||
            !onPerimeter) && (
            <div className="cyber-arch-node-meta">
              {relBadge ? (
                <span className="cyber-arch-rel-pill">{relBadge}</span>
              ) : (
                <>
                  <span className="cyber-arch-cat-tag">
                    <i style={{ background: cls.categoryMeta.color }} />
                    {cls.categoryMeta.shortLabel}
                  </span>
                  {(inCount > 0 || outCount > 0) && (
                    <span className="cyber-arch-deg-tag" title="机内入度/出度">
                      {inCount > 0 ? `入${inCount}` : ""}
                      {inCount > 0 && outCount > 0 ? "·" : ""}
                      {outCount > 0 ? `出${outCount}` : ""}
                    </span>
                  )}
                  {rel?.feedback.some((f) => f.source === node.id) && (
                    <span
                      className="is-feedback-tag"
                      title="存在指向边界/上游的回环引用"
                    >
                      <RefreshCw size={8} /> 回环
                    </span>
                  )}
                </>
              )}
            </div>
          )}
      </button>
    );
  };

  const renderTierNodes = (tierNodes: CyberNode[]) => {
    const larges = tierNodes.filter(
      (n) => arch.classifications.get(n.id)?.size === "large",
    );
    const mediums = tierNodes.filter(
      (n) => arch.classifications.get(n.id)?.size === "medium",
    );
    const smalls = tierNodes.filter(
      (n) => arch.classifications.get(n.id)?.size === "small",
    );
    return (
      <>
        {larges.length > 0 && (
          <div className="cyber-arch-tier-grid">
            {larges.map((node) => renderNodeCard(node))}
          </div>
        )}
        {mediums.length > 0 && (
          <div
            className={`cyber-arch-medium-row ${larges.length > 0 ? "has-preceding" : ""}`}
          >
            {mediums.map((node) => renderNodeCard(node))}
          </div>
        )}
        {smalls.length > 0 && (
          <div
            className={`cyber-arch-small-row ${larges.length + mediums.length > 0 ? "has-preceding" : ""}`}
          >
            {smalls.map((node) => renderNodeCard(node))}
          </div>
        )}
      </>
    );
  };

  return (
    <div
      className="cyber-host-frame-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${hostLabel} 分层架构`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section className="cyber-host-frame" style={{ borderColor: hostColor }}>
        <header className="cyber-host-frame-head">
          <div className="cyber-host-frame-title">
            <HostBadgeIcon
              remote={Boolean(remote)}
              label={hostLabel}
              provider={provider}
              assetKind={assetKind}
              tags={tags}
              color={hostColor}
              size={20}
            />
            <div>
              <div className="cyber-host-frame-title-row">
                <strong>{hostLabel}</strong>
                {hostSubtitle && (
                  <span className="cyber-host-frame-sub">{hostSubtitle}</span>
                )}
              </div>
              <div className="cyber-host-frame-stats">
                <span>{arch.nodes.length} 组件</span>
                <span>{arch.internalEdges.length} 机内连线</span>
                <span>{arch.crossLinks.length} 跨机连接</span>
                <span>{arch.tiers.length} 架构层</span>
              </div>
            </div>
          </div>

          <div className="cyber-host-frame-actions">
            <div className="cyber-host-frame-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === "layers"}
                className={tab === "layers" ? "is-active" : ""}
                onClick={() => setTab("layers")}
              >
                <Layers size={12} /> 分层隔离图
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "list"}
                className={tab === "list" ? "is-active" : ""}
                onClick={() => setTab("list")}
              >
                <List size={12} /> 服务清单
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "mermaid"}
                className={tab === "mermaid" ? "is-active" : ""}
                onClick={() => setTab("mermaid")}
              >
                <Code2 size={12} /> Mermaid
              </button>
            </div>
            {onFocus3d && (
              <button
                type="button"
                className="secondary cyber-host-frame-focus"
                onClick={onFocus3d}
              >
                <Crosshair size={12} /> 聚焦 3D
              </button>
            )}
            <button
              type="button"
              className="world-dialog-close"
              aria-label="关闭"
              onClick={onClose}
            >
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="cyber-host-frame-body">
          {tab === "layers" && (
            <>
              <div className="cyber-arch-toolbar">
                <div className="cyber-arch-cats">
                  <button
                    type="button"
                    className={categoryFilter === "" ? "is-active" : ""}
                    onClick={() => setCategoryFilter("")}
                  >
                    全部分类
                  </button>
                  {presentCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={categoryFilter === cat.id ? "is-active" : ""}
                      onClick={() =>
                        setCategoryFilter(
                          categoryFilter === cat.id ? "" : cat.id,
                        )
                      }
                    >
                      <i style={{ background: cat.color }} />
                      {cat.label}
                      <em>{cat.count}</em>
                    </button>
                  ))}
                </div>
                <div className="cyber-arch-iso-legend">
                  <span className="is-strict-key">
                    实线 = 物理/内网严格隔离
                  </span>
                  <span className="is-virtual-key">虚线 = 逻辑/虚拟隔离</span>
                </div>
              </div>

              <div className="cyber-arch-canvas" ref={canvasRef}>
                {svgSize.width > 0 && routes.length > 0 && (
                  <svg
                    className="cyber-arch-svg"
                    width={svgSize.width}
                    height={svgSize.height}
                    viewBox={`0 0 ${svgSize.width} ${svgSize.height}`}
                    aria-hidden="true"
                  >
                    <defs>
                      <marker
                        id="arch-arrow-dag"
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
                        id="arch-arrow-dag-active"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="6"
                        markerHeight="6"
                        orient="auto"
                      >
                        <path d="M 1 2 L 8 5 L 1 8 z" fill="#f8fafc" />
                      </marker>
                      <marker
                        id="arch-arrow-fb"
                        viewBox="0 0 10 10"
                        refX="8"
                        refY="5"
                        markerWidth="5"
                        markerHeight="5"
                        orient="auto"
                      >
                        <path d="M 1 2 L 8 5 L 1 8 z" fill="#22d3ee" />
                      </marker>
                    </defs>

                    {routes.map((route) => {
                      const isQuiet = quietEdgeIds.has(route.edge.id);
                      const active = hoveredNodeId
                        ? route.edge.source === hoveredNodeId ||
                          route.edge.target === hoveredNodeId
                        : hoveredEdgeId === route.edge.id ||
                          (Boolean(categoryFilter) &&
                            activeNodeSet.has(route.edge.source) &&
                            activeNodeSet.has(route.edge.target));
                      if (isQuiet && !active) return null;
                      const dimmed = isHighlighting && !active;
                      const isFeedback =
                        route.kind === "feedback" || route.kind === "self";
                      return (
                        <g
                          key={route.edge.id}
                          className={[
                            "cyber-arch-edge-group",
                            active ? "is-active" : "",
                            dimmed ? "is-dimmed" : "",
                            isFeedback ? "is-feedback" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <path
                            d={route.path}
                            className="cyber-arch-edge-hit"
                            onMouseEnter={() => setHoveredEdgeId(route.edge.id)}
                            onMouseLeave={() => setHoveredEdgeId(undefined)}
                          />
                          <path
                            d={route.path}
                            className={[
                              "cyber-arch-edge",
                              isQuiet ? "is-quiet-revealed" : "",
                              isFeedback ? "is-feedback" : "",
                              active ? "is-active" : "",
                            ]
                              .filter(Boolean)
                              .join(" ")}
                            markerEnd={
                              isFeedback
                                ? "url(#arch-arrow-fb)"
                                : active
                                  ? "url(#arch-arrow-dag-active)"
                                  : "url(#arch-arrow-dag)"
                            }
                          />
                        </g>
                      );
                    })}
                    {busDots.map((dot) => {
                      const isQuiet = quietEdgeIds.has(dot.edgeId);
                      const active = hoveredNodeId
                        ? dot.source === hoveredNodeId ||
                          dot.target === hoveredNodeId
                        : hoveredEdgeId === dot.edgeId;
                      if (isQuiet && !active) return null;
                      const dimmed = isHighlighting && !active;
                      return (
                        <circle
                          key={`dot:${dot.edgeId}`}
                          cx={dot.x}
                          cy={dot.y}
                          r={active ? 3.2 : 2.3}
                          className={[
                            "cyber-arch-bus-dot",
                            active ? "is-active" : "",
                            dimmed ? "is-dimmed" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        />
                      );
                    })}
                  </svg>
                )}

                {hoveredCompactNode &&
                  (() => {
                    const { rect, node, cls } = hoveredCompactNode;
                    const alignLeft = rect.cx < 96;
                    const alignRight =
                      !alignLeft && rect.cx > svgSize.width - 96;
                    const placeBelow = rect.y < 36;
                    const xPos = alignLeft
                      ? Math.max(8, rect.x)
                      : alignRight
                        ? Math.min(svgSize.width - 8, rect.right)
                        : rect.cx;
                    const tx = alignLeft ? "0%" : alignRight ? "-100%" : "-50%";
                    const ty = placeBelow ? "0%" : "-100%";
                    return (
                      <div
                        className="cyber-topo-node-tooltip"
                        style={{
                          left: xPos,
                          top: placeBelow ? rect.bottom + 6 : rect.y - 6,
                          transform: `translate(${tx}, ${ty})`,
                        }}
                      >
                        <strong>{node.label}</strong>
                        <span>{cls.categoryMeta.shortLabel}</span>
                      </div>
                    );
                  })()}

                {hoveredEdgeRoute && (
                  <div
                    className="cyber-arch-edge-tooltip"
                    style={{
                      left: clamp(
                        hoveredEdgeRoute.labelX,
                        84,
                        Math.max(84, svgSize.width - 84),
                      ),
                      top: Math.max(10, hoveredEdgeRoute.labelY),
                    }}
                  >
                    <strong>
                      {nodeById.get(hoveredEdgeRoute.edge.source)?.label} →{" "}
                      {nodeById.get(hoveredEdgeRoute.edge.target)?.label}
                    </strong>
                    {hoveredEdgeRoute.edge.label && (
                      <span>{hoveredEdgeRoute.edge.label}</span>
                    )}
                  </div>
                )}

                <div className="cyber-enclosure-bar">
                  <div className="cyber-enclosure-label">
                    <Shield size={11} />
                    <span>
                      {remote ? "云端主机独立隔离域" : "物理主机严格隔离域"} ·{" "}
                      {hostLabel}
                    </span>
                  </div>
                  <small className="cyber-enclosure-stats">
                    <GitBranch size={10} /> 机内 {arch.internalEdges.length}{" "}
                    条流向
                    {arch.feedbackEdges.length > 0 &&
                      `（${arch.feedbackEdges.length} 回环走左道）`}
                  </small>
                </div>

                <div
                  className="cyber-host-enclosure is-strict"
                  data-isolation="strict"
                >
                  {topBoundaryNodes.length > 0 && (
                    <section
                      key="tier-boundary-top"
                      data-arch-tier="tier-boundary-top"
                      data-isolation="strict"
                      className="cyber-perimeter-dock is-top"
                      ref={(el) => {
                        if (el) tierRefs.current.set("tier-boundary-top", el);
                        else tierRefs.current.delete("tier-boundary-top");
                      }}
                    >
                      <span className="cyber-dock-badge">
                        边界门户 · 入网/解析
                      </span>
                      <div className="cyber-arch-perimeter-grid">
                        {topBoundaryNodes.map((n) => renderNodeCard(n, true))}
                      </div>
                    </section>
                  )}

                  <div className="cyber-arch-layers">
                    {interiorTiers.map((tier) => {
                      const isSingleLarge =
                        tier.nodes.length === 1 &&
                        arch.classifications.get(tier.nodes[0].id)?.size ===
                          "large";
                      return (
                        <section
                          key={tier.id}
                          data-arch-tier={tier.id}
                          data-isolation={tier.isolation}
                          className={[
                            "cyber-arch-tier",
                            `is-iso-${tier.isolation}`,
                            isSingleLarge ? "is-single" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          ref={(el) => {
                            if (el) tierRefs.current.set(tier.id, el);
                            else tierRefs.current.delete(tier.id);
                          }}
                        >
                          <header className="cyber-arch-tier-head">
                            <span className="cyber-arch-tier-badge">
                              {tier.title}
                            </span>
                            <span
                              className={`cyber-iso-pill is-${tier.isolation}`}
                            >
                              {tier.isolation === "strict"
                                ? "实线 · 严格"
                                : "虚线 · 虚拟"}
                            </span>
                            <small>{tier.subtitle}</small>
                            <em className="cyber-arch-tier-count">
                              {tier.nodes.length}
                            </em>
                          </header>

                          {renderTierNodes(tier.nodes)}
                        </section>
                      );
                    })}
                  </div>

                  {bottomBoundaryNodes.length > 0 && (
                    <section
                      key="tier-boundary-bottom"
                      data-arch-tier="tier-boundary-bottom"
                      data-isolation="strict"
                      className="cyber-perimeter-dock is-bottom"
                      ref={(el) => {
                        if (el)
                          tierRefs.current.set("tier-boundary-bottom", el);
                        else tierRefs.current.delete("tier-boundary-bottom");
                      }}
                    >
                      <span className="cyber-dock-badge is-egress">
                        出网边界 · EGRESS
                      </span>
                      <div className="cyber-arch-perimeter-grid">
                        {bottomBoundaryNodes.map((n) =>
                          renderNodeCard(n, true),
                        )}
                      </div>
                    </section>
                  )}
                </div>
              </div>

              {arch.crossLinks.length > 0 && (
                <section className="cyber-cross-strip">
                  <header>
                    <strong>跨机与边界外部连线</strong>
                    <small>
                      入 {inboundCross.length} · 出 {outboundCross.length}
                    </small>
                  </header>
                  <div className="cyber-cross-chips">
                    {arch.crossLinks.map((link) => {
                      const peerHostName =
                        link.peerHostId === "__external"
                          ? "外部"
                          : (entityNameById.get(link.peerHostId) ??
                            link.peerHostId);
                      return (
                        <button
                          key={link.edge.id}
                          type="button"
                          className={`cyber-cross-chip is-${link.direction}`}
                          onClick={() => onSelectNode(link.localNode)}
                        >
                          {link.direction === "inbound" ? (
                            <ArrowDownRight size={11} />
                          ) : (
                            <ArrowUpRight size={11} />
                          )}
                          <span>
                            {link.direction === "inbound"
                              ? `${peerHostName}/${link.peerNode?.label ?? link.edge.source} → ${link.localNode.label}`
                              : `${link.localNode.label} → ${peerHostName}/${link.peerNode?.label ?? link.edge.target}`}
                          </span>
                          {link.edge.label && <em>{link.edge.label}</em>}
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </>
          )}

          {tab === "list" && (
            <div className="inventory-list cyber-host-list">
              {arch.nodes.map((node) => {
                const svc = node.serviceId
                  ? serviceById.get(node.serviceId)
                  : undefined;
                const cls = arch.classifications.get(node.id)!;
                const rel = internalRelations.get(node.id);
                return (
                  <button
                    key={node.id}
                    type="button"
                    className="cyber-detail-row"
                    onClick={() => onSelectNode(node)}
                  >
                    <ServiceBadgeIcon
                      icon={node.icon ?? svc?.icon}
                      serviceId={svc?.id ?? node.serviceId}
                      label={node.label}
                      kind={node.kind}
                      size={20}
                    />
                    <span>
                      <strong>{node.label}</strong>
                      <small>
                        {cls.layerMeta.shortLabel}
                        {cls.boundaryMeta
                          ? `(${cls.boundaryMeta.label})`
                          : ""}{" "}
                        · {cls.categoryMeta.label}
                        {rel &&
                          (rel.incoming.length > 0 ||
                            rel.outgoing.length > 0) &&
                          ` · 入${rel.incoming.length}/出${rel.outgoing.length}`}
                      </small>
                    </span>
                  </button>
                );
              })}
              {arch.nodes.length === 0 && (
                <p className="muted">该主机下暂无已记录服务。</p>
              )}
            </div>
          )}

          {tab === "mermaid" && (
            <div className="cyber-arch-mermaid">
              <div className="cyber-arch-mermaid-bar">
                <p className="muted">
                  已按边界门户 / 顶层应用 / 基础设施 / 中间件生成 Mermaid
                  分组，含虚线隔离与回环标记。
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void handleCopyMermaid()}
                >
                  {copiedMermaid ? (
                    <>
                      <Check size={12} /> 已复制
                    </>
                  ) : (
                    <>
                      <Copy size={12} /> 复制 Mermaid
                    </>
                  )}
                </button>
              </div>
              <pre>{mermaidSource}</pre>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
