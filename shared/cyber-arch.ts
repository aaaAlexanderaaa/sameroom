import {
  graphGroup,
  type ArchLayer,
  type BoundaryRole,
  type CyberCategoryDef,
  type CyberGraph,
  type CyberNodeSize,
  type CyberTopologyDef,
  type CyberZoneDef,
  type IsolationKind,
  type ServiceCategory,
} from "./cyber.js";
import type { Dashboard, Entity, Service } from "./domain.js";

export type CyberNode = CyberGraph["nodes"][number];
export type CyberEdge = CyberGraph["edges"][number];

export interface ArchLayerMeta {
  id: ArchLayer;
  order: number;
  label: string;
  shortLabel: string;
  isolation: IsolationKind;
  isolationLabel: string;
  subtitle: string;
}

export interface BoundaryRoleMeta {
  id: BoundaryRole;
  order: number;
  label: string;
  badge: string;
  color: string;
}

export interface ServiceCategoryMeta {
  id: ServiceCategory;
  order: number;
  label: string;
  shortLabel: string;
  color: string;
  defaultLayer?: ArchLayer;
  isCustom?: boolean;
}

export type ClassificationSource =
  "node" | "service" | "kind" | "rule" | "fallback";

export type ZoneAssignmentSource =
  "node" | "service" | "host-zone" | "group-zone" | "default";

export interface ClassificationOptions {
  categories?: Record<string, CyberCategoryDef>;
  zones?: CyberZoneDef[];
}

export interface TopologyMeta {
  id: string;
  label: string;
  description?: string;
  color?: string;
  order: number;
  nodeCount: number;
  edgeCount: number;
  isCustom: boolean;
}

export interface NodeSizeMeta {
  id: CyberNodeSize;
  order: number;
  label: string;
  shortLabel: string;
  description: string;
}

export const CYBER_NODE_SIZE_META: Record<CyberNodeSize, NodeSizeMeta> = {
  large: {
    id: "large",
    order: 0,
    label: "大图标（完整卡片）",
    shortLabel: "大",
    description: "核心应用、网关与主控中心，完整展示标题、宿主与分类",
  },
  medium: {
    id: "medium",
    order: 1,
    label: "中图标（紧凑图标）",
    shortLabel: "中",
    description: "中间件与内部依赖组件，展示图标与简洁名称",
  },
  small: {
    id: "small",
    order: 2,
    label: "小图标（仅图标 · 悬停显线）",
    shortLabel: "小",
    description: "从属 Agent / 探针等无业务流组件，仅示图标，悬停展开连线",
  },
};

export const ARCH_LAYER_META: Record<ArchLayer, ArchLayerMeta> = {
  boundary: {
    id: "boundary",
    order: 0,
    label: "边界门户层",
    shortLabel: "边界",
    isolation: "strict",
    isolationLabel: "边界锚点 · 跨域守门",
    subtitle: "入网反向代理 · DNS 解析 · 出网代理与组网关口",
  },
  app: {
    id: "app",
    order: 1,
    label: "顶层应用层",
    shortLabel: "应用",
    isolation: "virtual",
    isolationLabel: "虚线隔离 · 日常直访面",
    subtitle: "笔记、导航、AI 与研发工具等日常直接访问服务",
  },
  infra: {
    id: "infra",
    order: 2,
    label: "基础设施层",
    shortLabel: "基建",
    isolation: "virtual",
    isolationLabel: "虚线隔离 · 后台常驻",
    subtitle: "健康监控、容器管理、自动化与同步等持续运行支撑",
  },
  middleware: {
    id: "middleware",
    order: 3,
    label: "中间件与数据层",
    shortLabel: "中间件",
    isolation: "strict",
    isolationLabel: "实线隔离 · 内网底座",
    subtitle: "PostgreSQL / Redis 等仅供机内应用调用的数据组件",
  },
};

export const BOUNDARY_ROLE_META: Record<BoundaryRole, BoundaryRoleMeta> = {
  ingress: {
    id: "ingress",
    order: 0,
    label: "入网",
    badge: "入网 INGRESS",
    color: "#34d399",
  },
  dns: {
    id: "dns",
    order: 1,
    label: "DNS",
    badge: "DNS 解析",
    color: "#38bdf8",
  },
  mesh: {
    id: "mesh",
    order: 2,
    label: "组网",
    badge: "Overlay 组网",
    color: "#818cf8",
  },
  egress: {
    id: "egress",
    order: 3,
    label: "出网",
    badge: "出网 EGRESS",
    color: "#fbbf24",
  },
};

export const SERVICE_CATEGORY_META: Record<
  ServiceCategory,
  ServiceCategoryMeta
> = {
  "boundary-net": {
    id: "boundary-net",
    order: 0,
    label: "边界接入",
    shortLabel: "边界",
    color: "#34d399",
  },
  relay: {
    id: "relay",
    order: 1,
    label: "代理与中转",
    shortLabel: "中转",
    color: "#f59e0b",
  },
  monitor: {
    id: "monitor",
    order: 2,
    label: "健康监控",
    shortLabel: "监控",
    color: "#4ade80",
  },
  admin: {
    id: "admin",
    order: 3,
    label: "运维管理",
    shortLabel: "管理",
    color: "#60a5fa",
  },
  automation: {
    id: "automation",
    order: 4,
    label: "自动化",
    shortLabel: "自动化",
    color: "#f472b6",
  },
  workspace: {
    id: "workspace",
    order: 5,
    label: "应用与知识",
    shortLabel: "应用",
    color: "#38bdf8",
  },
  storage: {
    id: "storage",
    order: 6,
    label: "存储与同步",
    shortLabel: "存储",
    color: "#a78bfa",
  },
  data: {
    id: "data",
    order: 7,
    label: "数据中间件",
    shortLabel: "数据",
    color: "#fb7185",
  },
};

export const ORDERED_CATEGORIES: ServiceCategoryMeta[] = Object.values(
  SERVICE_CATEGORY_META,
).sort((a, b) => a.order - b.order);

/**
 * Resolve built-in categories merged with custom workspace category definitions.
 */
export function resolveCategoryRegistry(
  custom?: Record<string, CyberCategoryDef>,
): Record<string, ServiceCategoryMeta> {
  const out: Record<string, ServiceCategoryMeta> = {
    ...SERVICE_CATEGORY_META,
  };
  if (!custom) return out;
  let fallbackOrder = 100;
  for (const [id, def] of Object.entries(custom)) {
    const base = out[id];
    out[id] = {
      id,
      order: def.order ?? base?.order ?? fallbackOrder++,
      label: def.label,
      shortLabel: def.shortLabel ?? base?.shortLabel ?? def.label.slice(0, 6),
      color: def.color ?? base?.color ?? "#38bdf8",
      defaultLayer: def.defaultLayer ?? base?.defaultLayer,
      isCustom: true,
    };
  }
  return out;
}

/**
 * List resolved categories sorted by order, including any custom user-registered ones.
 */
export function listOrderedCategories(
  custom?: Record<string, CyberCategoryDef>,
): ServiceCategoryMeta[] {
  return Object.values(resolveCategoryRegistry(custom)).sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, "zh-CN"),
  );
}

/**
 * Merge group memberships observed across nodes/edges with declared graph.topologies metadata.
 */
