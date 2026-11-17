import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateStore } from "../server/state.js";
import { importModel, importedModels } from "../server/assets.js";
import {
  validateTemplate,
  type Action,
  type HomeTemplate,
  type Entity,
} from "../shared/domain.js";
import {
  planSurface,
  corners,
  overlaps,
  eligible,
  inspectionItems,
} from "../shared/spatial.js";
import { layoutChanges } from "../shared/layout.js";
const sample = JSON.parse(
  await readFile(new URL("../examples/studio.json", import.meta.url), "utf8"),
) as HomeTemplate;
function home() {
  const h = structuredClone(sample);
  h.schematic = false;
  h.assets.push(
    {
      id: "desk-asset",
      name: "Desk",
      kind: "table",
      width: 1.6,
      height: 0.75,
      depth: 0.8,
      color: "#aaaaaa",
      provenance: "Synthetic test",
    },
    {
      id: "cabinet-asset",
      name: "Wardrobe",
      kind: "wardrobe",
      width: 1.2,
      height: 1.8,
      depth: 0.6,
      color: "#bbbbbb",
      provenance: "Synthetic test",
    },
  );
  const e = (
    id: string,
    assetId: string,
    position: [number, number, number],
  ): Entity => ({
    ...h.entities[0],
    id,
    name: id,
    category: "object",
    assetId,
    position,
  });
  h.entities.push(
    e("desk", "desk-asset", [0, 0, 1]),
    e("wardrobe", "cabinet-asset", [0, 0, -1]),
    e("inner-case", "cabinet-asset", [1.5, 0, -1]),
  );
  return validateTemplate(h);
}
async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "spatial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root, home());
  await store.snapshot();
  const command = async (action: Action) => ({
    operationId: randomUUID(),
    expectedRevision: (await store.snapshot()).revision,
    issuedAt: new Date().toISOString(),
    action,
  });
  return {
    root,
    store,
    command,
    send: async (action: Action) => store.execute(await command(action)),
  };
}
test("storage slots persist and replay, reject occupied slots, shrinking, remote records and nested cycles atomically", async (t) => {
  const { root, store, command, send } = await fixture(t);
  const input = await command({
    type: "storage.place",
    itemId: "studio-mini",
    containerId: "wardrobe",
    slot: 3,
  });
  const first = await store.execute(input);
  assert.deepEqual(await new StateStore(root, home()).execute(input), first);
  assert.equal((await store.snapshot()).home.entities[0].attachment?.slot, 3);
  const before = await store.snapshot();
  for (const action of [
    {
      type: "storage.place",
      itemId: "desk-plug",
      containerId: "wardrobe",
      slot: 3,
    },
    {
      type: "storage.configure",
      storage: { entityId: "wardrobe", columns: 1, rows: 1 },
    },
    {
      type: "storage.place",
      itemId: "cloud-node",
      containerId: "wardrobe",
      slot: 0,
    },
    {
      type: "storage.place",
      itemId: "wardrobe",
      containerId: "wardrobe",
      slot: 0,
    },
  ] as Action[])
    await assert.rejects(send(action));
  assert.deepEqual(await store.snapshot(), before);
  await send({
    type: "storage.place",
    itemId: "inner-case",
    containerId: "wardrobe",
    slot: 0,
  });
  await assert.rejects(
    send({
      type: "storage.place",
      itemId: "wardrobe",
      containerId: "inner-case",
      slot: 0,
    }),
    /cycle/,
  );
  await send({
    type: "storage.place",
    itemId: "cat-litter",
    containerId: "wardrobe",
    slot: 1,
  });
  await send({ type: "stock.adjust", stockId: "cat-litter", delta: 1 });
  assert.equal((await store.snapshot()).home.stocks[0].quantity, 4);
  assert.deepEqual((await store.snapshot()).home.services, sample.services);
});
test("surface solver avoids recorded objects, handles rotation, full surfaces, and preserves results on replay", async (t) => {
  const { store, send, command } = await fixture(t);
  await send({
    type: "surface.place",
    itemId: "studio-mini",
    supportId: "desk",
    preferred: [0, 0],
    quarterTurn: false,
  });
  const input = await command({
    type: "surface.place",
    itemId: "desk-plug",
    supportId: "desk",
    preferred: [0, 0],
    quarterTurn: true,
  });
  const receipt = await store.execute(input);
  assert.deepEqual(await store.execute(input), receipt);
  const h = (await store.snapshot()).home,
    a = h.entities.find((e) => e.id === "studio-mini")!,
    b = h.entities.find((e) => e.id === "desk-plug")!;
  const aa = h.assets.find((x) => x.id === a.assetId)!,
    ba = h.assets.find((x) => x.id === b.assetId)!;
  assert.equal(a.position[1], 0.75);
  assert.equal(b.position[1], 0.75);
  assert.equal(
    overlaps(
      corners([a.position[0], a.position[2]], aa.width, aa.depth, a.rotation),
      corners([b.position[0], b.position[2]], ba.width, ba.depth, b.rotation),
    ),
    false,
  );
  const blocked = structuredClone(h),
    desk = blocked.entities.find((e) => e.id === "desk")!;
  blocked.assets.push({
    ...aa,
    id: "obstacle-asset",
    width: 1.6,
    height: 0.4,
    depth: 0.8,
  });
  blocked.entities.push({
    ...a,
    id: "obstacle",
    assetId: "obstacle-asset",
    position: [...desk.position.slice(0, 1), 0.75, desk.position[2]] as [
      number,
      number,
      number,
    ],
    attachment: undefined,
  });
  assert.throws(() => planSurface(blocked, b.id, desk.id), /没有足够空位/);
  const before = await store.snapshot();
  await assert.rejects(
    send({
      type: "surface.place",
      itemId: "wardrobe",
      supportId: "desk",
      quarterTurn: true,
    }),
    /超出/,
  );
  assert.deepEqual(await store.snapshot(), before);
});
test("parent translations and rotations carry explicit attachments, while manual child moves detach", async (t) => {
  const { store, send } = await fixture(t);
  await send({
    type: "surface.place",
    itemId: "studio-mini",
    supportId: "desk",
    preferred: [0.3, 0],
    quarterTurn: false,
  });
  const before = (await store.snapshot()).home;
  await send({
    type: "entity.place",
    entityId: "desk",
    locationId: "study",
    position: [0, 0, 0],
    rotation: Math.PI / 2,
  });
  const h = (await store.snapshot()).home,
    child = h.entities[0];
  assert.ok(Math.abs(child.position[2] + 0.3) < 1e-6);
  assert.ok(Math.abs(child.rotation - Math.PI / 2) < 1e-6);
  assert.equal(child.attachment?.parentId, "desk");
  assert.deepEqual(h.services, before.services);
  // Generated layout changes omit inherited child movement and retain the link.
  const draft = structuredClone(h);
  draft.entities.find((e) => e.id === "desk")!.position = [0.1, 0, 0];
  draft.entities[0].position[0] += 0.1;
  const action = layoutChanges(h, draft);
  assert.deepEqual(
    action.placements.map((p) => p.id),
    ["desk"],
  );
  await send(action);
  assert.equal(
    (await store.snapshot()).home.entities[0].attachment?.parentId,
    "desk",
  );
  await send({
    type: "entity.place",
    entityId: "studio-mini",
    locationId: "study",
    position: [-1, 0, 0],
    rotation: 0,
  });
  assert.equal((await store.snapshot()).home.entities[0].attachment, undefined);
});
test("logical modes select meaningful records without treating furniture as equipment", () => {
  const h = home(),
    desk = h.entities.find((e) => e.id === "desk")!,
    wardrobe = h.entities.find((e) => e.id === "wardrobe")!;
  assert.equal(eligible(h, desk, "devices"), false);
  assert.equal(eligible(h, wardrobe, "inventory"), true);
  assert.equal(eligible(h, h.entities[0], "devices"), true);
  assert.equal(eligible(h, h.stocks[0], "devices"), false);
});
test("GLB compatibility imports persist by content and reject external resources and truncated data", async (t) => {
  const { root } = await fixture(t);
  const bytes = await readFile(
    new URL("../public/models/offline-robot.glb", import.meta.url),
  );
  const first = await importModel(root, bytes, "fixture.glb"),
    second = await importModel(root, bytes, "fixture.glb");
  assert.equal(first.url, second.url);
  assert.equal((await importedModels(root)).length, 1);
  assert.deepEqual(await readFile(join(root, "public", first.url)), bytes);
  await assert.rejects(
    importModel(root, bytes.subarray(0, 30), "truncated.glb"),
    /truncated/,
  );
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ uri: "https://example.invalid/secret.bin" }],
    }).padEnd(128, " "),
  );
  const external = Buffer.alloc(20 + json.length);
  external.write("glTF");
  external.writeUInt32LE(2, 4);
  external.writeUInt32LE(external.length, 8);
  external.writeUInt32LE(json.length, 12);
  external.writeUInt32LE(0x4e4f534a, 16);
  json.copy(external, 20);
  await assert.rejects(
    importModel(root, external, "external.glb"),
    /external resources/,
  );
  assert.equal((await importedModels(root)).length, 1);
});

