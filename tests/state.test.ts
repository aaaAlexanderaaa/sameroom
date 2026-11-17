import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StateStore } from "../server/state.js";
import {
  validateTemplate,
  resizedRoom,
  observationState,
  type Action,
  type IngestEvent,
} from "../shared/domain.js";

const sample = validateTemplate(
  JSON.parse(
    await readFile(new URL("../examples/studio.json", import.meta.url), "utf8"),
  ),
);
const cmd = (action: Action, expectedRevision = 0) => ({
  operationId: randomUUID(),
  expectedRevision,
  issuedAt: new Date().toISOString(),
  action,
});
const event = (overrides: Partial<IngestEvent> = {}): IngestEvent => ({
  schemaVersion: 1,
  eventId: randomUUID(),
  source: "uptime-test",
  subjectId: "studio-mini",
  condition: "availability",
  status: "open",
  severity: "warning",
  message: "Test unavailable",
  observedAt: new Date(Date.now() - 1000).toISOString(),
  ttlSeconds: 10,
  ...overrides,
});
async function fixture(t: { after: (f: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "home-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new StateStore(root, sample);
  await store.snapshot();
  return { root, store };
}

test("inventory replay after restart returns the original receipt, conflicting ID and revision do not modify stock", async (t) => {
  const { root, store } = await fixture(t);
  const input = cmd({ type: "stock.adjust", stockId: "cat-litter", delta: 1 });
  const first = await store.execute(input);
  const restarted = new StateStore(root, sample);
  assert.deepEqual(await restarted.execute(input), first);
  assert.equal((await restarted.snapshot()).home.stocks[0].quantity, 4);
  await assert.rejects(
    restarted.execute({ ...input, action: { ...input.action, delta: 2 } }),
    /different input/,
  );
  await assert.rejects(
    restarted.execute(
      cmd({ type: "stock.adjust", stockId: "cat-litter", delta: 1 }),
    ),
    /State changed/,
  );
  await assert.rejects(
    restarted.execute(
      cmd({ type: "stock.adjust", stockId: "cat-litter", delta: -5 }, 1),
    ),
    /Quantity/,
  );
  const snapshot = await restarted.snapshot();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.home.stocks[0].quantity, 4);
});
test("two processes cannot commit against the same revision; transfer is atomic", async (t) => {
  const { root, store } = await fixture(t);
  const other = new StateStore(root, sample);
  const results = await Promise.allSettled(
    [store, other].map((s) =>
      s.execute(cmd({ type: "stock.adjust", stockId: "cat-litter", delta: 1 })),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await store.execute(
    cmd(
      {
        type: "stock.create",
        stock: { ...sample.stocks[0], id: "reserve", quantity: 0 },
      },
      1,
    ),
  );
  const transfer = cmd(
    {
      type: "stock.transfer",
      fromId: "cat-litter",
      toId: "reserve",
      quantity: 2,
    },
    2,
  );
  await store.execute(transfer);
  await other.execute(transfer);
  assert.deepEqual(
    (await store.snapshot()).home.stocks.map((s) => s.quantity),
    [2, 2],
  );
  await assert.rejects(
    store.execute(cmd({ ...transfer.action, quantity: 3 } as Action, 3)),
    /Insufficient/,
  );
  assert.deepEqual(
    (await store.snapshot()).home.stocks.map((s) => s.quantity),
    [2, 2],
  );
});
test("template validation and placement reject broken references without partially committing", async (t) => {
  const { store } = await fixture(t);
  const bad = structuredClone(sample);
  bad.entities[0].assetId = "missing";
  await assert.rejects(
    store.execute(cmd({ type: "template.import", template: bad })),
    /Unknown location/,
  );
  await assert.rejects(
    store.execute(
      cmd({
        type: "entity.place",
        entityId: "cloud-node",
        locationId: "study",
        position: [0, 0, 0],
        rotation: 0,
      }),
    ),
    /mismatch/,
  );
  await assert.rejects(
    store.execute(
      cmd({
        type: "entity.place",
        entityId: "studio-mini",
        locationId: "study",
        position: [9, 0, 0],
        rotation: 0,
      }),
    ),
    /outside/,
  );
  assert.equal((await store.snapshot()).revision, 0);
  await store.execute(
    cmd({
      type: "entity.place",
      entityId: "studio-mini",
      locationId: "living",
      position: [1, 0, 1],
      rotation: 0,
    }),
  );
  assert.equal(
    (await store.snapshot()).home.entities[0].placementConfirmed,
    true,
  );
});
test("notification duplicates and out-of-order recovery cannot overwrite newer truth; acknowledgement is not resolution", async (t) => {
  const { store } = await fixture(t);
  const first = event();
  await store.ingest(first);
  assert.equal((await store.ingest(first)).duplicate, true);
  assert.equal((await store.snapshot()).incidents[0].count, 1);
  await assert.rejects(
    store.ingest({ ...first, message: "Changed body" }),
    /different content/,
  );
  const snapshot = await store.snapshot();
  await store.execute(
    cmd(
      { type: "incident.ack", incidentId: snapshot.incidents[0].id },
      snapshot.revision,
    ),
  );
  assert.equal((await store.snapshot()).incidents[0].state, "acknowledged");
  const recovery = event({
    status: "resolved",
    observedAt: new Date().toISOString(),
  });
  await store.ingest(recovery);
  assert.equal(
    (await store.ingest(event({ observedAt: first.observedAt }))).disposition,
    "older",
  );
  const final = await store.snapshot();
  assert.equal(final.incidents[0].state, "resolved");
  assert.equal(observationState(final.observations[0]), "up");
  assert.equal(
    observationState(final.observations[0], Date.now() + 11000),
    "stale",
  );
  assert.equal(observationState(undefined), "unknown");
});
test("unmapped and retired targets stay unmapped, demo provenance stays explicit", async (t) => {
  const { store, root } = await fixture(t);
  const home = structuredClone(sample);
  home.entities.push({
    ...sample.entities[0],
    id: "retired",
    lifecycle: "retired",
  });
  await store.execute(cmd({ type: "template.import", template: home }));
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(root, "data/dashboard/backups/before-import-v0.json"),
        "utf8",
      ),
    ),
    sample,
  );
  await store.ingest(event({ subjectId: "not-a-host" }));
  await store.ingest(event({ subjectId: "retired" }));
  await store.ingest(event(), true);
  const snapshot = await store.snapshot();
  assert.equal(snapshot.unmapped.length, 2);
  assert.equal(snapshot.incidents.length, 1);
  assert.equal(snapshot.incidents[0].demo, true);
  assert.equal(snapshot.incidents[0].source, "demo.uptime-test");
});
test("old/future commands and corrupted state fail closed", async (t) => {
  const { root, store } = await fixture(t);
  const input = cmd({ type: "stock.adjust", stockId: "cat-litter", delta: 1 });
  for (const delta of [-25 * 3600000, 120000])
    await assert.rejects(
      store.execute({
        ...input,
        issuedAt: new Date(Date.now() + delta).toISOString(),
      }),
      /expired|future/,
    );
  await writeFile(join(root, "data/dashboard/state.json"), "{broken");
  await assert.rejects(store.snapshot());
  assert.equal(
    await readFile(join(root, "data/dashboard/state.json"), "utf8"),
    "{broken",
  );
});

