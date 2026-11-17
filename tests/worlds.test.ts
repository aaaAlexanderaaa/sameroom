import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateStore } from "../server/state.js";
import { worldExample } from "../shared/world-example.js";
import {
  emptyInterior,
  splitRegion,
  mergeRegion,
  regions,
  type Interior,
} from "../shared/compartments.js";
import {
  cyberSchema,
  graphGroup,
  validateCyber,
  type CyberGraph,
} from "../shared/cyber.js";
import {
  buildCyberInspection,
  buildHostArchitecture,
  buildTopologyViewModel,
  classifyCyberNodes,
  filterCyberByCategory,
  hostArchitectureToMermaid,
  isCyberEdgeQuiet,
  orderHostPreviewNodes,
} from "../shared/cyber-arch.js";
import {
  validateTemplate,
  type Action,
  type Entity,
} from "../shared/domain.js";
async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "worlds-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = worldExample(),
    store = new StateStore(root, home);
  await store.snapshot();
  const command = async (action: Action) => ({
    operationId: randomUUID(),
    expectedRevision: (await store.snapshot()).revision,
    issuedAt: new Date().toISOString(),
    action,
  });
  const send = async (action: Action) => store.execute(await command(action));
  return { root, home, store, command, send };
}
test("cabinet split, merge and numeric dimensions preserve all contents through restart and replay", async (t) => {
  const { store, root, home, send, command } = await fixture(t);
  await send({
    type: "storage.place",
    itemId: "little-robot",
    containerId: "bedside",
    compartmentId: "drawer",
  });
  let interior = (await store.snapshot()).home.storage!.find(
    (s) => s.entityId === "bedside",
  )!.interior!;
  interior = splitRegion(interior, "drawer", "x", "left", "right");
  await send({
    type: "storage.configure",
    storage: { entityId: "bedside", columns: 4, rows: 4, interior },
  });
  assert.equal(
    (await store.snapshot()).home.entities.find((e) => e.id === "adapter")!
      .attachment?.compartmentId,
    "left",
  );
  await send({
    type: "storage.place",
    itemId: "little-robot",
    containerId: "bedside",
    compartmentId: "right",
  });
  interior.parts.find((p) => p.id === "drawer")!.split!.ratio = 0.3;
  const r = regions(interior).find((r) => r.part.id === "left")!;
  assert.equal(r.width, 0.3);
  interior = mergeRegion(interior, "drawer");
  const cmd = await command({
      type: "storage.configure",
      storage: { entityId: "bedside", columns: 4, rows: 4, interior },
    }),
    receipt = await store.execute(cmd);
  assert.deepEqual(await new StateStore(root, home).execute(cmd), receipt);
  const state = await store.snapshot();
  for (const id of ["adapter", "little-robot"])
    assert.equal(
      state.home.entities.find((e) => e.id === id)!.attachment?.compartmentId,
      "drawer",
    );
  assert.notEqual(
    state.home.entities.find((e) => e.id === "adapter")!.attachment?.slot,
    state.home.entities.find((e) => e.id === "little-robot")!.attachment?.slot,
  );
  assert.deepEqual(
    validateTemplate(JSON.parse(JSON.stringify(state.home))),
    state.home,
  );
});
test("invalid or conflicting cabinet edits and unknown compartments leave the entire home unchanged", async (t) => {
  const { store, send, command } = await fixture(t);
  const before = await store.snapshot();
  const cycle: Interior = {
    root: "main",
    parts: [
      {
        id: "main",
        name: "Cycle",
        kind: "shelf",
        split: { axis: "y", ratio: 0.5, first: "main", second: "main" },
      },
    ],
  };
  await assert.rejects(
    send({
      type: "storage.configure",
      storage: { entityId: "bedside", columns: 4, rows: 4, interior: cycle },
    }),
  );
  await assert.rejects(
    send({
      type: "storage.place",
      itemId: "adapter",
      containerId: "wardrobe",
      compartmentId: "missing",
    }),
  );
  await assert.rejects(
    send({
      type: "storage.configure",
      storage: {
        entityId: "bedside",
        columns: 4,
        rows: 4,
        interior: {
          root: "replacement",
          parts: [{ id: "replacement", name: "New", kind: "shelf" }],
        },
      },
    }),
  );
  assert.deepEqual(await store.snapshot(), before);
  const stale = await command({
    type: "storage.configure",
    storage: {
      entityId: "bedside",
      columns: 4,
      rows: 4,
      interior: emptyInterior(),
    },
  });
  await send({ type: "stock.adjust", stockId: "capsules", delta: 1 });
  await assert.rejects(store.execute(stale), /State changed/);
});
test("text and photo stock creation is atomic, reusable, preserves photos on transfer, and accepts no public photo URLs", async (t) => {
  const { store, home, root, command, send } = await fixture(t);
  const source = home.stocks.find((s) => s.id === "capsules")!;
  const action: Action = {
    type: "item.record",
    asset: {
      ...home.assets.find((a) => a.id === "bag-example")!,
      id: "new-asset",
    },
    item: {
      ...source,
      id: "soap",
      name: "洗衣液",
      assetId: "new-asset",
      photos: [
        "/api/uploads/" + "a".repeat(64),
        "/api/uploads/" + "b".repeat(64),
      ],
    },
    containerId: "bedside",
    compartmentId: "drawer",
  };
  const cmd = await command(action),
    receipt = await store.execute(cmd);
  assert.deepEqual(await new StateStore(root, home).execute(cmd), receipt);
  assert.equal(
    (await store.snapshot()).home.stocks.filter((s) => s.id === "soap").length,
    1,
  );
  await send({
    type: "storage.place",
    itemId: "soap",
    containerId: "wardrobe",
    compartmentId: "upper",
  });
  assert.equal(
    (await store.snapshot()).home.stocks.find((s) => s.id === "soap")!.photos
      ?.length,
    2,
  );
  const before = await store.snapshot();
  await assert.rejects(
    send({
      type: "item.photos",
      itemId: "soap",
      photos: ["https://example.com/a.jpg"],
    }),
  );
  await assert.rejects(
    send({
      ...action,
      item: { ...action.item, id: "soap-bad", assetId: "bad-asset" },
      asset: { ...action.asset, id: "bad-asset" },
      compartmentId: "missing",
    }),
  );
  assert.deepEqual(await store.snapshot(), before);
});
test("cyber graph accepts cross-host groups and explicit cloud anchors, rejects broken references and stale snapshots atomically", async (t) => {
  const { store, send, command, root, home } = await fixture(t);
  const graph = structuredClone(home.cyber!);
  graph.asOf = new Date().toISOString();
  const cmd = await command({ type: "cyber.replace", graph }),
    receipt = await store.execute(cmd);
  assert.deepEqual(await new StateStore(root, home).execute(cmd), receipt);
  const outbound = graphGroup(graph, "出网");
  assert.ok(outbound.nodes.some((n) => n.id === "api"));
  assert.ok(
    outbound.edges.some((e) => e.source === "route" && e.target === "gateway"),
  );
  assert.ok(!outbound.nodes.some((n) => n.id === "db"));
  const before = await store.snapshot();
  for (const bad of [
    {
      ...graph,
      edges: [{ id: "bad", source: "missing", target: "app", groups: [] }],
    },
    { ...graph, nodes: [{ ...graph.nodes[0], host: "unknown" }] },
    {
      ...graph,
      clouds: [
        {
          host: "studio-mini",
          provider: "cloud",
          region: "region",
          direction: "south" as const,
        },
      ],
    },
    { ...graph, asOf: "2026-01-01T00:00:00Z" },
  ])
    await assert.rejects(send({ type: "cyber.replace", graph: bad }));
  assert.deepEqual(await store.snapshot(), before);
});