test("model attribution survives reuse, restart and template import without overwriting a different source", async (t) => {
  const { root, store, send, command } = await fixture(t);
  const bytes = await readFile(
    new URL("../public/models/offline-robot.glb", import.meta.url),
  );
  const source = {
    platform: "Offline fixture catalog",
    url: "https://example.org/models/robot",
    author: "Fixture author",
    license: "Synthetic test metadata",
  };
  const [first, retry] = await Promise.all([
    importModel(root, bytes, "robot.glb", source),
    importModel(root, bytes, "robot.glb", {
      license: source.license,
      author: source.author,
      url: source.url,
      platform: source.platform,
    }),
  ]);
  assert.equal(first.id, retry.id);
  const different = await importModel(root, bytes, "robot.glb", {
    ...source,
    author: "Another author",
  });
  const unknown = await importModel(root, bytes, "robot.glb");
  assert.notEqual(first.id, different.id);
  assert.equal(first.url, different.url);
  assert.equal(first.url, unknown.url);
  assert.equal(unknown.source, undefined);
  const library = await importedModels(root);
  assert.equal(library.length, 3);
  assert.deepEqual(library.find((m) => m.id === first.id)?.source, source);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,test",
    "https://user:password@example.org/model",
    "not-a-url",
  ]) {
    await assert.rejects(
      importModel(root, bytes, "unsafe.glb", { ...source, url }),
    );
  }
  assert.equal((await importedModels(root)).length, 3);
  const before = await store.snapshot();
  const original = before.home.assets.find(
    (a) => a.id === before.home.entities[0].assetId,
  )!;
  const input = await command({
    type: "object.model",
    entityId: "studio-mini",
    asset: {
      ...original,
      id: "sourced-model",
      detailUrl: first.url,
      source: first.source,
    },
  });
  const receipt = await store.execute(input);
  const restarted = new StateStore(root, home());
  assert.deepEqual(await restarted.execute(input), receipt);
  const after = await restarted.snapshot();
  assert.deepEqual(after.home.entities[0], {
    ...before.home.entities[0],
    assetId: "sourced-model",
  });
  assert.deepEqual(after.home.services, before.home.services);
  assert.deepEqual(
    after.home.assets.find((a) => a.id === "sourced-model")?.source,
    source,
  );
  await send({
    type: "template.import",
    template: validateTemplate(JSON.parse(JSON.stringify(after.home))),
  });
  assert.deepEqual(
    (await store.snapshot()).home.assets.find((a) => a.id === "sourced-model")
      ?.source,
    source,
  );
});

