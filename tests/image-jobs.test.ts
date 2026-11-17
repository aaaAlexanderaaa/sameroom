import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { createLux3dClient } from "@manycore/aholo-sdk-lux3d";
import { Jobs, type ImageSource } from "../scripts/lib/jobs.js";
import { Store, type Job } from "../scripts/lib/store.js";
import { createHash } from "node:crypto";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "home-image-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const images = await Promise.all([
    sharp({ create: { width: 8, height: 8, channels: 4, background: "#0000" } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 8, height: 8, channels: 3, background: "#abc" } })
      .jpeg()
      .toBuffer(),
  ]);
  const sources: ImageSource[] = [];
  for (let index = 0; index < images.length; index++) {
    const path = join(root, index === 0 ? "front.png" : "side.jpg");
    await writeFile(path, images[index]);
    sources.push({
      path,
      sha256: createHash("sha256").update(images[index]).digest("hex"),
      providerId: "lux3d",
      connectionId: "connection-before-key-change",
    });
  }
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  const intents: Job[] = [];
  const connections: (string | undefined)[] = [];
  let uncertain = false;
  let status = 3;
  const store = new Store(root);
  const api = createLux3dClient({
    apiKey: "test-only",
    region: "cn",
    fetch: async (url, options) => {
      if (options?.method === "POST") {
        calls.push({
          path: new URL(String(url)).pathname,
          body: JSON.parse(String(options.body)),
        });
        // Capture evidence here; assert outside the intentionally failing transport.
        intents.push(
          ...(await store.all()).filter((job) => job.phase === "submitting"),
        );
        if (uncertain) throw new Error("Response lost after acceptance");
        return Response.json({ c: "0", d: 77, m: "", f: null });
      }
      return Response.json({
        c: "0",
        d: { taskId: 77, status, outputs: [] },
        m: "",
        f: null,
      });
    },
  });
  const restart = () =>
    new Jobs(new Store(root), (job) => {
      connections.push(job?.connectionId);
      return api;
    });
  return {
    root,
    sources,
    images,
    calls,
    intents,
    connections,
    store,
    api,
    jobs: restart(),
    restart,
    loseResponse: () => {
      uncertain = true;
    },
    setStatus: (value: number) => {
      status = value;
    },
  };
}

test("installed SDK sends ordered image data URLs in one multi-view create after journaling every view", async (t) => {
  for (const version of ["G1", "G1-Turbo"]) {
    await t.test(version, async (t) => {
      const f = await fixture(t);
      const result = await f.jobs.submitImages("views", { version }, f.sources);
      assert.equal(result.job.phase, "submitted");
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].path, "/lux3d/v1/generate/img-to-3d/task/create");
      assert.equal(f.calls[0].body.img, undefined);
      assert.deepEqual(f.calls[0].body.imgs, [
        "data:image/png;base64," + f.images[0].toString("base64"),
        "data:image/jpeg;base64," + f.images[1].toString("base64"),
      ]);
      assert.equal(f.calls[0].body.version, version);
      assert.equal(f.intents.length, 1);
      assert.equal(f.intents[0].taskId, undefined);
      assert.deepEqual(
        f.intents[0].inputs,
        f.sources.map(({ path, sha256 }) => ({ path, sha256 })),
      );
      assert.equal(f.intents[0].input?.sha256, f.sources[0].sha256);
      assert.equal(f.intents[0].connectionId, f.sources[0].connectionId);
      assert.equal(
        (await f.restart().submitImages("alias", { version }, f.sources))
          .reused,
        true,
      );
      assert.equal(f.calls.length, 1);
    });
  }
});

test("single-view sets retain the legacy fingerprint and SDK img shape", async (t) => {
  const f = await fixture(t);
  const source = f.sources[0];
  const { job } = await f.jobs.submitImage("single", {}, source);
  const legacyHash = createHash("sha256")
    .update(
      JSON.stringify({
        kind: "image-to-3d",
        region: "cn",
        params: job.params,
        sha256: source.sha256,
        providerId: source.providerId,
        connectionId: source.connectionId,
      }),
    )
    .digest("hex");
  assert.equal(job.fingerprint, legacyHash);
  assert.equal(job.inputs, undefined);
  assert.equal(f.calls[0].body.imgs, undefined);
  assert.equal(
    f.calls[0].body.img,
    "data:image/png;base64," + f.images[0].toString("base64"),
  );
  assert.equal(
    (await f.restart().submitImages("alias", {}, [source])).job.name,
    "single",
  );
  assert.equal(f.calls.length, 1);
});

