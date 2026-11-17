import { z } from "zod";
import { validateSpatialRelations } from "./spatial.js";
import { modelSourceSchema } from "./model-source.js";
import { interiorSchema } from "./compartments.js";
import {
  archLayerSchema,
  boundaryRoleSchema,
  cyberEdgeSchema,
  cyberNodeSchema,
  cyberNodeSizeSchema,
  cyberSchema,
  cyberZoneSchema,
  serviceCategorySchema,
  validateCyber,
} from "./cyber.js";
import { iconRefSchema } from "./icons.js";
import { entityGuestSchema, hotspotSchema } from "./guest.js";

export const idSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/);
const text = z.string().trim().min(1).max(160);
const coordinate = z.number().finite().min(-100).max(100);
export const positionSchema = z.tuple([coordinate, coordinate, coordinate]);
export const structuralKinds = [
  "window-marker",
  "door-marker",
  "wall-return",
] as const;
export const deviceKinds = [
  "mac-mini",
  "mini-pc",
  "single-board",
  "desktop-pc",
  "air-conditioner",
  "smart-speaker",
  "homepod-mini",
  "smart-strip",
  "smart-switch",
  "ceiling-light",
  "laptop",
  "desktop-speaker",
  "desk-lamp",
] as const;
export const furnitureKinds = [
  "table",
  "bed",
  "wardrobe",
  "shelf",
  "cabinet",
  "chair",
  "sofa",
  "fridge",
  "washer",
  "sink",
  "toilet",
  "screen",
  "rug",
  "gaming-chair",
  "metal-shelf",
  "drawer-cabinet",
  "bedside-cabinet",
  "display-cabinet",
  "glass-cabinet",
  "mini-fridge",
  "kitchen-counter",
  "keyboard",
  "mouse",
  "microphone",
  "mug",
  "headphones",
  "fan",
  "beanbag",
  "bench",
  "sliding-door",
  "litter-tray",
  "privacy-screen",
  "pegboard",
  "round-storage-table",
  "armchair",
  "wall-display",
  "monitor-arm",
  "dual-monitor-arm",
] as const;
export const roomSchema = z.object({
  id: idSchema,
  name: text,
  kind: z.enum(["room", "unplaced", "remote"]),
  origin: positionSchema,
  size: z.tuple([z.number().min(1).max(30), z.number().min(1).max(30)]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  footprint: z
    .array(z.tuple([coordinate, coordinate]))
    .min(3)
    .max(40)
    .optional(),
});
const localModelUrl = z
  .string()
  .regex(/^\/(models|generated)\/[a-zA-Z0-9_./-]+\.glb$/)
  .refine((v) => !v.includes(".."));
export const attachmentSchema = z.object({
  parentId: idSchema,
  kind: z.enum(["surface", "storage", "mount"]),
  slot: z.number().int().min(0).max(4095).optional(),
  compartmentId: idSchema.optional(),
});
export const storageSchema = z.object({
  entityId: idSchema,
  columns: z.number().int().min(1).max(8),
  rows: z.number().int().min(1).max(8),
  interior: interiorSchema.optional(),
});
export const photosSchema = z
  .array(z.string().regex(/^\/api\/uploads\/[a-f0-9]{64}$/))
  .max(8);
export const assetSchema = z.object({
  id: idSchema,
  name: text,
  kind: z.enum([
    "computer",
    "server",
    "plug",
    "box",
    "plant",
    "glb",
    "label",
    "bottle",
    "bag",
    ...deviceKinds,
    ...structuralKinds,
    ...furnitureKinds,
  ]),
  url: z
    .string()
    .regex(/^\/(models|generated)\/[a-zA-Z0-9_./-]+\.glb$/)
    .refine((v) => !v.includes(".."))
    .optional(),
  width: z.number().positive().max(10),
  height: z.number().positive().max(10),
  depth: z.number().positive().max(10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  provenance: z.string().max(300),
  source: modelSourceSchema.optional(),
  variant: z.object({ group: idSchema, label: text }).optional(),
  detailUrl: localModelUrl.optional(),
  modelRotation: z.number().finite().optional(),
  front: z.number().finite().optional(),
  stand: z.enum(["base", "arm"]).optional(),
  glassPanels: z
    .array(z.enum(["front", "left", "right"]))
    .max(3)
    .optional(),
  lightTilt: z
    .number()
    .min(-Math.PI / 2)
    .max(Math.PI / 2)
    .optional(),
});
export const entitySchema = z.object({
  id: idSchema,
  name: text,
  category: z.enum(["host", "device", "object"]),
  scope: z.enum(["home", "remote"]),
  lifecycle: z.enum(["active", "retired"]),
  locationId: idSchema,
  position: positionSchema,
  rotation: z.number().finite().default(0),
  placementConfirmed: z.boolean(),
  assetId: idSchema,
  description: z.string().max(2000).default(""),
  notes: z.string().max(4000).default(""),
  photos: photosSchema.optional(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  source: z.enum(["owner", "sample", "user"]),
  asOf: z.string().max(40),
  visibility: z.enum(["always", "editing"]).optional(),
  attachment: attachmentSchema.optional(),
  guest: entityGuestSchema.optional(),
});
const serviceUrl = z
  .string()
  .url()
  .max(2048)
  .refine(
    (v) =>
      ["https:", "http:"].includes(new URL(v).protocol) &&
      !new URL(v).username &&
      !new URL(v).password,
  );
export const serviceSchema = z.object({
  id: idSchema,
  entityId: idSchema,
  name: text,
  version: z.string().max(100),
  url: serviceUrl.optional(),
  embed: z.enum(["unverified", "allowed", "link"]),
  icon: iconRefSchema.optional(),
  description: z.string().max(1000),
  size: cyberNodeSizeSchema.optional(),
  layer: archLayerSchema.optional(),
  boundary: boundaryRoleSchema.optional(),
  category: serviceCategorySchema.optional(),
  zone: cyberZoneSchema.shape.id.optional(),
  groups: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  asOf: z.string().max(40),
  demo: z.boolean().default(false),
});
export const stockSchema = z.object({
  id: idSchema,
  name: text,
  sku: idSchema,
  unit: z.string().min(1).max(30),
  quantity: z.number().int().min(0).max(100000),
  threshold: z.number().int().min(0).max(100000),
  locationId: idSchema,
  position: positionSchema,
  rotation: z.number().finite().optional(),
  assetId: idSchema,
  capacity: z.number().int().min(1).max(100000),
  sample: z.boolean(),
  attachment: attachmentSchema.optional(),
  photos: photosSchema.optional(),
  notes: z.string().max(4000).optional(),
});
export const electricalCircuitSchema = z.object({
  id: idSchema,
  name: text,
  controllerEntityId: idSchema,
  metering: z.enum(["none", "aggregate", "per-outlet"]),
  channels: z
    .array(
      z.object({
        id: idSchema,
        name: text,
        outlet: z.number().int().min(1).max(64).optional(),
        entityIds: z.array(idSchema).min(1).max(100),
      }),
    )
    .min(1)
    .max(64),
  source: z.enum(["owner", "sample", "user"]),
  asOf: z.string().min(1).max(40),
});
export type ElectricalCircuit = z.infer<typeof electricalCircuitSchema>;
export const templateSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: text,
  description: z.string().max(2000),
  schematic: z.boolean(),
  sourceLabel: z.string().max(300),
  rooms: z.array(roomSchema).min(1).max(40),
  assets: z.array(assetSchema).max(300),
  entities: z.array(entitySchema).max(2000),
  services: z.array(serviceSchema).max(4000),
  stocks: z.array(stockSchema).max(500),
  openQuestions: z.array(z.string().max(600)).max(30),
  electricalCircuits: z.array(electricalCircuitSchema).max(200).optional(),
  storage: z.array(storageSchema).max(500).optional(),
  cyber: cyberSchema.optional(),
  hotspots: z.array(hotspotSchema).max(200).optional(),
  guestTitle: z.string().trim().max(160).optional(),
  guestSubtitle: z.string().trim().max(400).optional(),
});
export type HomeTemplate = z.infer<typeof templateSchema>;
export type Room = z.infer<typeof roomSchema>;
export type Entity = z.infer<typeof entitySchema>;
export type Stock = z.infer<typeof stockSchema>;
export type SceneAsset = z.infer<typeof assetSchema>;
export type Service = z.infer<typeof serviceSchema>;

export const eventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: idSchema,
  source: idSchema.refine(
    (v) => !v.startsWith("demo."),
    "demo. is reserved for explicit demo events",
  ),
  subjectId: idSchema,
  condition: z.enum(["availability", "maintenance", "power"]),
  status: z.enum(["open", "resolved"]),
  severity: z.enum(["info", "warning", "critical"]),
  message: z.string().min(1).max(1000),
  observedAt: z.string().datetime({ offset: true }),
  ttlSeconds: z.number().int().min(10).max(86400).default(300),
});
export type IngestEvent = z.infer<typeof eventSchema>;
export interface Observation extends IngestEvent {
  receivedAt: string;
  demo: boolean;
}
export interface Incident {
  id: string;
  source: string;
  subjectId: string;
  condition: IngestEvent["condition"];
  severity: IngestEvent["severity"];
  message: string;
  state: "open" | "acknowledged" | "resolved";
  firstSeen: string;
  updatedAt: string;
  count: number;
  demo: boolean;
}
export interface Receipt {
  operationId: string;
  revision: number;
  at: string;
  action: string;
  result: Record<string, unknown>;
  actor: string;
}
export interface Dashboard {
  schemaVersion: 1;
  revision: number;
  home: HomeTemplate;
  observations: Observation[];
  incidents: Incident[];
  unmapped: Observation[];
  activity: Receipt[];
}
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cyber.replace"), graph: cyberSchema }),
  z.object({
    type: z.literal("cyber.node.upsert"),
    node: cyberNodeSchema,
    previousId: cyberNodeSchema.shape.id.optional(),
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.node.delete"),
    id: cyberNodeSchema.shape.id,
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.edge.upsert"),
    edge: cyberEdgeSchema,
    previousId: cyberEdgeSchema.shape.id.optional(),
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.edge.delete"),
    id: cyberEdgeSchema.shape.id,
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.zone.upsert"),
    zone: cyberZoneSchema,
    previousId: cyberZoneSchema.shape.id.optional(),
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.zone.delete"),
    id: cyberZoneSchema.shape.id,
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("cyber.taxonomy.upsert"),
    categories: cyberSchema.shape.categories,
    topologies: cyberSchema.shape.topologies,
    deleteCategories: z.array(serviceCategorySchema).max(32).optional(),
    deleteTopologies: z
      .array(z.string().trim().min(1).max(80))
      .max(32)
      .optional(),
    replaceCategories: z.boolean().optional(),
    replaceTopologies: z.boolean().optional(),
    asOf: z.string().max(40).optional(),
  }),
  z.object({
    type: z.literal("item.record"),
    asset: assetSchema,
    item: z.union([entitySchema, stockSchema]),
    containerId: idSchema.optional(),
    compartmentId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("item.photos"),
    itemId: idSchema,
    photos: photosSchema,
  }),
  z.object({
    type: z.literal("object.mount"),
    entityId: idSchema,
    parentId: idSchema,
  }),
  z.object({ type: z.literal("storage.configure"), storage: storageSchema }),
  z.object({
    type: z.literal("storage.place"),
    itemId: idSchema,
    containerId: idSchema,
    slot: z.number().int().min(0).max(4095).optional(),
    compartmentId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("surface.place"),
    itemId: idSchema,
    supportId: idSchema,
    preferred: z.tuple([coordinate, coordinate]).optional(),
    quarterTurn: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("item.release"),
    itemId: idSchema,
    locationId: idSchema,
  }),
  z.object({
    type: z.literal("object.model"),
    entityId: idSchema,
    asset: assetSchema,
  }),
  z.object({
    type: z.literal("layout.commit"),
    rooms: z.array(roomSchema).min(1).max(40).optional(),
    additions: z
      .array(z.object({ entity: entitySchema, asset: assetSchema }))
      .max(200)
      .default([]),
    placements: z
      .array(
        z.object({
          kind: z.enum(["entity", "stock"]),
          id: idSchema,
          locationId: idSchema,
          position: positionSchema,
          rotation: z.number().finite(),
          placementConfirmed: z.boolean(),
          asset: assetSchema.optional(),
        }),
      )
      .max(2500)
      .default([]),
  }),
  z.object({
    type: z.literal("stock.adjust"),
    stockId: idSchema,
    delta: z
      .number()
      .int()
      .min(-10000)
      .max(10000)
      .refine((v) => v !== 0),
  }),
  z.object({
    type: z.literal("stock.transfer"),
    fromId: idSchema,
    toId: idSchema,
    quantity: z.number().int().positive().max(10000),
  }),
  z.object({ type: z.literal("stock.create"), stock: stockSchema }),
  z.object({
    type: z.literal("entity.place"),
    entityId: idSchema,
    locationId: idSchema,
    position: positionSchema,
    rotation: z.number().finite().default(0),
  }),
  z.object({
    type: z.literal("entity.note"),
    entityId: idSchema,
    notes: z.string().max(4000),
  }),
  z
    .object({
      type: z.literal("entity.describe"),
      entityId: idSchema,
      name: text.optional(),
      description: z.string().max(2000).optional(),
      visibility: z.enum(["always", "editing"]).optional(),
    })
    .refine(
      (a) =>
        a.name !== undefined ||
        a.description !== undefined ||
        a.visibility !== undefined,
      "Provide a description field to change.",
    ),
  z.object({ type: z.literal("entity.create"), entity: entitySchema }),
  z.object({
    type: z.literal("object.capture"),
    entity: entitySchema,
    asset: assetSchema,
    supportId: idSchema.optional(),
  }),
  z.object({
    type: z.literal("stock.asset"),
    stockId: idSchema,
    asset: assetSchema,
  }),
  z.object({
    type: z.literal("entity.asset"),
    entityId: idSchema,
    assetId: idSchema,
  }),
  z.object({ type: z.literal("asset.upsert"), asset: assetSchema }),
  z.object({ type: z.literal("room.update"), room: roomSchema }),
  z.object({ type: z.literal("service.upsert"), service: serviceSchema }),
  z.object({
    type: z.literal("electrical.upsert"),
    circuit: electricalCircuitSchema,
  }),
  z.object({ type: z.literal("hotspot.upsert"), hotspot: hotspotSchema }),
  z.object({ type: z.literal("hotspot.delete"), hotspotId: idSchema }),
  z.object({
    type: z.literal("entity.guest"),
    entityId: idSchema,
    guest: entityGuestSchema,
  }),
  z.object({ type: z.literal("incident.ack"), incidentId: idSchema }),
  z.object({ type: z.literal("template.import"), template: templateSchema }),
]);
export const commandSchema = z.object({
  operationId: z.string().uuid(),
  expectedRevision: z.number().int().min(0),
  issuedAt: z.string().datetime({ offset: true }),
  action: actionSchema,
});
export type Command = z.infer<typeof commandSchema>;
export type Action = Command["action"];