test("round tabletop placement keeps every corner inside the actual top", () => {
  const h = home(),
    a = h.assets.find((a) => a.id === "desk-asset")!;
  a.kind = "round-storage-table";
  a.width = 0.8;
  a.depth = 0.8;
  const plan = planSurface(h, "studio-mini", "desk", [0.35, 0.35]);
  for (const [x, z] of corners(plan.local, plan.width, plan.depth, 0))
    assert.ok(x * x + z * z <= (0.4 - 0.015) ** 2 + 1e-9);
});

test("fixed mounts preserve elevated nested poses across moves and restart, reject cycles and stored parents", async (t) => {
  const { root, store, send, command } = await fixture(t);
  await send({
    type: "entity.place",
    entityId: "studio-mini",
    locationId: "study",
    position: [0.3, 1.1, 1],
    rotation: 0,
  });
  const mount = await command({
    type: "object.mount",
    entityId: "studio-mini",
    parentId: "desk",
  });
  const receipt = await store.execute(mount);
  assert.deepEqual(await new StateStore(root, home()).execute(mount), receipt);
  const stable = (await store.snapshot()).home.entities[0];
  await send({ type: "entity.note", entityId: "desk", notes: "No movement" });
  assert.deepEqual((await store.snapshot()).home.entities[0], stable);
  const before = await store.snapshot();
  await assert.rejects(
    send({ type: "object.mount", entityId: "desk", parentId: "studio-mini" }),
    /cycle/,
  );
  await assert.rejects(
    send({
      type: "object.mount",
      entityId: "studio-mini",
      parentId: "cloud-node",
    }),
    /physical/,
  );
  assert.deepEqual(await store.snapshot(), before);
  await send({
    type: "entity.place",
    entityId: "desk",
    locationId: "study",
    position: [0, 0.2, 0],
    rotation: Math.PI / 2,
  });
  const mounted = (await store.snapshot()).home.entities[0];
  assert.ok(Math.abs(mounted.position[1] - 1.3) < 1e-8);
  assert.ok(Math.abs(mounted.position[2] + 0.3) < 1e-8);
  assert.equal(mounted.attachment?.kind, "mount");
  assert.deepEqual(
    [...inspectionItems((await store.snapshot()).home, "desk")],
    ["desk", "studio-mini"],
  );
  await send({
    type: "storage.place",
    itemId: "inner-case",
    containerId: "wardrobe",
    slot: 0,
  });
  await assert.rejects(
    send({
      type: "object.mount",
      entityId: "studio-mini",
      parentId: "inner-case",
    }),
    /stored/,
  );
  await send({
    type: "entity.place",
    entityId: "studio-mini",
    locationId: "study",
    position: [-1, 0, 0],
    rotation: 0,
  });
  assert.equal((await store.snapshot()).home.entities[0].attachment, undefined);
});