test("layout commit preserves records and observations, isolates dimensions, backs up and replays after restart", async (t) => {
  const { root, store } = await fixture(t);
  await store.ingest(event());
  const before = await store.snapshot();
  const asset = {
    id: "desk-asset",
    name: "Desk",
    kind: "table" as const,
    width: 1.8,
    height: 0.75,
    depth: 0.8,
    color: "#ab9877",
    provenance: "Authored furniture; only footprint confirmed",
  };
  const entity = {
    ...sample.entities[0],
    id: "desk",
    name: "Desk",
    category: "object" as const,
    assetId: asset.id,
    position: [0, 0, 0] as [number, number, number],
    placementConfirmed: false,
  };
  const input = cmd(
    {
      type: "layout.commit",
      additions: [{ entity, asset }],
      placements: [
        {
          kind: "entity",
          id: "studio-mini",
          locationId: "living",
          position: [0.2, 0, 0.6],
          rotation: Math.PI / 2,
          placementConfirmed: true,
          asset: { ...sample.assets[0], id: "mini-resized", width: 0.6 },
        },
        {
          kind: "stock",
          id: "cat-litter",
          locationId: "living",
          position: [1, 0, 1],
          rotation: Math.PI / 2,
          placementConfirmed: false,
        },
      ],
    },
    before.revision,
  );
  const receipt = await store.execute(input);
  const restarted = new StateStore(root, sample);
  assert.deepEqual(await restarted.execute(input), receipt);
  const after = await restarted.snapshot();
  assert.equal(after.home.entities.filter((e) => e.id === "desk").length, 1);
  assert.equal(
    after.home.entities.find((e) => e.id === "desk")!.placementConfirmed,
    false,
  );
  assert.deepEqual(
    after.home.assets.find((a) => a.id === sample.assets[0].id),
    sample.assets[0],
  );
  assert.equal(after.home.stocks[0].quantity, before.home.stocks[0].quantity);
  assert.equal(after.home.stocks[0].rotation, Math.PI / 2);
  assert.deepEqual(after.home.services, before.home.services);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.incidents, before.incidents);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(
          root,
          "data/dashboard/backups",
          `before-layout-v${before.revision}.json`,
        ),
        "utf8",
      ),
    ),
    before.home,
  );
  await assert.rejects(
    restarted.execute(cmd({ ...input.action } as Action, before.revision)),
    /State changed/,
  );
});

