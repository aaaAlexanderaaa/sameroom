import { z } from "zod";
import {
  cyberEdgeSchema,
  cyberNodeSchema,
  cyberSchema,
  cyberZoneSchema,
  serviceCategorySchema,
} from "./cyber.js";
import {
  actionSchema,
  assetSchema,
  type Dashboard,
  electricalCircuitSchema,
  entitySchema,
  eventSchema,
  idSchema,
  serviceSchema,
  stockSchema,
} from "./domain.js";
import { entityGuestSchema, hotspotSchema } from "./guest.js";

export const stateSectionSchema = z.enum([
  "all",
  "summary",
  "rooms",
  "entities",
  "services",
  "stocks",
  "cyber",
  "electrical",
  "incidents",
]);
export type StateSection = z.infer<typeof stateSectionSchema>;

export const getHomeStateInput = z.object({
  section: stateSectionSchema
    .optional()
    .describe(
      "Which slice to return. Use 'summary' for compact counts + IDs + revision, or 'all' (default) for full dashboard state.",
    ),
});

export const listIconsInput = z.object({});

export const listImportedModelsInput = z.object({});

const commandMetaShape = {
  expectedRevision: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional optimistic-concurrency revision; defaults to latest."),
  operationId: z
    .string()
    .uuid()
    .optional()
    .describe("Optional UUID for caller-managed idempotent retries."),
  issuedAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      "Optional ISO-8601 timestamp with offset; reuse the same value with operationId on idempotent retries.",
    ),
};

export const upsertServiceInput = z.object({
  service: serviceSchema.describe(
    "Complete service definition including id, entityId, name, version, embed, description, asOf, and optional icon, size ('large'|'medium'|'small'), layer, boundary, category, zone, or groups.",
  ),
  ...commandMetaShape,
});

export const replaceCyberGraphInput = z.object({
  graph: cyberSchema.describe(
    "Complete cyber topology snapshot (version, source, asOf, nodes with optional size/layer/boundary/category/zone/icon/groups, edges with optional visibility, optional clouds, zones, categories, topologies).",
  ),
  ...commandMetaShape,
});

export const inspectCyberArchitectureInput = z.object({
  hostId: cyberNodeSchema.shape.host
    .optional()
    .describe(
      "Optional host entity ID to inspect a focused host architecture + Mermaid diagram.",
    ),
  group: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .optional()
    .describe("Optional logical topology group filter."),
  category: serviceCategorySchema
    .optional()
    .describe("Optional functional category filter."),
  includeMermaid: z
    .boolean()
    .optional()
    .describe("Include host Mermaid flowchart text (default true)."),
});