test("editable example uses the same command engine while keeping owner state and agent authority separate", async (t) => {
  const { createApp } = await import("../server/app.js");
  const root = await mkdtemp(join(tmpdir(), "world-example-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { app, agentToken } = await createApp(root);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  t.after(
    () =>
      new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  );
  const address = server.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const boot = await fetch(base + "/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: (
          await readFile(join(root, "data/private/admin-token"), "utf8")
        ).trim(),
      }),
    }),
    cookie = boot.headers.get("set-cookie")!.split(";")[0],
    session = (await boot.json()) as { csrfToken: string };
  const headers = {
    Cookie: cookie,
    "X-Session-Token": session.csrfToken,
    "Content-Type": "application/json",
  };
  const before = await (await fetch(base + "/api/state", { headers })).json();
  const initial = (await (
    await fetch(base + "/api/world-example/state", { headers })
  ).json()) as { revision: number };
  const command = {
    operationId: randomUUID(),
    expectedRevision: initial.revision,
    issuedAt: new Date().toISOString(),
    action: { type: "stock.adjust", stockId: "capsules", delta: 1 },
  };
  const denied = await fetch(base + "/api/world-example/commands", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  assert.equal(denied.status, 403);
  const first = await fetch(base + "/api/world-example/commands", {
    method: "POST",
    headers,
    body: JSON.stringify(command),
  });
  assert.equal(first.status, 200);
  const receipt = await first.json();
  const duplicate = await fetch(base + "/api/world-example/commands", {
    method: "POST",
    headers,
    body: JSON.stringify(command),
  });
  assert.deepEqual(await duplicate.json(), receipt);
  assert.deepEqual(
    await (await fetch(base + "/api/state", { headers })).json(),
    before,
  );
  assert.equal(
    (await (await fetch(base + "/api/command-schema", { headers })).json())
      .type,
    "object",
  );
});