test("invalid mixed layout batches cannot partially save furniture, overwrite shared assets or alter remote scope", async (t) => {
  const { store } = await fixture(t);
  const before = await store.snapshot();
  const valid = {
    kind: "entity" as const,
    id: "studio-mini",
    locationId: "study",
    position: [0.5, 0, 0.5] as [number, number, number],
    rotation: 0,
    placementConfirmed: true,
  };
  for (const invalid of [
    { ...valid, id: "cloud-node" },
    { ...valid, position: [99, 0, 0] as [number, number, number] },
    { ...valid, asset: { ...sample.assets[0], width: 0.9 } },
    { ...valid, id: "missing" },
  ]) {
    await assert.rejects(
      store.execute(
        cmd({
          type: "layout.commit",
          additions: [],
          placements: [valid, invalid],
        }),
      ),
    );
    assert.deepEqual(await store.snapshot(), before);
  }
  await assert.rejects(
    store.execute(
      cmd({
        type: "layout.commit",
        rooms: sample.rooms.map((r) =>
          r.id === "study" ? { ...r, size: [1, 1] } : r,
        ),
        additions: [],
        placements: [],
      }),
    ),
  );
  assert.deepEqual(await store.snapshot(), before);
});

test("electrical circuits persist independent outlets without inventing readings and reject invalid wiring atomically", async (t) => {
  const { root, store } = await fixture(t);
  const home = structuredClone(sample);
  const base = home.entities.find((e) => e.id === "studio-mini")!;
  home.assets.push({
    id: "test-strip-asset",
    name: "Test metered strip",
    kind: "smart-strip",
    width: 0.28,
    height: 0.035,
    depth: 0.065,
    color: "#dddddd",
    provenance: "Offline test fixture",
  });
  home.entities.push({
    ...base,
    id: "test-strip",
    name: "Test strip",
    category: "device",
    assetId: "test-strip-asset",
  });
  home.entities.push({ ...base, id: "second-load", name: "Second load" });
  await store.execute(cmd({ type: "template.import", template: home }));
  await store.ingest(event());
  const before = await store.snapshot();
  const circuit = {
    id: "test-bedside",
    name: "Bedside outlets",
    controllerEntityId: "test-strip",
    metering: "per-outlet" as const,
    channels: [
      { id: "first", name: "First host", entityIds: [base.id] },
      { id: "second", name: "Second host", entityIds: ["second-load"] },
    ],
    source: "owner" as const,
    asOf: "2026-11-13",
  };
  const input = cmd({ type: "electrical.upsert", circuit }, before.revision);
  const receipt = await store.execute(input);
  const restarted = new StateStore(root, sample);
  assert.deepEqual(await restarted.execute(input), receipt);
  const saved = await restarted.snapshot();
  assert.deepEqual(saved.home.electricalCircuits, [circuit]);
  assert.deepEqual(saved.observations, before.observations);
  assert.deepEqual(saved.home.services, before.home.services);
  assert.deepEqual(saved.home.entities, before.home.entities);
  for (const changed of [
    { ...circuit, controllerEntityId: "missing" },
    { ...circuit, metering: "aggregate" as const },
    {
      ...circuit,
      channels: [
        ...circuit.channels,
        { id: "third", name: "Duplicated load", entityIds: [base.id] },
      ],
    },
    {
      ...circuit,
      channels: [{ id: "bad", name: "Remote", entityIds: ["cloud-node"] }],
    },
    {
      ...circuit,
      channels: [{ id: "bad", name: "Self", entityIds: ["test-strip"] }],
    },
    {
      ...circuit,
      channels: circuit.channels.map((channel) => ({ ...channel, outlet: 1 })),
    },
  ]) {
    await assert.rejects(
      restarted.execute(
        cmd({ type: "electrical.upsert", circuit: changed }, saved.revision),
      ),
    );
    assert.deepEqual(await restarted.snapshot(), saved);
  }
  await assert.rejects(
    restarted.execute(
      cmd({ type: "electrical.upsert", circuit }, before.revision),
    ),
    /State changed/,
  );
  await restarted.execute(
    cmd(
      {
        type: "layout.commit",
        additions: [],
        placements: [
          {
            kind: "entity",
            id: base.id,
            locationId: "study",
            position: [0.5, 0.7, 0],
            rotation: 0,
            placementConfirmed: true,
          },
        ],
      },
      saved.revision,
    ),
  );
  assert.deepEqual((await restarted.snapshot()).home.electricalCircuits, [
    circuit,
  ]);
  const broken = structuredClone((await restarted.snapshot()).home);
  broken.entities = broken.entities.filter((e) => e.id !== "test-strip");
  assert.throws(() => validateTemplate(broken), /controller/);
});