export function resolveTopologyRegistry(graph: CyberGraph): TopologyMeta[] {
  const ids = new Set<string>(Object.keys(graph.topologies ?? {}));
  for (const n of graph.nodes) {
    for (const g of n.groups) ids.add(g);
  }
  for (const e of graph.edges) {
    for (const g of e.groups) ids.add(g);
  }
  const out: TopologyMeta[] = [];
  for (const id of ids) {
    const def: CyberTopologyDef | undefined = graph.topologies?.[id];
    const matchingEdges = graph.edges.filter((e) => e.groups.includes(id));
    const nodeIds = new Set<string>();
    for (const n of graph.nodes) {
      if (n.groups.includes(id)) nodeIds.add(n.id);
    }
    for (const e of matchingEdges) {
      nodeIds.add(e.source);
      nodeIds.add(e.target);
    }
    out.push({
      id,
      label: def?.label ?? id,
      description: def?.description,
      color: def?.color,
      order: def?.order ?? 100,
      nodeCount: nodeIds.size,
      edgeCount: matchingEdges.length,
      isCustom: Boolean(def),
    });
  }
  return out.sort(
    (a, b) => a.order - b.order || a.label.localeCompare(b.label, "zh-CN"),
  );
}

/**
 * Synthesize a deterministic fallback cyber graph from recorded services when no custom graph exists.
 */
export function synthesizeDefaultCyberGraph(
  home: Pick<{ entities: Entity[]; services: Service[] }, "services">,
  asOf = "",
): CyberGraph {
  return {
    version: 1,
    source: "已有服务记录 · 非实时",
    asOf,
    clouds: [],
    nodes: home.services.map((s) => ({
      id: s.id,
      label: s.name,
      host: s.entityId,
      serviceId: s.id,
      icon: s.icon,
      kind: "service",
      ...(s.size ? { size: s.size } : {}),
      ...(s.layer ? { layer: s.layer } : {}),
      ...(s.boundary ? { boundary: s.boundary } : {}),
      ...(s.category ? { category: s.category } : {}),
      ...(s.zone ? { zone: s.zone } : {}),
      groups: [...(s.groups ?? [])],
    })),
    edges: [],
  };
}

export interface NodeClassification {
  size: CyberNodeSize;
  sizeSource: ClassificationSource;
  layer: ArchLayer;
  layerSource: ClassificationSource;
  boundaryRole?: BoundaryRole;
  boundarySource?: ClassificationSource;
  category: ServiceCategory;
  categorySource: ClassificationSource;
  zoneId?: string;
  zoneSource: ZoneAssignmentSource;
  categoryMeta: ServiceCategoryMeta;
  layerMeta: ArchLayerMeta;
  boundaryMeta?: BoundaryRoleMeta;
}

const DATA_RE =
  /postgres|paradedb|redis|valkey|mysql|mariadb|mongo|sqlite|qdrant|milvus|meilisearch|elasticsearch|rabbitmq|kafka|minio|\bpg\b|-pg$|\bdb\b/;
const SUBORDINATE_AGENT_RE =
  /\b(portainer[-_ ]?agent|beszel[-_ ]?agent|node[-_ ]?exporter|cadvisor|watchtower|diun|promtail|telegraf|zabbix[-_ ]?agent|netdata[-_ ]?agent|komari[-_ ]?agent|nezha[-_ ]?agent|uptime[-_ ]?agent|docker[-_ ]?socket[-_ ]?proxy|socket[-_ ]?proxy)\b|探针|采集端|客户端代理/;
const DNS_RE =
  /\b(dnsmasq|pihole|pi-hole|coredns|adguard|unbound|bind9)\b|route53|\bdns\b/;
const INGRESS_RE =
  /\b(npm|nginx-proxy|traefik|caddy|haproxy|cloudflare|cf-tunnel)\b|nginx proxy|反代|入口网/;
const MESH_RE = /\b(tailscale|headscale|derp|wireguard|zerotier)\b|overlay/;
const EGRESS_BOUNDARY_RE =
  /\b(flclash|clash|mihomo|v2ray|xray|sing-box|socks5?)\b|出网|虚拟路由|远端网关/;
const RELAY_RE =
  /\b(new[-_ ]?api|cli[-_ ]?proxy[-_ ]?api|cpa|rustdesk|relay)\b|中转|代理/;
const MONITOR_RE =
  /\b(uptime|beszel|grafana|prometheus|loki|alertmanager|bark|ntfy)\b|监控|探针|告警/;
const AUTOMATION_RE =
  /\b(n8n|sunsetbot|home[-_ ]?assistant|hass|windmill|activepieces)\b|自动化|编排/;
const ADMIN_RE =
  /\b(portainer|dbgate|electerm|proxmox|pve|truenas|cockpit|docker|ops|manage)\b|运维|管理/;
const STORAGE_DAEMON_RE = /\b(syncthing|backup|restic|borg)\b|备份|同步/;
const STORAGE_PORTAL_RE =
  /\b(alist|openlist|immich|jellyfin|plex|emby|navidrome|nextcloud|owncloud)\b|媒体|网盘|存储/;
const WORKSPACE_RE =
  /\b(dashy|trilium|triliumnext|lobehub|lobe|gitea|vaultwarden|bitwarden|nocodb|wallos|home[-_ ]?atlas|json4u|cheatsheet|njk01|searxng)\b|笔记|导航|工作区|代码|搜索/;

function detectBoundaryRole(
  node: CyberNode,
  svc: Service | undefined,
  identityText: string,
  svcIdentity: string,
  groupText: string,
): { role?: BoundaryRole; source?: ClassificationSource } {
  if (node.boundary) return { role: node.boundary, source: "node" };
  if (node.layer && node.layer !== "boundary") return {};
  if (svc?.boundary) return { role: svc.boundary, source: "service" };
  if (svc?.layer && svc.layer !== "boundary") return {};

  const check = `${identityText} ${svcIdentity}`;
  if (
    node.kind === "external" &&
    MESH_RE.test(`${identityText} ${groupText}`)
  ) {
    return { role: "mesh", source: "rule" };
  }
  if (DNS_RE.test(check)) return { role: "dns", source: "rule" };
  if (MESH_RE.test(check)) return { role: "mesh", source: "rule" };
  if (EGRESS_BOUNDARY_RE.test(check)) return { role: "egress", source: "rule" };
  if (INGRESS_RE.test(check)) return { role: "ingress", source: "rule" };
  if (node.kind === "gateway") return { role: "ingress", source: "kind" };
  return {};
}