export const upsertCyberNodeInput = z.object({
  node: cyberNodeSchema.describe(
    "Cyber node definition (id, label, optional host, serviceId, icon, kind, size 'large'|'medium'|'small', layer, boundary, category, zone, groups).",
  ),
  previousId: cyberNodeSchema.shape.id
    .optional()
    .describe(
      "Optional prior node ID when renaming an existing node in place.",
    ),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const deleteCyberNodeInput = z.object({
  id: cyberNodeSchema.shape.id.describe(
    "Cyber node ID to delete (incident edges are pruned atomically).",
  ),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const upsertCyberEdgeInput = z.object({
  edge: cyberEdgeSchema.describe(
    "Cyber edge definition (id, source, target, optional label, visibility 'always'|'hover', and groups).",
  ),
  previousId: cyberEdgeSchema.shape.id
    .optional()
    .describe("Optional prior edge ID when renaming an existing edge."),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const deleteCyberEdgeInput = z.object({
  id: cyberEdgeSchema.shape.id.describe("Cyber edge ID to delete."),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const upsertCyberZoneInput = z.object({
  zone: cyberZoneSchema.describe(
    "Cyber isolation zone definition (id, label, isolation 'strict'|'virtual', optional hosts, groups, description, order).",
  ),
  previousId: cyberZoneSchema.shape.id
    .optional()
    .describe("Optional prior zone ID when renaming an existing zone."),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const deleteCyberZoneInput = z.object({
  id: cyberZoneSchema.shape.id.describe(
    "Cyber isolation zone ID to delete (dangling node/service zone references are cleared).",
  ),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const configureCyberTaxonomyInput = z.object({
  categories: cyberSchema.shape.categories.describe(
    "Custom functional category definitions keyed by category ID (label, shortLabel, color, defaultLayer, order).",
  ),
  topologies: cyberSchema.shape.topologies.describe(
    "Custom logical topology metadata keyed by group ID (label, description, color, order).",
  ),
  deleteCategories: z
    .array(serviceCategorySchema)
    .max(32)
    .optional()
    .describe("Optional custom category IDs to remove."),
  deleteTopologies: z
    .array(z.string().trim().min(1).max(80))
    .max(32)
    .optional()
    .describe("Optional custom topology metadata IDs to remove."),
  replaceCategories: z
    .boolean()
    .optional()
    .describe("Replace entire custom category map instead of merging."),
  replaceTopologies: z
    .boolean()
    .optional()
    .describe(
      "Replace entire custom topology metadata map instead of merging.",
    ),
  asOf: z.string().max(40).optional(),
  ...commandMetaShape,
});

export const upsertElectricalCircuitInput = z.object({
  circuit: electricalCircuitSchema.describe(
    "Physical power controller & named load channels definition.",
  ),
  ...commandMetaShape,
});

export const uploadIconInput = z.object({
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("Display name for the icon in the standalone local icon library"),
  imageBase64: z
    .string()
    .min(1)
    .max(6_000_000)
    .describe(
      "Base64 string or data URL of a PNG, JPEG, WebP, GIF, or SVG image (up to 4 MiB decoded)",
    ),
});

export const recordItemInput = z.object({
  asset: assetSchema.describe("Appearance asset record matching item.assetId."),
  item: z
    .union([entitySchema, stockSchema])
    .describe("Individual entity or stock balance record to create."),
  containerId: idSchema
    .optional()
    .describe("Optional cabinet/container entity ID for immediate placement."),
  compartmentId: idSchema
    .optional()
    .describe("Optional compartment leaf ID inside containerId."),
  ...commandMetaShape,
});

export const adjustStockInput = z.object({
  mode: z
    .enum(["adjust", "transfer"])
    .optional()
    .describe(
      "Use 'adjust' (default) to add/subtract delta, or 'transfer' to move quantity.",
    ),
  stockId: idSchema
    .optional()
    .describe("Target stockId when mode is 'adjust'."),
  delta: z
    .number()
    .int()
    .min(-10000)
    .max(10000)
    .optional()
    .describe("Nonzero signed quantity delta when mode is 'adjust'."),
  fromId: idSchema
    .optional()
    .describe("Source stockId when mode is 'transfer'."),
  toId: idSchema
    .optional()
    .describe("Destination stockId when mode is 'transfer'."),
  quantity: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe("Positive quantity to transfer when mode is 'transfer'."),
  ...commandMetaShape,
});

export const acknowledgeIncidentInput = z.object({
  incidentId: idSchema.describe(
    "Existing unresolved incident ID to acknowledge.",
  ),
  ...commandMetaShape,
});

export const ingestEventInput = z.object({
  event: eventSchema.describe(
    "Normalized availability/maintenance/power observation (requires agent credential).",
  ),
});

export const runDomainCommandInput = z.object({
  action: actionSchema.describe(
    "Any validated domain action supported by the SameRoom (共在) command engine.",
  ),
  ...commandMetaShape,
});

export const upsertHotspotInput = z.object({
  hotspot: hotspotSchema.describe(
    "Interactive showcase hotspot anchored to a room or entity, with visual icon/color and built-in effect (envelope, album, link, iframe, spotlight, variant).",
  ),
  ...commandMetaShape,
});

export const deleteHotspotInput = z.object({
  hotspotId: idSchema.describe("Existing hotspot ID to remove."),
  ...commandMetaShape,
});

export const setEntityGuestInput = z.object({
  entityId: idSchema.describe("Target entity ID."),
  guest: entityGuestSchema.describe(
    "Guest visibility ('show' | 'backdrop' | 'hide') and optional public summary.",
  ),
  ...commandMetaShape,
});

export interface McpToolSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

export const mcpToolSpecs = [
  {
    name: "get_home_state",
    title: "Get home state",
    description:
      "Read current revisioned SameRoom (共在) state: rooms, entities/hosts, HomeLab services, inventory stocks, CyberView topology, electrical circuits, observations and incidents.",
    inputSchema: getHomeStateInput,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "list_icons",
    title: "List local service icons",
    description:
      "List built-in local SVG service icon keys (e.g. 'portainer', 'gitea') and uploaded custom PNGs in the standalone local icon library (/api/icons/<sha256>).",
    inputSchema: listIconsInput,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "list_imported_models",
    title: "List local 3D models",
    description:
      "List imported local GLB models and public 3D generation job references (never returns API keys or private secrets).",
    inputSchema: listImportedModelsInput,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "upsert_service",
    title: "Create or update HomeLab service",
    description:
      "Create or update a HomeLab service bound to an existing entityId, including optional icon key or /api/icons/<sha256> reference.",
    inputSchema: upsertServiceInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "replace_cyber_graph",
    title: "Replace HomeLab cyber topology",
    description:
      "Atomically replace the CyberView nodes/edges/clouds/zones/taxonomy topology snapshot.",
    inputSchema: replaceCyberGraphInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "inspect_cyber_architecture",
    title: "Inspect CyberView architecture, zones and Mermaid",
    description:
      "Inspect effective architecture strata (boundary/app/infra/middleware), node display sizes (large/medium/small), quiet hover-only edges, classification provenance, custom isolation zones, category/topology registries, and host Mermaid diagrams.",
    inputSchema: inspectCyberArchitectureInput,
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "upsert_cyber_node",
    title: "Create or update CyberView node",
    description:
      "Incrementally add or update a CyberView node including display size, layer, boundary role, category, zone, icon, and topology groups.",
    inputSchema: upsertCyberNodeInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "delete_cyber_node",
    title: "Delete CyberView node",
    description: "Delete a CyberView node and prune its incident edges.",
    inputSchema: deleteCyberNodeInput,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  {
    name: "upsert_cyber_edge",
    title: "Create or update CyberView edge",
    description:
      "Incrementally add or update a CyberView directed dependency/route edge and its topology groups.",
    inputSchema: upsertCyberEdgeInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "delete_cyber_edge",
    title: "Delete CyberView edge",
    description: "Delete a CyberView edge by ID.",
    inputSchema: deleteCyberEdgeInput,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  {
    name: "upsert_cyber_zone",
    title: "Create or update isolation zone",
    description:
      "Define or update a strict or virtual isolation zone mapped by explicit node zone, host IDs, or group tags.",
    inputSchema: upsertCyberZoneInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "delete_cyber_zone",
    title: "Delete isolation zone",
    description:
      "Delete a custom isolation zone and clear dangling node/service zone assignments.",
    inputSchema: deleteCyberZoneInput,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  {
    name: "configure_cyber_taxonomy",
    title: "Configure custom categories and topologies",
    description:
      "Register, update, or remove custom service categories (label, shortLabel, color, defaultLayer, order) and logical topology metadata.",
    inputSchema: configureCyberTaxonomyInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "upsert_electrical_circuit",
    title: "Upsert electrical circuit",
    description:
      "Create or update a physical electrical controller circuit and its named load channels.",
    inputSchema: upsertElectricalCircuitInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "upload_icon",
    title: "Upload icon to local library",
    description:
      "Import a PNG, JPEG, WebP, GIF, or SVG image (up to 4 MiB decoded) into the local deduplicated icon library and return its /api/icons/<sha256> URL.",
    inputSchema: uploadIconInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "record_item",
    title: "Record inventory item or object",
    description:
      "Atomically record a new individual object or stock balance with its placeholder/model asset and optional cabinet placement.",
    inputSchema: recordItemInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  {
    name: "adjust_stock",
    title: "Adjust or transfer stock",
    description:
      "Adjust a stock zone quantity by delta or transfer positive quantity atomically between two compatible stock zones.",
    inputSchema: adjustStockInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  {
    name: "acknowledge_incident",
    title: "Acknowledge monitoring incident",
    description:
      "Mark an open monitoring incident as acknowledged without faking recovery.",
    inputSchema: acknowledgeIncidentInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "ingest_event",
    title: "Ingest external health event",
    description:
      "Ingest a normalized availability, maintenance, or power observation into incidents/observations (requires agent token authorization).",
    inputSchema: ingestEventInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "upsert_hotspot",
    title: "Create or update interactive hotspot",
    description:
      "Create or update a standard-view interactive hotspot (envelope, album, link, iframe, spotlight, variant).",
    inputSchema: upsertHotspotInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "delete_hotspot",
    title: "Delete interactive hotspot",
    description: "Remove an interactive hotspot by ID.",
    inputSchema: deleteHotspotInput,
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
  },
  {
    name: "set_entity_guest",
    title: "Configure entity guest visibility",
    description:
      "Set whether an entity is clickable ('show'), non-clickable ('backdrop'), or hidden ('hide') in visitor mode, plus an optional public summary.",
    inputSchema: setEntityGuestInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  {
    name: "run_domain_command",
    title: "Run any SameRoom (共在) domain action",
    description:
      "Execute any validated SameRoom domain action (layout.commit, entity.*, storage.*, surface.place, object.*, template.import, etc.) with automatic revision & operationId handling.",
    inputSchema: runDomainCommandInput,
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
] as const satisfies readonly McpToolSpec[];

export function sliceDashboardState(
  snapshot: Dashboard,
  section: StateSection = "all",
) {
  const { revision, home } = snapshot;
  switch (section) {
    case "summary":
      return {
        revision,
        id: home.id,
        name: home.name,
        counts: {
          rooms: home.rooms.length,
          assets: home.assets.length,
          entities: home.entities.length,
          services: home.services.length,
          stocks: home.stocks.length,
          electricalCircuits: home.electricalCircuits?.length ?? 0,
          cyberNodes: home.cyber?.nodes.length ?? 0,
          cyberEdges: home.cyber?.edges.length ?? 0,
          cyberZones: home.cyber?.zones?.length ?? 0,
          customCategories: Object.keys(home.cyber?.categories ?? {}).length,
          customTopologies: Object.keys(home.cyber?.topologies ?? {}).length,
          incidents: snapshot.incidents.filter((i) => i.state !== "resolved")
            .length,
        },
        rooms: home.rooms.map((r) => ({ id: r.id, name: r.name })),
        entities: home.entities.map((e) => ({
          id: e.id,
          name: e.name,
          category: e.category,
          locationId: e.locationId,
          lifecycle: e.lifecycle,
        })),
        services: home.services.map((s) => ({
          id: s.id,
          name: s.name,
          entityId: s.entityId,
          icon: s.icon,
        })),
      };
    case "rooms":
      return { revision, rooms: home.rooms };
    case "entities":
      return { revision, entities: home.entities, assets: home.assets };
    case "services":
      return { revision, services: home.services };
    case "stocks":
      return { revision, stocks: home.stocks, storage: home.storage ?? [] };
    case "cyber":
      return { revision, cyber: home.cyber ?? null };
    case "electrical":
      return { revision, electricalCircuits: home.electricalCircuits ?? [] };
    case "incidents":
      return {
        revision,
        observations: snapshot.observations,
        incidents: snapshot.incidents,
        unmapped: snapshot.unmapped,
      };
    case "all":
    default:
      return snapshot;
  }
}

export function decodeBase64Image(raw: string): Uint8Array {
  const cleaned = raw.trim().replace(/^data:[^;]+;base64,/i, "");
  if (!cleaned || !/^[A-Za-z0-9+/=\s]+$/.test(cleaned)) {
    throw new Error("imageBase64 must be valid base64 image data.");
  }
  const compact = cleaned.replace(/\s+/g, "");
  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, "=");
  // Decode cleanly in both Node and browser runtimes.
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildStockAction(input: z.infer<typeof adjustStockInput>) {
  if (input.mode === "transfer") {
    if (!input.fromId || !input.toId || input.quantity === undefined) {
      throw new Error(
        "Transfer mode requires fromId, toId, and positive quantity.",
      );
    }
    return {
      type: "stock.transfer" as const,
      fromId: input.fromId,
      toId: input.toId,
      quantity: input.quantity,
    };
  }
  if (!input.stockId || input.delta === undefined || input.delta === 0) {
    throw new Error("Adjust mode requires stockId and nonzero integer delta.");
  }
  return {
    type: "stock.adjust" as const,
    stockId: input.stockId,
    delta: input.delta,
  };
}