type FloorPoint = [number, number];
const cross = (a: FloorPoint, b: FloorPoint, c: FloorPoint) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const onSegment = (p: FloorPoint, a: FloorPoint, b: FloorPoint) =>
  Math.abs(cross(a, b, p)) < 1e-7 &&
  p[0] >= Math.min(a[0], b[0]) - 1e-7 &&
  p[0] <= Math.max(a[0], b[0]) + 1e-7 &&
  p[1] >= Math.min(a[1], b[1]) - 1e-7 &&
  p[1] <= Math.max(a[1], b[1]) + 1e-7;
function segmentsIntersect(
  a: FloorPoint,
  b: FloorPoint,
  c: FloorPoint,
  d: FloorPoint,
) {
  return (
    (cross(a, b, c) * cross(a, b, d) < 0 &&
      cross(c, d, a) * cross(c, d, b) < 0) ||
    onSegment(a, c, d) ||
    onSegment(b, c, d) ||
    onSegment(c, a, b) ||
    onSegment(d, a, b)
  );
}
export function pointInFootprint(x: number, z: number, points: FloorPoint[]) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j],
      b = points[i];
    if (onSegment([x, z], a, b)) return true;
    if (
      a[1] > z !== b[1] > z &&
      x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}
export function resizedRoom(room: Room, size: [number, number]): Room {
  // Controlled numeric inputs can briefly be empty/zero while being replaced.
  // Keep the last valid polygon rather than collapsing it and dividing by zero.
  if (!roomSchema.shape.size.safeParse(size).success) return room;
  return {
    ...room,
    size,
    ...(room.footprint
      ? {
          footprint: room.footprint.map(
            ([x, z]) =>
              [
                (x * size[0]) / room.size[0],
                (z * size[1]) / room.size[1],
              ] as FloorPoint,
          ),
        }
      : {}),
  };
}