test("concave floor footprint accepts balcony extensions, rejects returns and invalid polygons", () => {
  const home = structuredClone(sample);
  const room = home.rooms.find((r) => r.id === "study")!;
  room.size = [4, 6];
  room.footprint = [
    [-1.5, -3],
    [1.5, -3],
    [1.5, 1.7],
    [1.4, 1.7],
    [1.4, 2],
    [2, 2],
    [2, 3],
    [-2, 3],
    [-2, 2],
    [-1.5, 2],
  ];
  for (const item of [...home.entities, ...home.stocks].filter(
    (e) => e.locationId === room.id,
  ))
    item.position = [0, 0, 0];
  const entity = home.entities.find((e) => e.locationId === room.id)!;
  entity.position = [1.8, 0, 2.5];
  assert.doesNotThrow(() => validateTemplate(home));
  entity.position = [1.45, 0, 1.85];
  assert.throws(() => validateTemplate(home), /floor footprint/);
  entity.position = [1.8, 0, 1];
  assert.throws(() => validateTemplate(home), /floor footprint/);
  entity.position = [1.4, 0, 1.85];
  assert.doesNotThrow(() => validateTemplate(home));
  const asset = home.assets.find((a) => a.id === entity.assetId)!;
  asset.kind = "wall-return";
  entity.position = [1.45, 0, 1.85];
  assert.doesNotThrow(() => validateTemplate(home));
  const resized = resizedRoom(room, [8, 12]);
  assert.deepEqual(resized.footprint![3], [2.8, 3.4]);
  assert.deepEqual(room.footprint[3], [1.4, 1.7]);
  for (const size of [
    [0, 6],
    [4, NaN],
    [31, 6],
  ] as [number, number][])
    assert.deepEqual(resizedRoom(room, size), room);
  for (const polygon of [
    [
      [-1, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
    ],
    [
      [-1, -1],
      [1, -1],
      [1, -1],
      [0, 1],
    ],
    [
      [-3, -1],
      [1, -1],
      [0, 1],
    ],
    [
      [0, 0],
      [0.01, 0],
      [0, 0.01],
    ],
  ]) {
    room.footprint = polygon as [number, number][];
    assert.throws(() => validateTemplate(home), /footprint/);
  }
});

test("entity description commands persist visibility and retain identity, runtime, notes and services", async (t) => {
  const { root, store } = await fixture(t);
  await store.execute(
    cmd({
      type: "entity.note",
      entityId: "studio-mini",
      notes: "Keep this owner note.",
    }),
  );
  await store.ingest(event());
  const before = await store.snapshot();
  const input = cmd(
    {
      type: "entity.describe",
      entityId: "studio-mini",
      name: "Renamed device",
      description: "Corrected description",
      visibility: "editing",
    },
    before.revision,
  );
  const receipt = await store.execute(input);
  const restart = new StateStore(root, sample);
  assert.deepEqual(await restart.execute(input), receipt);
  const after = await restart.snapshot();
  assert.deepEqual(
    after.home.entities.find((e) => e.id === "studio-mini"),
    {
      ...before.home.entities.find((e) => e.id === "studio-mini"),
      name: "Renamed device",
      description: "Corrected description",
      visibility: "editing",
    },
  );
  assert.deepEqual(after.home.services, before.home.services);
  assert.deepEqual(after.observations, before.observations);
  assert.deepEqual(after.incidents, before.incidents);
  await assert.rejects(
    restart.execute(
      cmd(
        { type: "entity.describe", entityId: "studio-mini", name: "Stale" },
        before.revision,
      ),
    ),
    /State changed/,
  );
  await assert.rejects(
    restart.execute(
      cmd({ type: "entity.describe", entityId: "studio-mini" }, after.revision),
    ),
    /description field/,
  );
  assert.deepEqual(await restart.snapshot(), after);
});