test("multi-view uncertainty survives restart and recovery stays pinned without another create", async (t) => {
  const f = await fixture(t);
  f.loseResponse();
  await assert.rejects(
    f.jobs.submitImages("views", {}, f.sources),
    /uncertain/,
  );
  // An endpoint assertion must not be mistaken for the simulated lost response.
  assert.equal(f.calls[0].path, "/lux3d/v1/generate/img-to-3d/task/create");
  assert.equal((f.calls[0].body.imgs as string[]).length, 2);
  const restart = f.restart();
  assert.equal(
    (await restart.submitImages("alias", {}, f.sources)).job.phase,
    "uncertain",
  );
  await restart.attach("views", 77);
  await restart.refresh("views");
  for (const status of [4, 6]) {
    f.setStatus(status);
    await restart.refresh("views");
    assert.equal(
      (await restart.submitImages("alias", {}, f.sources)).reused,
      true,
    );
  }
  assert.equal(f.calls.length, 1);
  assert.ok(
    f.connections.every(
      (connection) => connection === f.sources[0].connectionId,
    ),
  );
  assert.equal((await f.store.require("views")).inputs?.length, 2);
});

test("view order and every view digest affect deduplication; invalid sets never create or journal", async (t) => {
  const f = await fixture(t);
  for (const sources of [
    [],
    Array.from({ length: 33 }, () => f.sources[0]),
    [f.sources[0], { ...f.sources[1], connectionId: "other" }],
  ])
    await assert.rejects(f.jobs.submitImages("bad", {}, sources));
  await assert.rejects(
    f.jobs.submitImages("bad", { prompt: "not an image option" }, f.sources),
  );
  const unsupported = new Jobs(f.store, () => ({
    ...f.api,
    imgTo3d: { createFromFile: async () => 99 },
  }));
  await assert.rejects(
    unsupported.submitImages("bad", {}, f.sources),
    /multi-view/,
  );
  assert.equal((await f.store.all()).length, 0);
  assert.equal(f.calls.length, 0);
  const first = await f.jobs.submitImages("views", {}, f.sources);
  await assert.rejects(
    f.jobs.submitImages("views", {}, [...f.sources].reverse()),
    /another generation/,
  );
  const reversed = await f.jobs.submitImages(
    "reversed",
    {},
    [...f.sources].reverse(),
  );
  const subset = await f.jobs.submitImages("subset", {}, [f.sources[0]]);
  assert.notEqual(first.job.fingerprint, reversed.job.fingerprint);
  assert.notEqual(first.job.fingerprint, subset.job.fingerprint);
  assert.equal(f.calls.length, 3);
  await f.jobs.submitImages(
    "maximum",
    {},
    Array.from({ length: 32 }, (_, index) => f.sources[index % 2]),
  );
  assert.equal((f.calls[3].body.imgs as string[]).length, 32);
  assert.equal(f.calls.length, 4);
});

test("CLI accepts multiple image paths, reuses the ordered set and downloads offline in an isolated root", async (t) => {
  const f = await fixture(t);
  const cli = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["--import", "tsx", "scripts/lux3d.ts", ...args],
      {
        env: {
          ...process.env,
          DASH_DATA_ROOT: f.root,
          DASH_DISABLE_PAID: "1",
          AHOLO_API_KEY: "",
        },
      },
    );
    return JSON.parse(stdout);
  };
  const submit = (name: string) =>
    cli(
      "submit-image",
      "--name",
      name,
      "--image",
      ...f.sources.map((s) => s.path),
      "--provider",
      "fixture",
    );
  assert.equal((await submit("cli-views")).reused, false);
  assert.equal((await submit("cli-alias")).name, "cli-views");
  assert.equal((await f.store.require("cli-views")).inputs?.length, 2);
  assert.equal((await cli("status", "cli-views")).phase, "succeeded");
  const result = await cli("download", "cli-views");
  assert.equal(result.assets[0].format, "glb");
  const glb = await readFile(join(f.root, result.assets[0].path));
  assert.equal(glb.toString("ascii", 0, 4), "glTF");
  assert.equal((await f.store.all()).length, 1);
});
