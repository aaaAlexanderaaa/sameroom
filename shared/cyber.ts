import { z } from "zod";
import { iconRefSchema } from "./icons.js";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/);
const shortId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const groups = z.array(z.string().trim().min(1).max(80)).max(20).default([]);

export const archLayerSchema = z.enum([
  "boundary",
  "app",
  "infra",
  "middleware",
]);
export const boundaryRoleSchema = z.enum(["ingress", "dns", "egress", "mesh"]);
export const builtinServiceCategories = [
  "boundary-net",
  "relay",
  "monitor",
  "admin",
  "automation",
  "workspace",
  "storage",
  "data",
] as const;
export const serviceCategorySchema = shortId;
export const isolationKindSchema = z.enum(["strict", "virtual"]);
export const cyberNodeSizeSchema = z.enum(["large", "medium", "small"]);
export const cyberEdgeVisibilitySchema = z.enum(["always", "hover"]);

export type ArchLayer = z.infer<typeof archLayerSchema>;
export type BoundaryRole = z.infer<typeof boundaryRoleSchema>;
export type BuiltinServiceCategory = (typeof builtinServiceCategories)[number];
export type ServiceCategory = string;
export type IsolationKind = z.infer<typeof isolationKindSchema>;
export type CyberNodeSize = z.infer<typeof cyberNodeSizeSchema>;
export type CyberEdgeVisibility = z.infer<typeof cyberEdgeVisibilitySchema>;

export const cyberNodeSchema = z.object({
  id,
  label: z.string().trim().min(1).max(120),
  host: id.optional(),
  serviceId: id.optional(),
  icon: iconRefSchema.optional(),
  kind: z
    .enum(["service", "database", "gateway", "external"])
    .default("service"),
  size: cyberNodeSizeSchema.optional(),
  layer: archLayerSchema.optional(),
  boundary: boundaryRoleSchema.optional(),
  category: serviceCategorySchema.optional(),
  zone: id.optional(),
  groups,
});

export const cyberEdgeSchema = z.object({
  id,
  source: id,
  target: id,
  label: z.string().max(120).optional(),
  visibility: cyberEdgeVisibilitySchema.optional(),
  groups,
});

export const cyberZoneSchema = z.object({
  id,
  label: z.string().trim().min(1).max(80),
  isolation: isolationKindSchema,
  hosts: z.array(id).max(100).optional(),
  groups: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  description: z.string().max(240).optional(),
  order: z.number().int().min(-100).max(1000).optional(),
});

export const cyberCategoryDefSchema = z.object({
  label: z.string().trim().min(1).max(60),
  shortLabel: z.string().trim().min(1).max(20).optional(),
  color: hexColor.optional(),
  defaultLayer: archLayerSchema.optional(),
  order: z.number().int().min(-100).max(1000).optional(),
});

export const cyberTopologyDefSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().max(240).optional(),
  color: hexColor.optional(),
  order: z.number().int().min(-100).max(1000).optional(),
});

export type CyberCategoryDef = z.infer<typeof cyberCategoryDefSchema>;
export type CyberTopologyDef = z.infer<typeof cyberTopologyDefSchema>;
export type CyberZoneDef = z.infer<typeof cyberZoneSchema>;

export const cyberSchema = z.object({
  version: z.literal(1),
  source: z.string().trim().min(1).max(120),
  asOf: z.string().datetime({ offset: true }),
  nodes: z.array(cyberNodeSchema).max(300),
  edges: z.array(cyberEdgeSchema).max(800),
  clouds: z
    .array(
      z.object({
        host: id,
        provider: z.string().min(1).max(80),
        region: z.string().min(1).max(80),
        direction: z.enum(["north", "south", "east", "west"]).default("south"),
      }),
    )
    .max(100)
    .default([]),
  zones: z.array(cyberZoneSchema).max(40).optional(),
  categories: z.record(shortId, cyberCategoryDefSchema).optional(),
  topologies: z
    .record(z.string().trim().min(1).max(80), cyberTopologyDefSchema)
    .optional(),
});

export type CyberGraph = z.infer<typeof cyberSchema>;

export function validateCyber(
  graph: CyberGraph,
  hosts: { id: string; lifecycle: string; scope: string }[],
  services: { id: string; entityId: string }[],
) {
  const nodes = new Set(graph.nodes.map((n) => n.id));
  if (
    nodes.size !== graph.nodes.length ||
    new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length
  ) {
    throw new Error("Cyber node and edge IDs must be unique.");
  }

  const zones = graph.zones ?? [];
  const zoneIds = new Set(zones.map((z) => z.id));
  if (zoneIds.size !== zones.length) {
    throw new Error("Cyber isolation zone IDs must be unique.");
  }
  for (const zone of zones) {
    for (const hostId of zone.hosts ?? []) {
      if (!hosts.some((h) => h.id === hostId && h.lifecycle === "active")) {
        throw new Error(
          `Unknown active host in cyber zone ${zone.id}: ${hostId}.`,
        );
      }
    }
  }

  for (const node of graph.nodes) {
    if (
      node.host &&
      !hosts.some((h) => h.id === node.host && h.lifecycle === "active")
    ) {
      throw new Error(`Unknown active cyber host: ${node.host}.`);
    }
    if (!node.host && node.kind !== "external") {
      throw new Error(
        "A local service needs a host; use external for an external endpoint.",
      );
    }
    if (
      node.serviceId &&
      !services.some((s) => s.id === node.serviceId && s.entityId === node.host)
    ) {
      throw new Error("Cyber service ownership does not match.");
    }
    if (node.zone && !zoneIds.has(node.zone)) {
      throw new Error(`Unknown cyber zone: ${node.zone}.`);
    }
  }

  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) {
      throw new Error("Cyber edge endpoint is missing.");
    }
  }
  if (new Set(graph.clouds.map((c) => c.host)).size !== graph.clouds.length) {
    throw new Error("Duplicate cloud host.");
  }
  for (const cloud of graph.clouds) {
    if (
      !hosts.some(
        (h) =>
          h.id === cloud.host &&
          h.scope === "remote" &&
          h.lifecycle === "active",
      )
    ) {
      throw new Error("Cloud anchors require an active remote host.");
    }
  }
}

export function graphGroup(graph: CyberGraph, group: string): CyberGraph {
  if (!group) return graph;
  const edges = graph.edges.filter((e) => e.groups.includes(group));
  const endpoints = new Set(edges.flatMap((e) => [e.source, e.target]));
  return {
    ...graph,
    edges,
    nodes: graph.nodes.filter(
      (n) => endpoints.has(n.id) || n.groups.includes(group),
    ),
  };
}
