import { v4 as randomUUID } from "uuid";
import { z } from "zod";
import type { Action, Dashboard, Receipt } from "../shared/domain.js";
import { buildCyberInspection } from "../shared/cyber-arch.js";
import {
  acknowledgeIncidentInput,
  adjustStockInput,
  buildStockAction,
  configureCyberTaxonomyInput,
  decodeBase64Image,
  deleteCyberEdgeInput,
  deleteCyberNodeInput,
  deleteCyberZoneInput,
  deleteHotspotInput,
  getHomeStateInput,
  inspectCyberArchitectureInput,
  mcpToolSpecs,
  recordItemInput,
  replaceCyberGraphInput,
  runDomainCommandInput,
  setEntityGuestInput,
  sliceDashboardState,
  uploadIconInput,
  upsertCyberEdgeInput,
  upsertCyberNodeInput,
  upsertCyberZoneInput,
  upsertElectricalCircuitInput,
  upsertHotspotInput,
  upsertServiceInput,
} from "../shared/mcp-tools.js";
import { request } from "./api.js";

interface BrowserModelContextTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnlyHint?: boolean;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

interface DocumentModelContext {
  registerTool?: (
    tool: BrowserModelContextTool,
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
}

interface NavigatorModelContext {
  provideContext?: (options: {
    tools: BrowserModelContextTool[];
  }) => void | Promise<void>;
  clearContext?: () => void | Promise<void>;
}

const isExampleWorkspace = () =>
  typeof document !== "undefined" &&
  Boolean(document.querySelector(".world-example, .world-example-banner"));

const stateEndpoint = () =>
  isExampleWorkspace() ? "/world-example/state" : "/state";

const commandEndpoint = () =>
  isExampleWorkspace() ? "/world-example/commands" : "/commands";

async function runBrowserCommand(
  action: Action,
  options: {
    expectedRevision?: number;
    operationId?: string;
    issuedAt?: string;
  } = {},
): Promise<Receipt> {
  const expectedRevision =
    options.expectedRevision ??
    (await request<Dashboard>(stateEndpoint())).revision;
  return request<Receipt>(commandEndpoint(), {
    operationId: options.operationId ?? randomUUID(),
    expectedRevision,
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    action,
  });
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  const { $schema: _ignored, ...rest } = json;
  return rest;
}

function buildBrowserTools(): BrowserModelContextTool[] {
  const handlers: Record<
    string,
    (args: Record<string, unknown>) => Promise<unknown>
  > = {
    get_home_state: async (args) => {
      const { section } = getHomeStateInput.parse(args ?? {});
      const snapshot = await request<Dashboard>(stateEndpoint());
      return sliceDashboardState(snapshot, section ?? "all");
    },
    inspect_cyber_architecture: async (args) => {
      const opts = inspectCyberArchitectureInput.parse(args ?? {});
      const snapshot = await request<Dashboard>(stateEndpoint());
      return buildCyberInspection(snapshot, opts);
    },
    list_icons: async () => request("/icons"),
    list_imported_models: async () => ({
      imports: await request("/assets/imports"),
      generations: await request("/generations"),
    }),
    upsert_service: async (args) => {
      const { service, expectedRevision, operationId, issuedAt } =
        upsertServiceInput.parse(args);
      return runBrowserCommand(
        { type: "service.upsert", service },
        { expectedRevision, operationId, issuedAt },
      );
    },
    replace_cyber_graph: async (args) => {
      const { graph, expectedRevision, operationId, issuedAt } =
        replaceCyberGraphInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.replace", graph },
        { expectedRevision, operationId, issuedAt },
      );
    },
    upsert_cyber_node: async (args) => {
      const {
        node,
        previousId,
        asOf,
        expectedRevision,
        operationId,
        issuedAt,
      } = upsertCyberNodeInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.node.upsert", node, previousId, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    delete_cyber_node: async (args) => {
      const { id, asOf, expectedRevision, operationId, issuedAt } =
        deleteCyberNodeInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.node.delete", id, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    upsert_cyber_edge: async (args) => {
      const {
        edge,
        previousId,
        asOf,
        expectedRevision,
        operationId,
        issuedAt,
      } = upsertCyberEdgeInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.edge.upsert", edge, previousId, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    delete_cyber_edge: async (args) => {
      const { id, asOf, expectedRevision, operationId, issuedAt } =
        deleteCyberEdgeInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.edge.delete", id, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    upsert_cyber_zone: async (args) => {
      const {
        zone,
        previousId,
        asOf,
        expectedRevision,
        operationId,
        issuedAt,
      } = upsertCyberZoneInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.zone.upsert", zone, previousId, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    delete_cyber_zone: async (args) => {
      const { id, asOf, expectedRevision, operationId, issuedAt } =
        deleteCyberZoneInput.parse(args);
      return runBrowserCommand(
        { type: "cyber.zone.delete", id, asOf },
        { expectedRevision, operationId, issuedAt },
      );
    },
    configure_cyber_taxonomy: async (args) => {
      const {
        categories,
        topologies,
        deleteCategories,
        deleteTopologies,
        replaceCategories,
        replaceTopologies,
        asOf,
        expectedRevision,
        operationId,
        issuedAt,
      } = configureCyberTaxonomyInput.parse(args);
      return runBrowserCommand(
        {
          type: "cyber.taxonomy.upsert",
          categories,
          topologies,
          deleteCategories,
          deleteTopologies,
          replaceCategories,
          replaceTopologies,
          asOf,
        },
        { expectedRevision, operationId, issuedAt },
      );
    },
    upsert_electrical_circuit: async (args) => {
      const { circuit, expectedRevision, operationId, issuedAt } =
        upsertElectricalCircuitInput.parse(args);
      return runBrowserCommand(
        { type: "electrical.upsert", circuit },
        { expectedRevision, operationId, issuedAt },
      );
    },
    upload_icon: async (args) => {
      const { name, imageBase64 } = uploadIconInput.parse(args);
      const bytes = decodeBase64Image(imageBase64);
      const form = new FormData();
      form.append("image", new Blob([bytes.slice().buffer]), `${name}.png`);
      form.append("name", name);
      return request("/icons", form);
    },
    record_item: async (args) => {
      const {
        asset,
        item,
        containerId,
        compartmentId,
        expectedRevision,
        operationId,
        issuedAt,
      } = recordItemInput.parse(args);
      return runBrowserCommand(
        {
          type: "item.record",
          asset,
          item,
          ...(containerId ? { containerId } : {}),
          ...(compartmentId ? { compartmentId } : {}),
        },
        { expectedRevision, operationId, issuedAt },
      );
    },
    adjust_stock: async (args) => {
      const parsed = adjustStockInput.parse(args);
      return runBrowserCommand(buildStockAction(parsed), {
        expectedRevision: parsed.expectedRevision,
        operationId: parsed.operationId,
        issuedAt: parsed.issuedAt,
      });
    },
    acknowledge_incident: async (args) => {
      const { incidentId, expectedRevision, operationId, issuedAt } =
        acknowledgeIncidentInput.parse(args);
      return runBrowserCommand(
        { type: "incident.ack", incidentId },
        { expectedRevision, operationId, issuedAt },
      );
    },
    run_domain_command: async (args) => {
      const { action, expectedRevision, operationId, issuedAt } =
        runDomainCommandInput.parse(args);
      return runBrowserCommand(action, {
        expectedRevision,
        operationId,
        issuedAt,
      });
    },
    upsert_hotspot: async (args) => {
      const { hotspot, expectedRevision, operationId, issuedAt } =
        upsertHotspotInput.parse(args);
      return runBrowserCommand(
        { type: "hotspot.upsert", hotspot },
        { expectedRevision, operationId, issuedAt },
      );
    },
    delete_hotspot: async (args) => {
      const { hotspotId, expectedRevision, operationId, issuedAt } =
        deleteHotspotInput.parse(args);
      return runBrowserCommand(
        { type: "hotspot.delete", hotspotId },
        { expectedRevision, operationId, issuedAt },
      );
    },
    set_entity_guest: async (args) => {
      const { entityId, guest, expectedRevision, operationId, issuedAt } =
        setEntityGuestInput.parse(args);
      return runBrowserCommand(
        { type: "entity.guest", entityId, guest },
        { expectedRevision, operationId, issuedAt },
      );
    },
  };