function detectCategory(
  node: CyberNode,
  svc: Service | undefined,
  identityText: string,
  svcIdentity: string,
  groupText: string,
  boundaryRole?: BoundaryRole,
): { category: ServiceCategory; source: ClassificationSource } {
  if (node.category) return { category: node.category, source: "node" };
  if (svc?.category) return { category: svc.category, source: "service" };
  if (node.kind === "database") return { category: "data", source: "kind" };
  if (DATA_RE.test(identityText)) return { category: "data", source: "rule" };
  if (
    boundaryRole === "ingress" ||
    boundaryRole === "dns" ||
    boundaryRole === "mesh"
  ) {
    return { category: "boundary-net", source: "rule" };
  }
  if (boundaryRole === "egress" || RELAY_RE.test(identityText)) {
    return { category: "relay", source: "rule" };
  }
  if (MONITOR_RE.test(identityText))
    return { category: "monitor", source: "rule" };
  if (AUTOMATION_RE.test(identityText)) {
    return { category: "automation", source: "rule" };
  }
  if (ADMIN_RE.test(identityText)) return { category: "admin", source: "rule" };
  if (
    STORAGE_DAEMON_RE.test(identityText) ||
    STORAGE_PORTAL_RE.test(identityText)
  ) {
    return { category: "storage", source: "rule" };
  }
  if (WORKSPACE_RE.test(identityText))
    return { category: "workspace", source: "rule" };

  // Check service binding identity when node ID/label is generic.
  if (DATA_RE.test(svcIdentity)) return { category: "data", source: "rule" };
  if (RELAY_RE.test(svcIdentity)) return { category: "relay", source: "rule" };
  if (MONITOR_RE.test(svcIdentity))
    return { category: "monitor", source: "rule" };
  if (AUTOMATION_RE.test(svcIdentity)) {
    return { category: "automation", source: "rule" };
  }
  if (ADMIN_RE.test(svcIdentity)) return { category: "admin", source: "rule" };
  if (
    STORAGE_DAEMON_RE.test(svcIdentity) ||
    STORAGE_PORTAL_RE.test(svcIdentity)
  ) {
    return { category: "storage", source: "rule" };
  }
  if (WORKSPACE_RE.test(svcIdentity))
    return { category: "workspace", source: "rule" };

  // Fallback to explicit mesh/DNS/ops group memberships without hijacking route consumers.
  if (MESH_RE.test(identityText) || MESH_RE.test(groupText)) {
    return { category: "boundary-net", source: "rule" };
  }
  if (MONITOR_RE.test(groupText))
    return { category: "monitor", source: "rule" };
  if (AUTOMATION_RE.test(groupText))
    return { category: "automation", source: "rule" };
  if (ADMIN_RE.test(groupText)) return { category: "admin", source: "rule" };
  return { category: "workspace", source: "fallback" };
}

function detectLayer(
  node: CyberNode,
  svc: Service | undefined,
  text: string,
  category: ServiceCategory,
  categoryMeta: ServiceCategoryMeta,
  boundaryRole: BoundaryRole | undefined,
  inEdges: CyberEdge[],
  outEdges: CyberEdge[],
  nodeClassPass1: Map<string, { boundaryRole?: BoundaryRole }>,
): { layer: ArchLayer; source: ClassificationSource } {
  if (node.layer) return { layer: node.layer, source: "node" };
  if (svc?.layer) return { layer: svc.layer, source: "service" };
  if (node.boundary) return { layer: "boundary", source: "node" };
  if (svc?.boundary) return { layer: "boundary", source: "service" };
  if (node.kind === "database") return { layer: "middleware", source: "kind" };
  if (categoryMeta.defaultLayer) {
    return { layer: categoryMeta.defaultLayer, source: "rule" };
  }
  if (category === "data") return { layer: "middleware", source: "rule" };
  if (boundaryRole) return { layer: "boundary", source: "rule" };
  if (
    category === "monitor" ||
    category === "admin" ||
    category === "automation" ||
    category === "relay"
  ) {
    return { layer: "infra", source: "rule" };
  }
  if (category === "storage") {
    return {
      layer: STORAGE_DAEMON_RE.test(text) ? "infra" : "app",
      source: "rule",
    };
  }

  // Pure internal sinks only called by non-boundary peers belong at the dependency base.
  const sameHost = node.host ?? "__external";
  const sameHostIns = inEdges.filter((e) => e.source !== node.id);
  const sameHostOuts = outEdges.filter((e) => e.target !== node.id);
  if (
    node.kind === "service" &&
    !node.serviceId &&
    sameHostIns.length > 0 &&
    sameHostOuts.length === 0
  ) {
    const hasIngressCaller = sameHostIns.some(
      (e) => nodeClassPass1.get(e.source)?.boundaryRole === "ingress",
    );
    if (!hasIngressCaller && sameHost !== "__external") {
      return { layer: "middleware", source: "rule" };
    }
  }

  return { layer: "app", source: "fallback" };
}

function detectNodeSize(
  node: CyberNode,
  svc: Service | undefined,
  identityText: string,
  svcIdentity: string,
  layer: ArchLayer,
  category: ServiceCategory,
): { size: CyberNodeSize; source: ClassificationSource } {
  if (node.size) return { size: node.size, source: "node" };
  if (svc?.size) return { size: svc.size, source: "service" };

  if (
    layer !== "boundary" &&
    node.kind !== "gateway" &&
    node.kind !== "external" &&
    node.kind !== "database"
  ) {
    if (
      SUBORDINATE_AGENT_RE.test(identityText) ||
      SUBORDINATE_AGENT_RE.test(svcIdentity)
    ) {
      return { size: "small", source: "rule" };
    }
    if (
      (category === "monitor" ||
        category === "admin" ||
        category === "storage") &&
      /\b(agent|exporter|collector)\b/.test(identityText)
    ) {
      return { size: "small", source: "rule" };
    }
  }

  if (node.kind === "database") return { size: "medium", source: "kind" };
  if (layer === "middleware") return { size: "medium", source: "rule" };

  return { size: "large", source: "fallback" };
}

/**
 * Determine whether an edge should stay hidden until hovered/focused
 * (true for explicit `visibility: "hover"` or any edge touching a `small` subordinate node unless `visibility: "always"`).
 */
export function isCyberEdgeQuiet(
  edge: Pick<CyberEdge, "source" | "target" | "visibility">,
  classifications: Map<string, Pick<NodeClassification, "size">>,
): boolean {
  if (edge.visibility === "always") return false;
  if (edge.visibility === "hover") return true;
  const srcSize = classifications.get(edge.source)?.size;
  const tgtSize = classifications.get(edge.target)?.size;
  return srcSize === "small" || tgtSize === "small";
}

function resolveZoneAssignment(
  node: CyberNode,
  svc: Service | undefined,
  sortedZones: CyberZoneDef[],
): { zoneId?: string; zoneSource: ZoneAssignmentSource } {
  if (node.zone) return { zoneId: node.zone, zoneSource: "node" };
  if (svc?.zone) return { zoneId: svc.zone, zoneSource: "service" };
  if (node.host) {
    const byHost = sortedZones.find((z) => z.hosts?.includes(node.host!));
    if (byHost) return { zoneId: byHost.id, zoneSource: "host-zone" };
  }
  if (node.groups.length > 0) {
    const byGroup = sortedZones.find((z) =>
      z.groups?.some((g) => node.groups.includes(g)),
    );
    if (byGroup) return { zoneId: byGroup.id, zoneSource: "group-zone" };
  }
  return { zoneId: undefined, zoneSource: "default" };
}

/**
 * Classify a graph node into its orthogonal architecture stratum (boundary/app/infra/middleware),
 * functional category (built-in or custom), and isolation zone with explicit provenance.
 */