test("buildHostArchitecture converges dense intra-host self-references into clean DAG tiers and Mermaid", () => {
  const nodes: CyberGraph["nodes"] = [
    {
      id: "dashy",
      label: "Dashy",
      host: "fixture-host",
      kind: "service",
      groups: ["app"],
    },
    {
      id: "wiki",
      label: "Wiki workspace",
      layer: "app",
      category: "workspace",
      host: "fixture-host",
      kind: "service",
      groups: ["app"],
    },
    {
      id: "lobehub",
      label: "LobeHub",
      host: "fixture-host",
      kind: "service",
      groups: ["ai"],
    },
    {
      id: "immich",
      label: "Immich",
      host: "fixture-host",
      kind: "service",
      groups: ["media"],
    },
    {
      id: "portainer",
      label: "Portainer CE",
      host: "fixture-host",
      kind: "service",
      groups: ["manage"],
    },
    {
      id: "n8n",
      label: "n8n",
      host: "fixture-host",
      kind: "service",
      groups: ["auto"],
    },
    {
      id: "searxng",
      label: "SearXNG",
      host: "fixture-host",
      kind: "service",
      groups: ["ai"],
    },
    {
      id: "lobe-pg",
      label: "Lobe ParadeDB",
      host: "fixture-host",
      kind: "database",
      groups: ["ai"],
    },
    {
      id: "lobe-redis",
      label: "Lobe Redis",
      host: "fixture-host",
      kind: "database",
      groups: ["ai"],
    },
    {
      id: "agent",
      label: "beszel-agent",
      host: "fixture-host",
      kind: "service",
      groups: ["ops"],
    },
    {
      id: "npm",
      label: "NPM",
      host: "fixture-host",
      kind: "gateway",
      groups: ["net"],
    },
    {
      id: "cf",
      label: "Cloudflare Edge",
      host: "cloud",
      kind: "external",
      groups: ["net"],
    },
    {
      id: "beszel-hub",
      label: "Beszel Hub",
      host: "nas",
      kind: "service",
      groups: ["ops"],
    },
  ];
  const edges: CyberGraph["edges"] = [
    {
      id: "e-fb",
      source: "dashy",
      target: "npm",
      label: "入口导航",
      groups: ["net"],
    },
    {
      id: "e1",
      source: "npm",
      target: "dashy",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e2",
      source: "npm",
      target: "lobehub",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e3",
      source: "npm",
      target: "immich",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e-wiki",
      source: "npm",
      target: "wiki",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e-pt",
      source: "npm",
      target: "portainer",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e-n8n",
      source: "npm",
      target: "n8n",
      label: "反代",
      groups: ["net"],
    },
    {
      id: "e4",
      source: "lobehub",
      target: "searxng",
      label: "联网搜索",
      groups: ["ai"],
    },
    {
      id: "e5",
      source: "lobehub",
      target: "lobe-pg",
      label: "pgvector",
      groups: ["ai"],
    },
    {
      id: "e6",
      source: "lobehub",
      target: "lobe-redis",
      label: "缓存",
      groups: ["ai"],
    },
    {
      id: "e-in",
      source: "cf",
      target: "npm",
      label: "Tunnel",
      groups: ["net"],
    },
    {
      id: "e-out",
      source: "agent",
      target: "beszel-hub",
      label: "监控",
      groups: ["ops"],
    },
  ];

  const ordered = orderHostPreviewNodes(
    nodes.filter((n) => n.host === "fixture-host"),
    edges,
  );
  assert.equal(ordered[0].id, "npm");

  const arch = buildHostArchitecture("fixture-host", nodes, edges);
  assert.equal(arch.internalEdges.length, 10);
  assert.equal(arch.feedbackEdges.length, 1);
  assert.equal(arch.feedbackEdges[0].id, "e-fb");
  assert.equal(arch.dagEdges.length, 9);
  assert.equal(arch.crossLinks.length, 2);

  assert.equal(arch.tiers.length, 4);
  assert.equal(arch.boundaryTier?.id, "tier-boundary");
  assert.deepEqual(
    arch.boundaryTier?.nodes.map((n) => n.id),
    ["npm"],
  );
  assert.equal(arch.tiers[0].isolation, "strict");
  assert.equal(arch.tiers[1].id, "tier-app");
  assert.equal(arch.tiers[1].isolation, "virtual");
  assert.deepEqual(arch.tiers[1].nodes.map((n) => n.id).sort(), [
    "dashy",
    "immich",
    "lobehub",
    "wiki",
  ]);
  assert.equal(arch.tiers[2].id, "tier-infra");
  assert.equal(arch.tiers[2].isolation, "virtual");
  assert.deepEqual(arch.tiers[2].nodes.map((n) => n.id).sort(), [
    "agent",
    "n8n",
    "portainer",
  ]);
  assert.equal(arch.tiers[3].id, "tier-middleware");
  assert.equal(arch.tiers[3].isolation, "strict");
  assert.deepEqual(arch.tiers[3].nodes.map((n) => n.id).sort(), [
    "lobe-pg",
    "lobe-redis",
    "searxng",
  ]);

  const mermaid = hostArchitectureToMermaid("Example application host", arch);
  assert.match(mermaid, /flowchart TD/);
  assert.match(mermaid, /subgraph tier-boundary\["边界门户层/);
  assert.match(mermaid, /subgraph tier-middleware\["中间件与数据层/);
  assert.match(mermaid, /-->\|"pgvector"\|/);
  assert.match(mermaid, /-\.->\|"入口导航"\|/);

  const zeroArch = buildHostArchitecture("cloud", nodes, edges);
  assert.equal(zeroArch.internalEdges.length, 0);
  assert.equal(zeroArch.tiers.length, 1);
  assert.equal(zeroArch.tiers[0].id, "tier-boundary");
});

test("classifyCyberNodes and buildTopologyViewModel separate boundary slots, isolation zones, and out-of-topology members", () => {
  const sample = worldExample();
  const extraEntities: Entity[] = [
    ...sample.entities,
    {
      ...sample.entities[0],
      id: "fixture-edge",
      name: "Example edge host",
      category: "host",
      scope: "home",
    },
    {
      ...sample.entities[0],
      id: "fixture-host",
      name: "fixture-host",
      category: "host",
      scope: "home",
    },
  ];
  const fullGraph = cyberSchema.parse({
    version: 1,
    source: "homelab.test",
    asOf: "2026-11-15T00:00:00Z",
    nodes: [
      {
        id: "npm",
        label: "NPM",
        host: "fixture-host",
        kind: "gateway",
        groups: ["tls"],
      },
      {
        id: "resolver-fixture",
        label: "Example resolver",
        boundary: "dns",
        host: "fixture-edge",
        kind: "gateway",
        groups: ["dns"],
      },
      {
        id: "egress-fixture",
        label: "Example egress",
        boundary: "egress",
        host: "fixture-edge",
        kind: "gateway",
        groups: ["proxy"],
      },
      {
        id: "wiki",
        label: "Wiki workspace",
        layer: "app",
        category: "workspace",
        host: "fixture-host",
        kind: "service",
        groups: ["app"],
      },
      {
        id: "uptime",
        label: "Uptime Kuma",
        host: "fixture-host",
        kind: "service",
        groups: ["monitor"],
      },
      {
        id: "new-api",
        label: "New API",
        host: "fixture-host",
        kind: "service",
        groups: ["relay"],
      },
      {
        id: "pg",
        label: "PostgreSQL",
        host: "fixture-host",
        kind: "database",
        groups: ["data"],
      },
      {
        id: "tailscale",
        label: "Tailscale overlay",
        kind: "external",
        groups: ["overlay"],
      },
      {
        id: "socks5",
        label: "Example remote boundary",
        host: "cloud-node",
        kind: "gateway",
        groups: ["proxy"],
      },
    ],
    edges: [
      {
        id: "e1",
        source: "npm",
        target: "wiki",
        label: "HTTPS",
        groups: ["tls"],
      },
      {
        id: "e2",
        source: "egress-fixture",
        target: "socks5",
        label: "proxy",
        groups: ["proxy"],
      },
      {
        id: "e3",
        source: "uptime",
        target: "wiki",
        label: "probe",
        groups: ["monitor"],
      },
      {
        id: "e4",
        source: "npm",
        target: "tailscale",
        label: "tailnet",
        groups: ["overlay"],
      },
    ],
    clouds: [
      {
        host: "cloud-node",
        provider: "Example Cloud",
        region: "Example Region",
        direction: "east",
      },
    ],
    zones: [
      {
        id: "lan",
        label: "本地物理域",
        isolation: "strict",
        hosts: ["fixture-host", "fixture-edge"],
      },
    ],
  });

  const cls = classifyCyberNodes(
    fullGraph.nodes,
    fullGraph.edges,
    sample.services,
  );
  assert.equal(cls.get("npm")?.boundaryRole, "ingress");
  assert.equal(cls.get("resolver-fixture")?.boundaryRole, "dns");
  assert.equal(cls.get("egress-fixture")?.boundaryRole, "egress");
  assert.equal(cls.get("tailscale")?.boundaryRole, "mesh");
  assert.equal(cls.get("wiki")?.layer, "app");
  assert.equal(cls.get("wiki")?.category, "workspace");
  assert.equal(cls.get("uptime")?.layer, "infra");
  assert.equal(cls.get("uptime")?.category, "monitor");
  assert.equal(cls.get("new-api")?.layer, "infra");
  assert.equal(cls.get("new-api")?.category, "relay");
  assert.equal(cls.get("pg")?.layer, "middleware");
  assert.equal(cls.get("pg")?.category, "data");

  const fullModel = buildTopologyViewModel({
    fullGraph,
    activeGraph: fullGraph,
    entities: extraEntities,
    services: sample.services,
  });
  assert.equal(
    fullModel.localPerimeter.ingress.map((x) => x.node.id).join(","),
    "npm",
  );
  assert.equal(
    fullModel.localPerimeter.dns.map((x) => x.node.id).join(","),
    "resolver-fixture",
  );
  assert.equal(
    fullModel.localPerimeter.egress.map((x) => x.node.id).join(","),
    "egress-fixture",
  );
  assert.equal(
    fullModel.localStrata.app.map((x) => x.node.id).join(","),
    "wiki",
  );
  assert.deepEqual(fullModel.localStrata.infra.map((x) => x.node.id).sort(), [
    "new-api",
    "uptime",
  ]);
  assert.equal(
    fullModel.localStrata.middleware.map((x) => x.node.id).join(","),
    "pg",
  );
  assert.equal(
    fullModel.overlayMeshNodes.map((x) => x.node.id).join(","),
    "tailscale",
  );
  assert.equal(
    fullModel.remoteClusters[0]?.boundaryNodes.map((x) => x.node.id).join(","),
    "socks5",
  );

  const proxyOnly = filterCyberByCategory(fullGraph, "relay", cls);
  const filteredModel = buildTopologyViewModel({
    fullGraph,
    activeGraph: proxyOnly,
    entities: extraEntities,
    services: sample.services,
  });
  assert.deepEqual(filteredModel.inTopologyNodes.map((x) => x.node.id).sort(), [
    "egress-fixture",
    "new-api",
    "socks5",
  ]);
  assert.ok(filteredModel.outOfTopologyNodes.some((x) => x.node.id === "pg"));
  assert.ok(filteredModel.outOfTopologyNodes.some((x) => x.node.id === "wiki"));

  const proxyGroupModel = buildTopologyViewModel({
    fullGraph,
    activeGraph: graphGroup(fullGraph, "proxy"),
    entities: extraEntities,
    services: sample.services,
  });
  assert.equal(proxyGroupModel.activeEdges.length, 1);
  assert.equal(proxyGroupModel.excludedByHost.length >= 1, true);

  // Route groups (like groups: ["出网"] on end-user apps) must not misclassify apps as egress gateways.
  const exCyber = sample.cyber!;
  const exCls = classifyCyberNodes(
    exCyber.nodes,
    exCyber.edges,
    sample.services,
  );
  assert.equal(exCls.get("app")?.layer, "app");
  assert.equal(exCls.get("work")?.layer, "app");
  assert.equal(exCls.get("proxy")?.boundaryRole, "egress");
  assert.equal(exCls.get("route")?.boundaryRole, "egress");
  assert.equal(exCls.get("gateway")?.boundaryRole, "egress");
});

test("custom zones, custom taxonomy, service inheritance, and strict precedence work end-to-end", () => {
  const sample = worldExample();
  const hostId = sample.entities.find((e) => e.category === "host")!.id;
  const customGraph = {
    version: 1 as const,
    source: "custom-taxonomy-test",
    asOf: "2026-11-15T00:00:00Z",
    clouds: [],
    zones: [
      {
        id: "dmz",
        label: "DMZ 入口隔离区",
        isolation: "strict" as const,
        hosts: [hostId],
        order: 1,
      },
      {
        id: "ai-overlay",
        label: "AI 逻辑算力域",
        isolation: "virtual" as const,
        groups: ["AI"],
        order: 2,
      },
    ],
    categories: {
      "ai-llm": {
        label: "大模型推理",
        shortLabel: "AI推理",
        color: "#c084fc",
        defaultLayer: "infra" as const,
        order: 1,
      },
    },
    topologies: {
      AI: {
        label: "本地推理链路",
        description: "OpenWebUI -> vLLM -> PG",
        order: 1,
      },
    },
    nodes: [
      {
        id: "searxng",
        label: "SearXNG",
        host: hostId,
        kind: "service" as const,
        groups: ["AI"],
      },
      {
        id: "vllm",
        label: "vLLM",
        host: hostId,
        kind: "service" as const,
        category: "ai-llm",
        groups: ["AI"],
      },
      {
        id: "svc-node",
        label: "Custom Bound Node",
        host: hostId,
        serviceId: "svc-override",
        kind: "service" as const,
        groups: [],
      },
      {
        id: "tailscale-edge",
        label: "Tailscale",
        kind: "external" as const,
        boundary: "ingress" as const,
        groups: [],
      },
    ],
    edges: [
      {
        id: "e-ai",
        source: "searxng",
        target: "vllm",
        groups: ["AI"],
      },
    ],
  };

  const servicesWithOverrides = [
    ...sample.services,
    {
      id: "svc-override",
      entityId: hostId,
      name: "Service Override Target",
      version: "1.0.0",
      embed: "unverified" as const,
      description: "Inherits layer and category from service",
      layer: "middleware" as const,
      category: "ai-llm",
      zone: "ai-overlay",
      asOf: "2026-11-15T00:00:00Z",
      demo: false,
    },
  ];

  // Validate custom zones & taxonomy through validateCyber without rejection.
  validateCyber(
    customGraph,
    sample.entities.map((e) => ({
      id: e.id,
      lifecycle: e.lifecycle,
      scope: e.scope,
    })),
    servicesWithOverrides.map((s) => ({ id: s.id, entityId: s.entityId })),
  );

  const cls = classifyCyberNodes(
    customGraph.nodes,
    customGraph.edges,
    servicesWithOverrides,
    { categories: customGraph.categories, zones: customGraph.zones },
  );

  // SearXNG must be workspace/app, never database/data.
  assert.equal(cls.get("searxng")?.category, "workspace");
  assert.equal(cls.get("searxng")?.layer, "app");

  // Custom category uses registered color/label and defaultLayer ("infra").
  assert.equal(cls.get("vllm")?.categoryMeta.label, "大模型推理");
  assert.equal(cls.get("vllm")?.categoryMeta.color, "#c084fc");
  assert.equal(cls.get("vllm")?.layer, "infra");
  assert.equal(cls.get("vllm")?.layerSource, "rule");

  // Service architectural hints inherit with provenance.
  assert.equal(cls.get("svc-node")?.layer, "middleware");
  assert.equal(cls.get("svc-node")?.layerSource, "service");
  assert.equal(cls.get("svc-node")?.zoneId, "ai-overlay");
  assert.equal(cls.get("svc-node")?.zoneSource, "service");

  // Explicit node.boundary must never be clobbered by MESH_RE.
  assert.equal(cls.get("tailscale-edge")?.boundaryRole, "ingress");
  assert.equal(cls.get("tailscale-edge")?.boundarySource, "node");

  // Topology view model materializes declared custom zones accurately.
  const topo = buildTopologyViewModel({
    fullGraph: customGraph,
    activeGraph: customGraph,
    entities: sample.entities,
    services: servicesWithOverrides,
  });
  const dmzZone = topo.zones.find((z) => z.id === "dmz");
  const aiZone = topo.zones.find((z) => z.id === "ai-overlay");
  assert.equal(dmzZone?.isolation, "strict");
  assert.equal(aiZone?.isolation, "virtual");
  assert.ok(dmzZone?.strata.infra.some((i) => i.node.id === "vllm"));
  assert.ok(aiZone?.strata.middleware.some((i) => i.node.id === "svc-node"));
  assert.equal(topo.topologies[0]?.label, "本地推理链路");

  // validateCyber rejects dangling node.zone or duplicate zone IDs.
  assert.throws(() =>
    validateCyber(
      {
        ...customGraph,
        nodes: [{ ...customGraph.nodes[0], zone: "missing-zone" }],
      },
      sample.entities.map((e) => ({
        id: e.id,
        lifecycle: e.lifecycle,
        scope: e.scope,
      })),
      servicesWithOverrides.map((s) => ({ id: s.id, entityId: s.entityId })),
    ),
  );
  assert.throws(() =>
    validateCyber(
      {
        ...customGraph,
        zones: [customGraph.zones[0], customGraph.zones[0]],
      },
      sample.entities.map((e) => ({
        id: e.id,
        lifecycle: e.lifecycle,
        scope: e.scope,
      })),
      servicesWithOverrides.map((s) => ({ id: s.id, entityId: s.entityId })),
    ),
  );
});

test("cyber node sizes (large/medium/small), quiet subordinate edges, and persistence follow precedence", async (t) => {
  const { store, home, send } = await fixture(t);
  const hostId = home.entities.find(
    (e) => e.category === "host" && e.scope === "home",
  )!.id;
  const secondHostId = home.entities.find(
    (e) => e.category === "host" && e.scope === "home" && e.id !== hostId,
  )!.id;

  const services = [
    ...home.services,
    {
      id: "svc-override-small",
      entityId: hostId,
      name: "Service Sized Small",
      version: "1.0.0",
      embed: "unverified" as const,
      description: "Explicit service size",
      size: "small" as const,
      asOf: "2026-11-16T00:00:00Z",
      demo: false,
    },
  ];

  const nodes: CyberGraph["nodes"] = [
    {
      id: "beszel-hub",
      label: "Beszel Hub",
      host: hostId,
      kind: "service",
      groups: ["ops"],
    },
    {
      id: "beszel-agent-1",
      label: "beszel-agent · mini",
      host: secondHostId,
      kind: "service",
      groups: ["ops"],
    },
    {
      id: "portainer-agent-1",
      label: "Portainer agent · mini",
      host: secondHostId,
      kind: "service",
      groups: ["ops"],
    },
    {
      id: "lobe-pg",
      label: "Lobe ParadeDB",
      host: hostId,
      kind: "database",
      groups: ["ai"],
    },
    {
      id: "lobe-redis",
      label: "Lobe Redis",
      host: hostId,
      kind: "service",
      layer: "middleware",
      groups: ["ai"],
    },
    {
      id: "ai-agent-app",
      label: "AI Agent Workspace",
      host: hostId,
      kind: "service",
      groups: ["ai"],
    },
    {
      id: "svc-inherited",
      label: "Inherited Small",
      host: hostId,
      serviceId: "svc-override-small",
      kind: "service",
      groups: ["ops"],
    },
    {
      id: "pg-promoted",
      label: "Primary Postgres",
      host: hostId,
      kind: "database",
      size: "large",
      groups: ["ai"],
    },
  ];

  const edges: CyberGraph["edges"] = [
    {
      id: "e-agent-hub",
      source: "beszel-agent-1",
      target: "beszel-hub",
      label: "WS",
      groups: ["ops"],
    },
    {
      id: "e-agent-forced-always",
      source: "beszel-hub",
      target: "portainer-agent-1",
      label: "HTTPS",
      visibility: "always",
      groups: ["ops"],
    },
    {
      id: "e-app-db",
      source: "ai-agent-app",
      target: "lobe-pg",
      label: "SQL",
      groups: ["ai"],
    },
    {
      id: "e-app-hover",
      source: "ai-agent-app",
      target: "pg-promoted",
      label: "Admin",
      visibility: "hover",
      groups: ["ai"],
    },
  ];

  const cls = classifyCyberNodes(nodes, edges, services);
  assert.equal(cls.get("beszel-hub")?.size, "large");
  assert.equal(cls.get("beszel-hub")?.sizeSource, "fallback");
  assert.equal(cls.get("beszel-agent-1")?.size, "small");
  assert.equal(cls.get("beszel-agent-1")?.sizeSource, "rule");
  assert.equal(cls.get("portainer-agent-1")?.size, "small");
  assert.equal(cls.get("lobe-pg")?.size, "medium");
  assert.equal(cls.get("lobe-pg")?.sizeSource, "kind");
  assert.equal(cls.get("lobe-redis")?.size, "medium");
  assert.equal(cls.get("lobe-redis")?.sizeSource, "rule");
  // Non-monitoring AI workspace with "Agent" in label remains large.
  assert.equal(cls.get("ai-agent-app")?.size, "large");
  assert.equal(cls.get("svc-inherited")?.size, "small");
  assert.equal(cls.get("svc-inherited")?.sizeSource, "service");
  assert.equal(cls.get("pg-promoted")?.size, "large");
  assert.equal(cls.get("pg-promoted")?.sizeSource, "node");

  assert.equal(isCyberEdgeQuiet(edges[0]!, cls), true);
  assert.equal(isCyberEdgeQuiet(edges[1]!, cls), false);
  assert.equal(isCyberEdgeQuiet(edges[2]!, cls), false);
  assert.equal(isCyberEdgeQuiet(edges[3]!, cls), true);

  // Within the same layer (infra), large nodes preview ahead of small subordinate agents.
  const ordered = orderHostPreviewNodes(
    [
      nodes.find((n) => n.id === "beszel-agent-1")!,
      {
        id: "uptime-main",
        label: "Uptime Kuma",
        host: secondHostId,
        kind: "service",
        groups: ["ops"],
      },
    ],
    edges,
    services,
  );
  assert.equal(ordered[0]?.id, "uptime-main");
  assert.equal(ordered[1]?.id, "beszel-agent-1");

  const graph = cyberSchema.parse({
    version: 1,
    source: "size-hierarchy-test",
    asOf: "2026-11-16T00:00:00Z",
    clouds: [],
    nodes,
    edges,
  });
  await send({ type: "service.upsert", service: services.at(-1)! });
  await send({ type: "cyber.replace", graph });

  const topo = buildTopologyViewModel({
    fullGraph: graph,
    activeGraph: graph,
    entities: home.entities,
    services,
  });
  assert.ok(topo.quietEdgeIds.has("e-agent-hub"));
  assert.ok(topo.quietEdgeIds.has("e-app-hover"));
  assert.ok(!topo.quietEdgeIds.has("e-agent-forced-always"));
  assert.ok(!topo.quietEdgeIds.has("e-app-db"));

  const inspected = buildCyberInspection(await store.snapshot());
  assert.equal(
    inspected.nodes.find((n) => n.id === "beszel-agent-1")?.effective.size,
    "small",
  );
  assert.equal(
    inspected.nodes.find((n) => n.id === "lobe-pg")?.effective.size,
    "medium",
  );
  assert.ok(inspected.quietEdgeIds.includes("e-agent-hub"));
  assert.equal(
    inspected.edges.find((e) => e.id === "e-agent-hub")?.effectiveVisibility,
    "hover",
  );
  assert.equal(
    inspected.edges.find((e) => e.id === "e-agent-forced-always")
      ?.effectiveVisibility,
    "always",
  );
});