  return mcpToolSpecs
    .filter((spec) => spec.name in handlers)
    .map((spec) => ({
      name: spec.name,
      description: spec.description,
      inputSchema: toJsonSchema(spec.inputSchema),
      ...(spec.readOnlyHint !== undefined
        ? { readOnlyHint: spec.readOnlyHint }
        : {}),
      execute: (args) => handlers[spec.name]!(args ?? {}),
    }));
}

/**
 * Progressively registers SameRoom (共在) tools onto W3C / Chrome WebMCP
 * (`document.modelContext` or `navigator.modelContext`) when available.
 */
export function installBrowserWebMcp(): () => void {
  const docCtx = (
    document as Document & { modelContext?: DocumentModelContext }
  ).modelContext;
  const navCtx = (
    navigator as Navigator & { modelContext?: NavigatorModelContext }
  ).modelContext;

  if (!docCtx?.registerTool && !navCtx?.provideContext) {
    return () => {};
  }

  const tools = buildBrowserTools();
  const controller = new AbortController();

  if (docCtx?.registerTool) {
    for (const tool of tools) {
      try {
        void Promise.resolve(
          docCtx.registerTool(tool, { signal: controller.signal }),
        ).catch(() => {});
      } catch {
        // Ignore experimental browser shim errors cleanly.
      }
    }
    return () => controller.abort();
  }

  try {
    void Promise.resolve(navCtx!.provideContext!({ tools })).catch(() => {});
  } catch {
    // Ignore experimental browser shim errors cleanly.
  }
  return () => {
    try {
      void Promise.resolve(navCtx?.clearContext?.()).catch(() => {});
    } catch {
      /* ignore cleanup errors */
    }
  };
}