export function classifyCyberNodes(
  nodes: CyberNode[],
  edges: CyberEdge[],
  services: Service[] = [],
  options: ClassificationOptions = {},
): Map<string, NodeClassification> {
  const serviceMap = new Map(services.map((s) => [s.id, s]));
  const categoryRegistry = resolveCategoryRegistry(options.categories);
  const sortedZones = [...(options.zones ?? [])].sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.label.localeCompare(b.label, "zh-CN"),
  );
  const inEdgesByNode = new Map<string, CyberEdge[]>();
  const outEdgesByNode = new Map<string, CyberEdge[]>();
  for (const e of edges) {
    const outs = outEdgesByNode.get(e.source) ?? [];
    outs.push(e);
    outEdgesByNode.set(e.source, outs);
    const ins = inEdgesByNode.get(e.target) ?? [];
    ins.push(e);
    inEdgesByNode.set(e.target, ins);
  }

  const pass1 = new Map<
    string,
    {
      svc?: Service;
      boundaryRole?: BoundaryRole;
      boundarySource?: ClassificationSource;
      category: ServiceCategory;
      categorySource: ClassificationSource;
      categoryMeta: ServiceCategoryMeta;
      zoneId?: string;
      zoneSource: ZoneAssignmentSource;
      text: string;
    }
  >();
  for (const node of nodes) {
    const svc = node.serviceId ? serviceMap.get(node.serviceId) : undefined;
    const identityText = `${node.id} ${node.label}`.toLowerCase();
    const svcIdentity =
      `${node.serviceId ?? ""} ${svc?.name ?? ""} ${svc?.description ?? ""}`.toLowerCase();
    const groupText = node.groups.join(" ").toLowerCase();
    const { role: boundaryRole, source: boundarySource } = detectBoundaryRole(
      node,
      svc,
      identityText,
      svcIdentity,
      groupText,
    );
    const { category, source: categorySource } = detectCategory(
      node,
      svc,
      identityText,
      svcIdentity,
      groupText,
      boundaryRole,
    );
    const categoryMeta: ServiceCategoryMeta = categoryRegistry[category] ?? {
      id: category,
      order: 999,
      label: category,
      shortLabel: category.slice(0, 6),
      color: "#94a3b8",
      isCustom: true,
    };
    const { zoneId, zoneSource } = resolveZoneAssignment(
      node,
      svc,
      sortedZones,
    );
    pass1.set(node.id, {
      svc,
      boundaryRole,
      boundarySource,
      category,
      categorySource,
      categoryMeta,
      zoneId,
      zoneSource,
      text: `${identityText} ${svcIdentity} ${groupText}`,
    });
  }

  const out = new Map<string, NodeClassification>();
  for (const node of nodes) {
    const p1 = pass1.get(node.id)!;
    const { layer, source: layerSource } = detectLayer(
      node,
      p1.svc,
      p1.text,
      p1.category,
      p1.categoryMeta,
      p1.boundaryRole,
      inEdgesByNode.get(node.id) ?? [],
      outEdgesByNode.get(node.id) ?? [],
      pass1,
    );
    const finalBoundaryRole =
      layer === "boundary" ? p1.boundaryRole : undefined;
    const identityText = `${node.id} ${node.label}`.toLowerCase();
    const svcIdentity =
      `${node.serviceId ?? ""} ${p1.svc?.name ?? ""} ${p1.svc?.description ?? ""}`.toLowerCase();
    const { size, source: sizeSource } = detectNodeSize(
      node,
      p1.svc,
      identityText,
      svcIdentity,
      layer,
      p1.category,
    );
    out.set(node.id, {
      size,
      sizeSource,
      layer,
      layerSource,
      boundaryRole: finalBoundaryRole,
      boundarySource: finalBoundaryRole ? p1.boundarySource : undefined,
      category: p1.category,
      categorySource: p1.categorySource,
      zoneId: p1.zoneId,
      zoneSource: p1.zoneSource,
      categoryMeta: p1.categoryMeta,
      layerMeta: ARCH_LAYER_META[layer],
      boundaryMeta: finalBoundaryRole
        ? BOUNDARY_ROLE_META[finalBoundaryRole]
        : undefined,
    });
  }
  return out;
}

/**
 * Filter a graph down to a functional category while retaining edges wholly within the set
 * plus direct cross-boundary edges attached to those category members.
 */
export function filterCyberByCategory(
  graph: CyberGraph,
  category: ServiceCategory | "",
  classifications: Map<string, NodeClassification>,
): CyberGraph {
  if (!category) return graph;
  const matchedIds = new Set(
    graph.nodes
      .filter((n) => classifications.get(n.id)?.category === category)
      .map((n) => n.id),
  );
  const edges = graph.edges.filter(
    (e) => matchedIds.has(e.source) || matchedIds.has(e.target),
  );
  const keepIds = new Set(matchedIds);
  for (const e of edges) {
    keepIds.add(e.source);
    keepIds.add(e.target);
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => keepIds.has(n.id)),
    edges,
  };
}

export interface HostArchCrossLink {
  edge: CyberEdge;
  direction: "inbound" | "outbound";
  localNode: CyberNode;
  peerNode?: CyberNode;
  peerHostId: string;
}

export interface HostArchTier {
  id: string;
  index: number;
  layer: ArchLayer;
  isolation: IsolationKind;
  isolationLabel: string;
  isBoundary?: boolean;
  title: string;
  subtitle: string;
  nodes: CyberNode[];
  standalone?: boolean;
}

export interface HostArchitecture {
  hostId: string;
  nodes: CyberNode[];
  classifications: Map<string, NodeClassification>;
  categories: ServiceCategoryMeta[];
  internalEdges: CyberEdge[];
  dagEdges: CyberEdge[];
  feedbackEdges: CyberEdge[];
  crossLinks: HostArchCrossLink[];
  boundaryTier?: HostArchTier;
  tiers: HostArchTier[];
  nodeLayer: Map<string, number>;
}

/**
 * Prioritize boundary services, then user-facing apps, infra, and data dependencies when
 * ordering compact host preview cards in machine mode.
 */
export function orderHostPreviewNodes(
  nodes: CyberNode[],
  edges: CyberEdge[],
  services: Service[] = [],
  options: ClassificationOptions = {},
): CyberNode[] {
  const clsMap = classifyCyberNodes(nodes, edges, services, options);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const internalDegree = new Map<string, number>();
  const crossDegree = new Map<string, number>();

  for (const e of edges) {
    const srcIn = nodeIds.has(e.source);
    const tgtIn = nodeIds.has(e.target);
    if (srcIn && tgtIn) {
      internalDegree.set(e.source, (internalDegree.get(e.source) ?? 0) + 1);
      internalDegree.set(e.target, (internalDegree.get(e.target) ?? 0) + 1);
    } else if (srcIn) {
      crossDegree.set(e.source, (crossDegree.get(e.source) ?? 0) + 1);
    } else if (tgtIn) {
      crossDegree.set(e.target, (crossDegree.get(e.target) ?? 0) + 1);
    }
  }

  return [...nodes].sort((a, b) => {
    const ca = clsMap.get(a.id)!;
    const cb = clsMap.get(b.id)!;
    const layerDiff = ca.layerMeta.order - cb.layerMeta.order;
    if (layerDiff !== 0) return layerDiff;
    if (ca.boundaryMeta && cb.boundaryMeta) {
      const bDiff = ca.boundaryMeta.order - cb.boundaryMeta.order;
      if (bDiff !== 0) return bDiff;
    }
    const sizeDiff =
      CYBER_NODE_SIZE_META[ca.size].order - CYBER_NODE_SIZE_META[cb.size].order;
    if (sizeDiff !== 0) return sizeDiff;
    const intDiff =
      (internalDegree.get(b.id) ?? 0) - (internalDegree.get(a.id) ?? 0);
    if (intDiff !== 0) return intDiff;
    const crossDiff =
      (crossDegree.get(b.id) ?? 0) - (crossDegree.get(a.id) ?? 0);
    if (crossDiff !== 0) return crossDiff;
    const catDiff = ca.categoryMeta.order - cb.categoryMeta.order;
    if (catDiff !== 0) return catDiff;
    return a.label.localeCompare(b.label, "zh-CN");
  });
}

