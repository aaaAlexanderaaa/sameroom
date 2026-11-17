import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Action } from "../shared/domain.js";
import {
  buildCyberInspection,
  synthesizeDefaultCyberGraph,
} from "../shared/cyber-arch.js";
import { builtinServiceIcons } from "../shared/icons.js";
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
  ingestEventInput,
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
import { importedModels } from "./assets.js";
import { importIconAsset, listIconAssets } from "./icon-library.js";
import type { Providers } from "./providers.js";
import { DomainError, type StateStore } from "./state.js";
import { safeError } from "../scripts/lib/config.js";

export interface McpDeps {
  root: string;
  store: StateStore;
  providers: Providers;
}

function okResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(error: unknown) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: safeError(error) }],
  };
}

async function runAction(
  store: StateStore,
  actor: string,
  action: Action,
  options: {
    expectedRevision?: number;
    operationId?: string;
    issuedAt?: string;
  } = {},
) {
  const revision =
    options.expectedRevision ?? (await store.snapshot()).revision;
  return store.execute(
    {
      operationId: options.operationId ?? randomUUID(),
      expectedRevision: revision,
      issuedAt: options.issuedAt ?? new Date().toISOString(),
      action,
    },
    actor,
  );
}

export function createMcpServer(deps: McpDeps, actor: string): McpServer {
  const { root, store, providers } = deps;
  const server = new McpServer({
    name: "home-atlas",
    version: "0.1.0",
  });

  const specByName = new Map<string, (typeof mcpToolSpecs)[number]>(
    mcpToolSpecs.map((spec) => [spec.name, spec]),
  );
  const register = (
    name: string,
    handler: (args: unknown) => Promise<unknown>,
  ) => {
    const spec = specByName.get(name);
    if (!spec) throw new Error(`Missing MCP tool spec: ${name}`);
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: spec.inputSchema,
        annotations: {
          readOnlyHint: spec.readOnlyHint,
          destructiveHint: spec.destructiveHint,
          idempotentHint: spec.idempotentHint,
        },
      },
      async (args: unknown) => {
        try {
          return okResult(await handler(args));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  };

  register("get_home_state", async (args) => {
    const { section } = getHomeStateInput.parse(args ?? {});
    return sliceDashboardState(await store.snapshot(), section ?? "all");
  });

  register("list_icons", async () => ({
    builtin: builtinServiceIcons.map(({ key, name, url, color }) => ({
      key,
      name,
      url,
      color,
    })),
    library: await listIconAssets(root),
  }));

  register("list_imported_models", async () => ({
    imports: await importedModels(root),
    generations: (await providers.jobs.store.all()).map((job) =>
      providers.publicJob(job),
    ),
  }));

  register("upsert_service", async (args) => {
    const { service, expectedRevision, operationId, issuedAt } =
      upsertServiceInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "service.upsert", service },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("replace_cyber_graph", async (args) => {
    const { graph, expectedRevision, operationId, issuedAt } =
      replaceCyberGraphInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.replace", graph },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("inspect_cyber_architecture", async (args) => {
    const opts = inspectCyberArchitectureInput.parse(args ?? {});
    return buildCyberInspection(await store.snapshot(), opts);
  });

  register("upsert_cyber_node", async (args) => {
    const { node, previousId, asOf, expectedRevision, operationId, issuedAt } =
      upsertCyberNodeInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.node.upsert", node, previousId, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("delete_cyber_node", async (args) => {
    const { id, asOf, expectedRevision, operationId, issuedAt } =
      deleteCyberNodeInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.node.delete", id, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("upsert_cyber_edge", async (args) => {
    const { edge, previousId, asOf, expectedRevision, operationId, issuedAt } =
      upsertCyberEdgeInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.edge.upsert", edge, previousId, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("delete_cyber_edge", async (args) => {
    const { id, asOf, expectedRevision, operationId, issuedAt } =
      deleteCyberEdgeInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.edge.delete", id, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("upsert_cyber_zone", async (args) => {
    const { zone, previousId, asOf, expectedRevision, operationId, issuedAt } =
      upsertCyberZoneInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.zone.upsert", zone, previousId, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("delete_cyber_zone", async (args) => {
    const { id, asOf, expectedRevision, operationId, issuedAt } =
      deleteCyberZoneInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "cyber.zone.delete", id, asOf },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("configure_cyber_taxonomy", async (args) => {
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
    return runAction(
      store,
      actor,
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
  });

  register("upsert_electrical_circuit", async (args) => {
    const { circuit, expectedRevision, operationId, issuedAt } =
      upsertElectricalCircuitInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "electrical.upsert", circuit },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("upload_icon", async (args) => {
    const { name, imageBase64 } = uploadIconInput.parse(args);
    const bytes = Buffer.from(decodeBase64Image(imageBase64));
    return importIconAsset(root, bytes, name);
  });

  register("record_item", async (args) => {
    const {
      asset,
      item,
      containerId,
      compartmentId,
      expectedRevision,
      operationId,
      issuedAt,
    } = recordItemInput.parse(args);
    return runAction(
      store,
      actor,
      {
        type: "item.record",
        asset,
        item,
        ...(containerId ? { containerId } : {}),
        ...(compartmentId ? { compartmentId } : {}),
      },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("adjust_stock", async (args) => {
    const parsed = adjustStockInput.parse(args);
    return runAction(store, actor, buildStockAction(parsed), {
      expectedRevision: parsed.expectedRevision,
      operationId: parsed.operationId,
      issuedAt: parsed.issuedAt,
    });
  });

  register("acknowledge_incident", async (args) => {
    const { incidentId, expectedRevision, operationId, issuedAt } =
      acknowledgeIncidentInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "incident.ack", incidentId },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("ingest_event", async (args) => {
    if (actor !== "agent") {
      throw new DomainError(
        "External events require the integration/agent token.",
        403,
      );
    }
    const { event } = ingestEventInput.parse(args);
    return store.ingest(event);
  });

  register("run_domain_command", async (args) => {
    const { action, expectedRevision, operationId, issuedAt } =
      runDomainCommandInput.parse(args);
    return runAction(store, actor, action, {
      expectedRevision,
      operationId,
      issuedAt,
    });
  });

  register("upsert_hotspot", async (args) => {
    const { hotspot, expectedRevision, operationId, issuedAt } =
      upsertHotspotInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "hotspot.upsert", hotspot },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("delete_hotspot", async (args) => {
    const { hotspotId, expectedRevision, operationId, issuedAt } =
      deleteHotspotInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "hotspot.delete", hotspotId },
      { expectedRevision, operationId, issuedAt },
    );
  });

  register("set_entity_guest", async (args) => {
    const { entityId, guest, expectedRevision, operationId, issuedAt } =
      setEntityGuestInput.parse(args);
    return runAction(
      store,
      actor,
      { type: "entity.guest", entityId, guest },
      { expectedRevision, operationId, issuedAt },
    );
  });

  server.registerResource(
    "home-state",
    "homelab://state",
    {
      title: "SameRoom (共在) current state",
      description:
        "Complete revisioned SameRoom JSON snapshot (rooms, entities, services, stocks, cyber topology, incidents).",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "homelab://state",
          mimeType: "application/json",
          text: JSON.stringify(await store.snapshot(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "icon-catalog",
    "homelab://icons",
    {
      title: "SameRoom (共在) service icon catalog",
      description:
        "Built-in local SVG icon keys and custom standalone icon library assets.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "homelab://icons",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              builtin: builtinServiceIcons.map(({ key, name, url, color }) => ({
                key,
                name,
                url,
                color,
              })),
              library: await listIconAssets(root),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "cyber-graph",
    "homelab://cyber",
    {
      title: "HomeLab CyberView topology graph",
      description:
        "Raw or synthesized CyberGraph JSON including nodes, edges, clouds, custom zones, categories, and topologies.",
      mimeType: "application/json",
    },
    async () => {
      const snapshot = await store.snapshot();
      const graph =
        snapshot.home.cyber ?? synthesizeDefaultCyberGraph(snapshot.home);
      return {
        contents: [
          {
            uri: "homelab://cyber",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                revision: snapshot.revision,
                synthesized: !snapshot.home.cyber,
                graph,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerResource(
    "cyber-architecture",
    "homelab://cyber/architecture",
    {
      title: "HomeLab CyberView semantic architecture",
      description:
        "Resolved layers, classification provenance, custom isolation zones, category/topology registries, and host Mermaid diagrams.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "homelab://cyber/architecture",
          mimeType: "application/json",
          text: JSON.stringify(
            buildCyberInspection(await store.snapshot()),
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

export function createMcpHandler(deps: McpDeps) {
  return async (req: Request, res: Response) => {
    const actor = String(res.locals.actor ?? "agent");
    const server = createMcpServer(deps, actor);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };
}