test("vanity, kitchen and basket table retain storage eligibility and small objects retain their support context", async () => {
  const h = home();
  for (const kind of [
    "sink",
    "kitchen-counter",
    "round-storage-table",
    "box",
  ] as const) {
    h.assets.find((a) => a.id === "cabinet-asset")!.kind = kind;
    assert.equal(
      eligible(
        h,
        h.entities.find((e) => e.id === "wardrobe")!,
        "inventory",
      ),
      true,
    );
  }
  const { focusAnchor } = await import("../shared/spatial.js");
  h.entities[0].attachment = { parentId: "desk", kind: "mount" };
  assert.equal(focusAnchor(h, h.entities[0].id)?.id, "desk");
});

test("volume diagnostics preserve table legroom and distinguish contact from penetration", async () => {
  const { layoutConflicts } = await import("../shared/volumes.js");
  const h = home();
  const device = h.entities[0];
  device.position = [0, 0, 1];
  assert.equal(
    layoutConflicts(h, "study").some(
      (pair) =>
        pair.some((i) => i.id === "desk") &&
        pair.some((i) => i.id === device.id),
    ),
    false,
  );
  device.position = [0, 0.7, 1];
  assert.equal(
    layoutConflicts(h, "study").some(
      (pair) =>
        pair.some((i) => i.id === "desk") &&
        pair.some((i) => i.id === device.id),
    ),
    true,
  );
  device.position = [0, 0.75, 1];
  assert.equal(
    layoutConflicts(h, "study").some(
      (pair) =>
        pair.some((i) => i.id === "desk") &&
        pair.some((i) => i.id === device.id),
    ),
    false,
  );
});