function compareInStratum(
  a: CyberNode,
  b: CyberNode,
  clsMap: Map<string, NodeClassification>,
  inDeg: Map<string, number>,
  outDeg: Map<string, number>,
  feedbackSenders: Set<string>,
  dagInEdges: Map<string, CyberEdge[]>,
  parentPos: Map<string, number>,
): number {
  const ca = clsMap.get(a.id)!;
  const cb = clsMap.get(b.id)!;

  if (ca.boundaryMeta && cb.boundaryMeta) {
    const roleDiff = ca.boundaryMeta.order - cb.boundaryMeta.order;
    if (roleDiff !== 0) return roleDiff;
  }

  // Place feedback senders near left gutter so return loops do not cross sibling cards.
  const fbDiff =
    (feedbackSenders.has(a.id) ? 0 : 1) - (feedbackSenders.has(b.id) ? 0 : 1);
  if (fbDiff !== 0) return fbDiff;

  const bary = (nodeId: string) => {
    const parents = (dagInEdges.get(nodeId) ?? [])
      .map((e) => parentPos.get(e.source))
      .filter((v): v is number => v !== undefined);
    if (parents.length === 0) return Number.MAX_SAFE_INTEGER;
    return parents.reduce((sum, v) => sum + v, 0) / parents.length;
  };
  const baryDiff = bary(a.id) - bary(b.id);
  if (Math.abs(baryDiff) > 0.01) return baryDiff;

  const catDiff = ca.categoryMeta.order - cb.categoryMeta.order;
  if (catDiff !== 0) return catDiff;

  const degA = (outDeg.get(a.id) ?? 0) + (inDeg.get(a.id) ?? 0);
  const degB = (outDeg.get(b.id) ?? 0) + (inDeg.get(b.id) ?? 0);
  if (degA !== degB) return degB - degA;

  return a.label.localeCompare(b.label, "zh-CN");
}

/**
 * Layer a single host's internal architecture into semantic perimeter boundary slots
 * plus interior isolation tiers (Top Apps -> Background Infra -> Data Middleware),
 * converging intra-host self-references into clean downward DAG routes and left return loops.
 */
export function buildHostArchitecture(
  hostId: string,
  allNodes: CyberNode[],
  allEdges: CyberEdge[],
  services: Service[] = [],
  options: ClassificationOptions = {},
): HostArchitecture {
  const clsAll = classifyCyberNodes(allNodes, allEdges, services, options);
  const nodes = allNodes.filter((n) => (n.host ?? "__external") === hostId);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const allNodeMap = new Map(allNodes.map((n) => [n.id, n]));

  const classifications = new Map<string, NodeClassification>();
  for (const n of nodes) {
    classifications.set(n.id, clsAll.get(n.id)!);
  }

  const internalEdges: CyberEdge[] = [];
  const crossLinks: HostArchCrossLink[] = [];

  for (const edge of allEdges) {
    const srcLocal = nodeMap.get(edge.source);
    const tgtLocal = nodeMap.get(edge.target);
    if (srcLocal && tgtLocal) {
      internalEdges.push(edge);
    } else if (srcLocal) {
      const peerNode = allNodeMap.get(edge.target);
      crossLinks.push({
        edge,
        direction: "outbound",
        localNode: srcLocal,
        peerNode,
        peerHostId: peerNode?.host ?? "__external",
      });
    } else if (tgtLocal) {
      const peerNode = allNodeMap.get(edge.source);
      crossLinks.push({
        edge,
        direction: "inbound",
        localNode: tgtLocal,
        peerNode,
        peerHostId: peerNode?.host ?? "__external",
      });
    }
  }

  const nonSelfEdges: CyberEdge[] = [];
  const selfLoops: CyberEdge[] = [];
  const rawInDeg = new Map<string, number>();
  const rawOutDeg = new Map<string, number>();

  for (const edge of internalEdges) {
    if (edge.source === edge.target) {
      selfLoops.push(edge);
    } else {
      nonSelfEdges.push(edge);
      rawOutDeg.set(edge.source, (rawOutDeg.get(edge.source) ?? 0) + 1);
      rawInDeg.set(edge.target, (rawInDeg.get(edge.target) ?? 0) + 1);
    }
  }

  const nodeLayer = new Map<string, number>();
  const flowLayer = new Map<string, number>();
  for (const n of nodes) {
    const cls = classifications.get(n.id)!;
    nodeLayer.set(n.id, cls.layerMeta.order);
    flowLayer.set(
      n.id,
      cls.boundaryRole === "egress" ? 4 : cls.layerMeta.order,
    );
  }

  // Classify upward cross-stratum links (e.g. App -> Boundary Ingress) and DFS cycles as feedback,
  // while treating flows terminating into a bottom Egress gate as downward forward exits.
  const sortedForDfs = [...nodes].sort((a, b) => {
    const lDiff = (flowLayer.get(a.id) ?? 1) - (flowLayer.get(b.id) ?? 1);
    if (lDiff !== 0) return lDiff;
    return (
      (rawOutDeg.get(b.id) ?? 0) - (rawOutDeg.get(a.id) ?? 0) ||
      a.label.localeCompare(b.label, "zh-CN")
    );
  });

  const outgoing = new Map<string, CyberEdge[]>();
  for (const n of nodes) outgoing.set(n.id, []);
  const upwardIds = new Set<string>();
  for (const edge of nonSelfEdges) {
    const sl = flowLayer.get(edge.source) ?? 1;
    const tl = flowLayer.get(edge.target) ?? 1;
    if (sl > tl) {
      upwardIds.add(edge.id);
    } else {
      outgoing.get(edge.source)?.push(edge);
    }
  }
  for (const list of outgoing.values()) {
    list.sort(
      (a, b) =>
        (flowLayer.get(a.target) ?? 1) - (flowLayer.get(b.target) ?? 1) ||
        a.target.localeCompare(b.target),
    );
  }

  const visitState = new Map<string, 0 | 1 | 2>();
  const backEdgeIds = new Set<string>(upwardIds);
  const dfs = (id: string) => {
    visitState.set(id, 1);
    for (const edge of outgoing.get(id) ?? []) {
      const state = visitState.get(edge.target) ?? 0;
      if (state === 1) {
        backEdgeIds.add(edge.id);
      } else if (state === 0) {
        dfs(edge.target);
      }
    }
    visitState.set(id, 2);
  };
  for (const n of sortedForDfs) {
    if ((visitState.get(n.id) ?? 0) === 0) dfs(n.id);
  }

  const dagEdges = nonSelfEdges.filter((e) => !backEdgeIds.has(e.id));
  const feedbackEdges = [
    ...nonSelfEdges.filter((e) => backEdgeIds.has(e.id)),
    ...selfLoops,
  ];

  const dagInEdges = new Map<string, CyberEdge[]>();
  for (const n of nodes) dagInEdges.set(n.id, []);
  for (const e of dagEdges) {
    dagInEdges.get(e.target)?.push(e);
  }

  const feedbackSenders = new Set<string>(
    feedbackEdges.filter((e) => e.source !== e.target).map((e) => e.source),
  );

  const orderedLayers: ArchLayer[] = ["boundary", "app", "infra", "middleware"];
  const byLayer = new Map<ArchLayer, CyberNode[]>(
    orderedLayers.map((l) => [l, []]),
  );
  for (const n of nodes) {
    byLayer.get(classifications.get(n.id)!.layer)!.push(n);
  }

  const parentPos = new Map<string, number>();
  const allTiers: HostArchTier[] = [];
  let boundaryTier: HostArchTier | undefined;

  for (const layerKey of orderedLayers) {
    const rawList = byLayer.get(layerKey)!;
    if (rawList.length === 0) continue;
    const sorted = [...rawList].sort((a, b) =>
      compareInStratum(
        a,
        b,
        classifications,
        rawInDeg,
        rawOutDeg,
        feedbackSenders,
        dagInEdges,
        parentPos,
      ),
    );
    sorted.forEach((n, idx) => parentPos.set(n.id, idx));

    const meta = ARCH_LAYER_META[layerKey];
    const tier: HostArchTier = {
      id: `tier-${layerKey}`,
      index: allTiers.length,
      layer: layerKey,
      isolation: meta.isolation,
      isolationLabel: meta.isolationLabel,
      isBoundary: layerKey === "boundary",
      title: meta.label,
      subtitle: meta.subtitle,
      nodes: sorted,
    };
    if (layerKey === "boundary") {
      boundaryTier = tier;
    }
    allTiers.push(tier);
  }

  return {
    hostId,
    nodes,
    classifications,
    categories: listOrderedCategories(options.categories),
    internalEdges,
    dagEdges,
    feedbackEdges,
    crossLinks,
    boundaryTier,
    tiers: allTiers,
    nodeLayer,
  };
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, "#quot;").replace(/\r?\n/g, " ").trim();
}