export function validateTemplate(value: unknown): HomeTemplate {
  const home = templateSchema.parse(value);
  if (home.cyber) validateCyber(home.cyber, home.entities, home.services);
  validateSpatialRelations(home);
  for (const items of [
    home.rooms,
    home.assets,
    home.entities,
    home.services,
    home.stocks,
  ]) {
    if (new Set(items.map((v) => v.id)).size !== items.length)
      throw new Error("Duplicate identifiers in template.");
  }
  if (
    new Set(
      [...home.entities, ...home.services, ...home.stocks].map((v) => v.id),
    ).size !==
    home.entities.length + home.services.length + home.stocks.length
  ) {
    throw new Error("Entity, service and stock identifiers must be distinct.");
  }
  const rooms = new Map(home.rooms.map((v) => [v.id, v]));
  for (const room of home.rooms) {
    if (!room.footprint) continue;
    const points = room.footprint;
    if (
      points.some(
        ([x, z]) =>
          Math.abs(x) > room.size[0] / 2 + 1e-7 ||
          Math.abs(z) > room.size[1] / 2 + 1e-7,
      )
    )
      throw new Error("Room footprint exceeds size bounds.");
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6)
        throw new Error("Room footprint has a zero-length edge.");
      area += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 2; j < points.length; j++) {
        if (i === 0 && j === points.length - 1) continue;
        if (segmentsIntersect(a, b, points[j], points[(j + 1) % points.length]))
          throw new Error("Room footprint crosses itself.");
      }
    }
    if (Math.abs(area) < 0.02)
      throw new Error("Room footprint has no usable area.");
  }
  for (const item of [...home.entities, ...home.stocks]) {
    const room = rooms.get(item.locationId);
    if (!room || !home.assets.some((a) => a.id === item.assetId))
      throw new Error(`Unknown location/asset for ${item.id}.`);
    const asset = home.assets.find((a) => a.id === item.assetId)!;
    if (
      Math.abs(item.position[0]) > room.size[0] / 2 ||
      Math.abs(item.position[2]) > room.size[1] / 2 ||
      item.position[1] < 0
    )
      throw new Error(`Position outside location: ${item.id}.`);
    if (
      room.footprint &&
      !(structuralKinds as readonly string[]).includes(asset.kind) &&
      !pointInFootprint(item.position[0], item.position[2], room.footprint)
    )
      throw new Error(`Position outside floor footprint: ${item.id}.`);
    if (
      "scope" in item &&
      (item.scope === "remote") !== (room.kind === "remote")
    )
      throw new Error(`Remote/home location mismatch: ${item.id}.`);
  }
  for (const service of home.services) {
    const owner = home.entities.find((e) => e.id === service.entityId);
    if (!owner || owner.lifecycle === "retired")
      throw new Error(`Service owner missing or retired: ${service.id}.`);
  }
  const circuits = home.electricalCircuits ?? [];
  const controllers = new Set(circuits.map((c) => c.controllerEntityId));
  if (
    new Set(circuits.map((c) => c.id)).size !== circuits.length ||
    controllers.size !== circuits.length
  )
    throw new Error("Duplicate electrical circuit/controller.");
  const loads = new Set<string>();
  const activeHome = (id: string) =>
    home.entities.find(
      (e) => e.id === id && e.scope === "home" && e.lifecycle === "active",
    );
  for (const circuit of circuits) {
    const controller = activeHome(circuit.controllerEntityId);
    const kind = home.assets.find((a) => a.id === controller?.assetId)?.kind;
    if (
      !controller ||
      controller.category !== "device" ||
      !["plug", "smart-strip", "smart-switch"].includes(kind ?? "")
    )
      throw new Error(
        "Electrical controller must be an active home plug, strip or switch.",
      );
    if (circuit.metering === "per-outlet" && kind !== "smart-strip")
      throw new Error("Per-outlet metering requires a smart strip.");
    if (kind === "smart-switch" && circuit.metering !== "none")
      throw new Error("Switch metering is not established.");
    if (circuit.metering !== "per-outlet" && circuit.channels.length !== 1)
      throw new Error(
        "Aggregate or unmetered circuits need one shared channel.",
      );
    const outlets = circuit.channels.flatMap((c) =>
      c.outlet === undefined ? [] : [c.outlet],
    );
    if (
      new Set(circuit.channels.map((c) => c.id)).size !==
        circuit.channels.length ||
      new Set(outlets).size !== outlets.length
    )
      throw new Error("Duplicate electrical channel/outlet.");
    for (const channel of circuit.channels)
      for (const id of channel.entityIds) {
        if (!activeHome(id) || controllers.has(id))
          throw new Error(
            "Electrical load must be an active home entity, not a controller.",
          );
        if (loads.has(id))
          throw new Error("Electrical load already has a supply channel.");
        loads.add(id);
      }
  }
  const hotspots = home.hotspots ?? [];
  if (new Set(hotspots.map((h) => h.id)).size !== hotspots.length)
    throw new Error("Duplicate hotspot identifiers in template.");
  for (const hotspot of hotspots) {
    if (hotspot.anchor.kind === "room") {
      const room = rooms.get(hotspot.anchor.locationId);
      if (!room || room.kind !== "room")
        throw new Error(
          `Hotspot room must be a physical room: ${hotspot.id}.`,
        );
      const [hx, hy, hz] = hotspot.anchor.position;
      if (
        Math.abs(hx) > room.size[0] / 2 ||
        Math.abs(hz) > room.size[1] / 2 ||
        hy < 0 ||
        hy > 12 ||
        (room.footprint && !pointInFootprint(hx, hz, room.footprint))
      )
        throw new Error(`Hotspot position outside room: ${hotspot.id}.`);
    } else {
      const target = activeHome(hotspot.anchor.entityId);
      if (
        !target ||
        target.visibility === "editing" ||
        target.attachment?.kind === "storage"
      )
        throw new Error(
          `Hotspot entity must be a visible active home entity: ${hotspot.id}.`,
        );
    }
    if (hotspot.effect.kind === "spotlight" && hotspot.effect.targetEntityId) {
      const target = activeHome(hotspot.effect.targetEntityId);
      if (!target || target.visibility === "editing")
        throw new Error(
          `Spotlight target must be a visible active home entity: ${hotspot.id}.`,
        );
    }
    if (hotspot.effect.kind === "variant") {
      const target = activeHome(hotspot.effect.entityId);
      if (!target || target.visibility === "editing")
        throw new Error(
          `Variant hotspot target must be a visible active home entity: ${hotspot.id}.`,
        );
      if (hotspot.effect.assetIds) {
        for (const aid of hotspot.effect.assetIds) {
          if (!home.assets.some((a) => a.id === aid))
            throw new Error(`Unknown variant asset ${aid} in ${hotspot.id}.`);
        }
      }
    }
  }
  return home;
}
export function observationState(
  observation: Observation | undefined,
  now = Date.now(),
) {
  if (!observation) return "unknown";
  if (now - Date.parse(observation.observedAt) > observation.ttlSeconds * 1000)
    return "stale";
  return observation.status === "resolved" ? "up" : "down";
}
export function entityObservation(state: Dashboard, entityId: string) {
  return state.observations
    .filter((o) => o.subjectId === entityId && o.condition === "availability")
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
}
export const stockVisibleLimit = 24;
