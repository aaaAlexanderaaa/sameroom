import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateTemplate } from "../shared/domain.js";
import { StateStore } from "../server/state.js";

test("the reviewed public seed installs only the selected application demo and referenced icons", async (t) => {
  const seed = await readFile(
    new URL("../data/dashboard/initial-home.json", import.meta.url),
  );
  const home = validateTemplate(JSON.parse(seed.toString("utf8")));
  const release = JSON.parse(
    await readFile(
      new URL("../scripts/public-files.json", import.meta.url),
      "utf8",
    ),
  ) as { demoSeedSha256: string; files: string[] };
  assert.equal(
    createHash("sha256").update(seed).digest("hex"),
    release.demoSeedSha256,
  );
  assert.deepEqual(
    home.entities
      .filter((e) => e.category === "host")
      .map((e) => e.id)
      .sort(),
    ["am4", "n100", "utm", "ve8-sh"],
  );
  assert.deepEqual(
    home.entities.filter((e) => e.scope === "remote").map((e) => e.id),
    ["ve8-sh"],
  );
  assert.deepEqual(home.services.map((s) => s.id).sort(), [
    "alist",
    "bark",
    "dashy",
    "electerm-sync",
    "electerm-ve8",
    "gitea",
    "home-atlas",
    "lobehub",
    "n8n-main",
    "openlist",
    "portainer",
    "portainer-agent-am4",
    "portainer-agent-ve8",
    "searxng",
    "sunsetbot",
    "uptime-kuma",
    "wallos",
    "webapp-edge-1",
  ]);
  for (const service of home.services) {
    assert.equal(service.demo, true);
    assert.equal(service.version, "demo");
    assert.equal(service.boundary, undefined);
    assert.notEqual(service.layer, "boundary");
    assert.notEqual(service.category, "relay");
  }
  const graph = home.cyber!;
  assert.deepEqual(
    graph.nodes.map((n) => n.id).sort(),
    [
      ...home.services.map((s) => s.id),
      "lobe-postgres",
      "lobe-redis",
      "webapp-db-1",
    ].sort(),
  );
  for (const node of graph.nodes) {
    assert.equal(node.boundary, undefined);
    assert.notEqual(node.kind, "gateway");
    assert.notEqual(node.kind, "external");
    assert.deepEqual(node.groups, ["架构"]);
  }
  assert.equal(graph.edges.length, 8);
  for (const edge of graph.edges) assert.deepEqual(edge.groups, ["架构"]);
  assert.deepEqual(
    graph.clouds.map((c) => c.host),
    ["ve8-sh"],
  );
  assert.deepEqual(Object.keys(graph.topologies!), ["架构"]);

  const iconIds = new Set(
    [...home.services, ...graph.nodes]
      .map((item) => item.icon)
      .filter((icon): icon is string => !!icon?.startsWith("/api/icons/"))
      .map((icon) => icon.slice("/api/icons/".length)),
  );
  assert.deepEqual(
    release.files
      .filter((path) => path.startsWith("data/icon-library/"))
      .sort(),
    [...iconIds]
      .flatMap((id) => [
        `data/icon-library/${id}.json`,
        `data/icon-library/${id}.png`,
      ])
      .sort(),
  );

  const root = await mkdtemp(join(tmpdir(), "sameroom-public-demo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await new StateStore(root, home).snapshot();
  assert.deepEqual(first.home, home);
  assert.deepEqual(await new StateStore(root, home).snapshot(), first);
});