/**
 * Render a host's semantic stratified architecture as a clean Mermaid flowchart.
 */
export function hostArchitectureToMermaid(
  hostLabel: string,
  arch: HostArchitecture,
): string {
  const idMap = new Map<string, string>();
  arch.nodes.forEach((node, index) => {
    idMap.set(node.id, `n${index + 1}`);
  });

  const lines: string[] = [
    `%% ${hostLabel} 宿主机分层与隔离域架构`,
    "flowchart TD",
    `  classDef boundary fill:#133a3d,stroke:#34d399,stroke-width:2px,color:#eafffb;`,
    `  classDef app fill:#173244,stroke:#38bdf8,stroke-dasharray:4 3,color:#e6f6f7;`,
    `  classDef infra fill:#182b3a,stroke:#60a5fa,stroke-dasharray:4 3,color:#d5e8ef;`,
    `  classDef middleware fill:#1f2842,stroke:#fb7185,stroke-width:2px,color:#f5ebff;`,
  ];

  for (const tier of arch.tiers) {
    lines.push(
      `  subgraph ${tier.id}["${escapeMermaidLabel(tier.title)} (${escapeMermaidLabel(tier.isolationLabel)})"]`,
    );
    for (const node of tier.nodes) {
      const mId = idMap.get(node.id) ?? node.id;
      const cls = arch.classifications.get(node.id);
      const rolePrefix = cls?.boundaryMeta
        ? `[${cls.boundaryMeta.label}] `
        : "";
      const label = escapeMermaidLabel(`${rolePrefix}${node.label}`);
      if (cls?.layer === "middleware") {
        lines.push(`    ${mId}[("${label}")]:::middleware`);
      } else if (cls?.layer === "boundary") {
        lines.push(`    ${mId}{{"${label}"}}:::boundary`);
      } else if (cls?.layer === "infra") {
        lines.push(`    ${mId}["${label}"]:::infra`);
      } else {
        lines.push(`    ${mId}["${label}"]:::app`);
      }
    }
    lines.push("  end");
  }

  for (const edge of arch.dagEdges) {
    const s = idMap.get(edge.source);
    const t = idMap.get(edge.target);
    if (!s || !t) continue;
    const lbl = edge.label ? `|"${escapeMermaidLabel(edge.label)}"|` : "";
    lines.push(`  ${s} -->${lbl} ${t}`);
  }

  for (const edge of arch.feedbackEdges) {
    const s = idMap.get(edge.source);
    const t = idMap.get(edge.target);
    if (!s || !t) continue;
    const lbl = edge.label ? `|"${escapeMermaidLabel(edge.label)}"|` : "";
    lines.push(`  ${s} -.->${lbl} ${t}`);
  }

  return lines.join("\n");
}

export interface TopologyNodeItem {
  node: CyberNode;
  classification: NodeClassification;
  hostId: string;
  hostLabel: string;
  hostScope: "home" | "remote" | "external";
}

export interface TopologyRemoteCluster {
  hostId: string;
  hostLabel: string;
  provider?: string;
  region?: string;
  isolation: IsolationKind;
  boundaryNodes: TopologyNodeItem[];
  interiorNodes: TopologyNodeItem[];
}

export interface TopologyExcludedHostGroup {
  hostId: string;
  hostLabel: string;
  hostScope: "home" | "remote" | "external";
  nodes: TopologyNodeItem[];
}

export interface TopologyZoneModel {
  id: string;
  label: string;
  description?: string;
  isolation: IsolationKind;
  kind: "custom" | "local" | "mesh" | "remote" | "external";
  order: number;
  hostId?: string;
  provider?: string;
  region?: string;
  perimeter: {
    ingress: TopologyNodeItem[];
    dns: TopologyNodeItem[];
    egress: TopologyNodeItem[];
    mesh: TopologyNodeItem[];
  };
  strata: {
    app: TopologyNodeItem[];
    infra: TopologyNodeItem[];
    middleware: TopologyNodeItem[];
  };
  nodeCount: number;
}

export interface TopologyViewModel {
  inTopologyNodes: TopologyNodeItem[];
  outOfTopologyNodes: TopologyNodeItem[];
  excludedByHost: TopologyExcludedHostGroup[];
  activeEdges: CyberEdge[];
  quietEdgeIds: Set<string>;
  zones: TopologyZoneModel[];
  categories: ServiceCategoryMeta[];
  topologies: TopologyMeta[];
  localPerimeter: {
    ingress: TopologyNodeItem[];
    dns: TopologyNodeItem[];
    egress: TopologyNodeItem[];
  };
  localStrata: {
    app: TopologyNodeItem[];
    infra: TopologyNodeItem[];
    middleware: TopologyNodeItem[];
  };
  overlayMeshNodes: TopologyNodeItem[];
  remoteClusters: TopologyRemoteCluster[];
  externalNodes: TopologyNodeItem[];
  classifications: Map<string, NodeClassification>;
}

/**
 * Project the graph from a topology-first perspective ("machines are virtual labels,
 * the active logical topology + isolation boundaries are real"), cleanly separating members
 * inside vs outside the currently focused topology or category while honoring custom zones.
 */
export function buildTopologyViewModel({
  fullGraph,
  activeGraph,
  entities,
  services,
}: {
  fullGraph: CyberGraph;
  activeGraph: CyberGraph;
  entities: Entity[];
  services: Service[];
}): TopologyViewModel {
  const classifications = classifyCyberNodes(
    fullGraph.nodes,
    fullGraph.edges,
    services,
    { categories: fullGraph.categories, zones: fullGraph.zones },
  );
  const categories = listOrderedCategories(fullGraph.categories);
  const topologies = resolveTopologyRegistry(fullGraph);
  const entityMap = new Map(entities.map((e) => [e.id, e]));
  const cloudMap = new Map(fullGraph.clouds.map((c) => [c.host, c]));
  const activeNodeIds = new Set(activeGraph.nodes.map((n) => n.id));
  const isFiltered = activeGraph.nodes.length < fullGraph.nodes.length;

  const toItem = (node: CyberNode): TopologyNodeItem => {
    const hostId = node.host ?? "__external";
    const entity = entityMap.get(hostId);
    const hostScope: TopologyNodeItem["hostScope"] =
      hostId === "__external" || node.kind === "external"
        ? "external"
        : entity?.scope === "remote" || cloudMap.has(hostId)
          ? "remote"
          : "home";
    const hostLabel =
      hostScope === "external" ? "外部节点" : (entity?.name ?? hostId);
    return {
      node,
      classification: classifications.get(node.id)!,
      hostId,
      hostLabel,
      hostScope,
    };
  };

  const inTopologyNodes = activeGraph.nodes.map(toItem);
  const outOfTopologyNodes = fullGraph.nodes
    .filter((n) => !activeNodeIds.has(n.id))
    .map(toItem);

  const excludedMap = new Map<string, TopologyExcludedHostGroup>();
  for (const item of outOfTopologyNodes) {
    const existing = excludedMap.get(item.hostId);
    if (existing) {
      existing.nodes.push(item);
    } else {
      excludedMap.set(item.hostId, {
        hostId: item.hostId,
        hostLabel: item.hostLabel,
        hostScope: item.hostScope,
        nodes: [item],
      });
    }
  }
  const excludedByHost = [...excludedMap.values()].sort(
    (a, b) =>
      b.nodes.length - a.nodes.length ||
      a.hostLabel.localeCompare(b.hostLabel, "zh-CN"),
  );

  const localPerimeter: TopologyViewModel["localPerimeter"] = {
    ingress: [],
    dns: [],
    egress: [],
  };
  const localStrata: TopologyViewModel["localStrata"] = {
    app: [],
    infra: [],
    middleware: [],
  };
  const overlayMeshNodes: TopologyNodeItem[] = [];
  const externalNodes: TopologyNodeItem[] = [];
  const remoteMap = new Map<string, TopologyRemoteCluster>();

  const makeEmptyZone = (
    init: Omit<TopologyZoneModel, "perimeter" | "strata" | "nodeCount">,
  ): TopologyZoneModel => ({
    ...init,
    perimeter: { ingress: [], dns: [], egress: [], mesh: [] },
    strata: { app: [], infra: [], middleware: [] },
    nodeCount: 0,
  });

  const addItemToZone = (zone: TopologyZoneModel, item: TopologyNodeItem) => {
    const cls = item.classification;
    if (cls.layer === "boundary") {
      zone.perimeter[cls.boundaryRole ?? "ingress"].push(item);
    } else {
      zone.strata[cls.layer].push(item);
    }
    zone.nodeCount += 1;
  };

  const zoneMap = new Map<string, TopologyZoneModel>();
  for (const [idx, z] of (fullGraph.zones ?? []).entries()) {
    zoneMap.set(
      z.id,
      makeEmptyZone({
        id: z.id,
        label: z.label,
        description: z.description,
        isolation: z.isolation,
        kind: "custom",
        order: z.order ?? idx,
      }),
    );
  }

  const getOrCreateSyntheticZone = (
    item: TopologyNodeItem,
  ): TopologyZoneModel => {
    const cls = item.classification;
    if (cls.boundaryRole === "mesh") {
      const id = "__zone-mesh";
      let zone = zoneMap.get(id);
      if (!zone) {
        zone = makeEmptyZone({
          id,
          label: "Mesh 虚拟叠层域",
          description: "跨机加密通道（Tailscale / Overlay）",
          isolation: "virtual",
          kind: "mesh",
          order: 910,
        });
        zoneMap.set(id, zone);
      }
      return zone;
    }
    if (item.hostScope === "remote") {
      const id = `__zone-remote:${item.hostId}`;
      let zone = zoneMap.get(id);
      if (!zone) {
        const cloud = cloudMap.get(item.hostId);
        zone = makeEmptyZone({
          id,
          label: item.hostLabel,
          isolation: "strict",
          kind: "remote",
          order: 920,
          hostId: item.hostId,
          provider: cloud?.provider,
          region: cloud?.region,
        });
        zoneMap.set(id, zone);
      }
      return zone;
    }
    if (item.hostScope === "external") {
      const id = "__zone-external";
      let zone = zoneMap.get(id);
      if (!zone) {
        zone = makeEmptyZone({
          id,
          label: "外部节点 / 公网",
          isolation: "strict",
          kind: "external",
          order: 930,
        });
        zoneMap.set(id, zone);
      }
      return zone;
    }
    const id = "__zone-local";
    let zone = zoneMap.get(id);
    if (!zone) {
      zone = makeEmptyZone({
        id,
        label: "本地物理内网隔离域",
        description: "实体物理网络与边界网关所围隔离域",
        isolation: "strict",
        kind: "local",
        order: 900,
      });
      zoneMap.set(id, zone);
    }
    return zone;
  };

  const sortItems = (list: TopologyNodeItem[]) =>
    list.sort(
      (a, b) =>
        CYBER_NODE_SIZE_META[a.classification.size].order -
          CYBER_NODE_SIZE_META[b.classification.size].order ||
        a.classification.categoryMeta.order -
          b.classification.categoryMeta.order ||
        a.node.label.localeCompare(b.node.label, "zh-CN"),
    );

  for (const item of inTopologyNodes) {
    const cls = item.classification;
    const customZone = cls.zoneId ? zoneMap.get(cls.zoneId) : undefined;
    if (customZone) {
      addItemToZone(customZone, item);
    } else {
      addItemToZone(getOrCreateSyntheticZone(item), item);
    }

    if (cls.boundaryRole === "mesh") {
      overlayMeshNodes.push(item);
      continue;
    }

    if (item.hostScope === "external") {
      externalNodes.push(item);
      continue;
    }

    if (item.hostScope === "remote") {
      const cloud = cloudMap.get(item.hostId);
      let cluster = remoteMap.get(item.hostId);
      if (!cluster) {
        cluster = {
          hostId: item.hostId,
          hostLabel: item.hostLabel,
          provider: cloud?.provider,
          region: cloud?.region,
          isolation: "strict",
          boundaryNodes: [],
          interiorNodes: [],
        };
        remoteMap.set(item.hostId, cluster);
      }
      if (cls.layer === "boundary") {
        cluster.boundaryNodes.push(item);
      } else {
        cluster.interiorNodes.push(item);
      }
      continue;
    }

    // Local home physical network domain
    if (cls.layer === "boundary") {
      if (cls.boundaryRole === "dns") localPerimeter.dns.push(item);
      else if (cls.boundaryRole === "egress") localPerimeter.egress.push(item);
      else localPerimeter.ingress.push(item);
    } else if (cls.layer === "middleware") {
      localStrata.middleware.push(item);
    } else if (cls.layer === "infra") {
      localStrata.infra.push(item);
    } else {
      localStrata.app.push(item);
    }
  }

  sortItems(localPerimeter.ingress);
  sortItems(localPerimeter.dns);
  sortItems(localPerimeter.egress);
  sortItems(localStrata.app);
  sortItems(localStrata.infra);
  sortItems(localStrata.middleware);
  sortItems(overlayMeshNodes);
  sortItems(externalNodes);

  const zones = [...zoneMap.values()]
    .filter((z) => z.nodeCount > 0 || (z.kind === "custom" && !isFiltered))
    .map((z) => {
      sortItems(z.perimeter.ingress);
      sortItems(z.perimeter.dns);
      sortItems(z.perimeter.egress);
      sortItems(z.perimeter.mesh);
      sortItems(z.strata.app);
      sortItems(z.strata.infra);
      sortItems(z.strata.middleware);
      return z;
    })
    .sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label, "zh-CN"),
    );

  const remoteClusters = [...remoteMap.values()]
    .map((cluster) => ({
      ...cluster,
      boundaryNodes: sortItems(cluster.boundaryNodes),
      interiorNodes: sortItems(cluster.interiorNodes),
    }))
    .sort((a, b) => a.hostLabel.localeCompare(b.hostLabel, "zh-CN"));

  const quietEdgeIds = new Set(
    activeGraph.edges
      .filter((e) => isCyberEdgeQuiet(e, classifications))
      .map((e) => e.id),
  );

  return {
    inTopologyNodes,
    outOfTopologyNodes,
    excludedByHost,
    activeEdges: activeGraph.edges,
    quietEdgeIds,
    zones,
    categories,
    topologies,
    localPerimeter,
    localStrata,
    overlayMeshNodes,
    remoteClusters,
    externalNodes,
    classifications,
  };
}

/**
 * Produce an inspection summary of the current CyberView topology, resolved zones,
 * custom categories/topologies, per-node classification provenance, and host Mermaid architectures.
 */
export function buildCyberInspection(
  snapshot: Dashboard,
  options: {
    hostId?: string;
    group?: string;
    category?: ServiceCategory;
    includeMermaid?: boolean;
  } = {},
) {
  const fullGraph =
    snapshot.home.cyber ?? synthesizeDefaultCyberGraph(snapshot.home);
  const fullCls = classifyCyberNodes(
    fullGraph.nodes,
    fullGraph.edges,
    snapshot.home.services,
    { categories: fullGraph.categories, zones: fullGraph.zones },
  );
  let activeGraph = options.group
    ? graphGroup(fullGraph, options.group)
    : fullGraph;
  if (options.category) {
    activeGraph = filterCyberByCategory(activeGraph, options.category, fullCls);
  }
  const topo = buildTopologyViewModel({
    fullGraph,
    activeGraph,
    entities: snapshot.home.entities,
    services: snapshot.home.services,
  });

  const targetHostIds = options.hostId
    ? [options.hostId]
    : [
        ...new Set(
          activeGraph.nodes
            .map((n) => n.host)
            .filter((h): h is string => Boolean(h)),
        ),
      ];
  const entityMap = new Map(snapshot.home.entities.map((e) => [e.id, e]));
  const includeMermaid = options.includeMermaid !== false;
  const hosts = targetHostIds.map((hid) => {
    const label = entityMap.get(hid)?.name ?? hid;
    const arch = buildHostArchitecture(
      hid,
      activeGraph.nodes,
      activeGraph.edges,
      snapshot.home.services,
      { categories: fullGraph.categories, zones: fullGraph.zones },
    );
    return {
      hostId: hid,
      hostLabel: label,
      nodeCount: arch.nodes.length,
      tiers: arch.tiers.map((t) => ({
        id: t.id,
        layer: t.layer,
        isolation: t.isolation,
        title: t.title,
        nodeIds: t.nodes.map((n) => n.id),
      })),
      dagEdgeIds: arch.dagEdges.map((e) => e.id),
      feedbackEdgeIds: arch.feedbackEdges.map((e) => e.id),
      crossLinks: arch.crossLinks.map((c) => ({
        edgeId: c.edge.id,
        direction: c.direction,
        localNodeId: c.localNode.id,
        peerNodeId: c.peerNode?.id,
        peerHostId: c.peerHostId,
      })),
      ...(includeMermaid
        ? { mermaid: hostArchitectureToMermaid(label, arch) }
        : {}),
    };
  });

  return {
    revision: snapshot.revision,
    source: fullGraph.source,
    asOf: fullGraph.asOf,
    synthesized: !snapshot.home.cyber,
    filters: {
      hostId: options.hostId ?? null,
      group: options.group ?? null,
      category: options.category ?? null,
    },
    categories: topo.categories,
    topologies: topo.topologies,
    zones: topo.zones.map((z) => ({
      id: z.id,
      label: z.label,
      description: z.description,
      isolation: z.isolation,
      kind: z.kind,
      order: z.order,
      nodeCount: z.nodeCount,
      perimeter: {
        ingress: z.perimeter.ingress.map((i) => i.node.id),
        dns: z.perimeter.dns.map((i) => i.node.id),
        egress: z.perimeter.egress.map((i) => i.node.id),
        mesh: z.perimeter.mesh.map((i) => i.node.id),
      },
      strata: {
        app: z.strata.app.map((i) => i.node.id),
        infra: z.strata.infra.map((i) => i.node.id),
        middleware: z.strata.middleware.map((i) => i.node.id),
      },
    })),
    nodes: activeGraph.nodes.map((node) => {
      const cls = topo.classifications.get(node.id)!;
      return {
        ...node,
        effective: {
          size: cls.size,
          sizeSource: cls.sizeSource,
          layer: cls.layer,
          layerSource: cls.layerSource,
          boundaryRole: cls.boundaryRole,
          boundarySource: cls.boundarySource,
          category: cls.category,
          categorySource: cls.categorySource,
          zoneId: cls.zoneId,
          zoneSource: cls.zoneSource,
        },
      };
    }),
    edges: activeGraph.edges.map((edge) => ({
      ...edge,
      effectiveVisibility: topo.quietEdgeIds.has(edge.id) ? "hover" : "always",
    })),
    quietEdgeIds: [...topo.quietEdgeIds],
    excludedNodeIds: topo.outOfTopologyNodes.map((x) => x.node.id),
    hosts,
  };
}
