import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { preparePublic } from "../scripts/prepare-public.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "sameroom-release-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  const put = async (path: string, content: string | Buffer) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  };
  const commit = () => {
    git("add", ".");
    git("commit", "-m", "Fixture snapshot");
  };
  git("init", "-b", "public-clean");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release@example.com");
  await put("README.md", "Old public snapshot\n");
  await put("docs/internal-plan.md", "Old internal note\n");
  commit();
  const publicRoot = git("rev-parse", "HEAD");
  git("switch", "--orphan", "main");
  const asset = Buffer.from("reviewed-public-model");
  const importPath = "data/model-imports/" + "a".repeat(64) + ".json";
  const files = [
    "README.md",
    "scripts/public-files.json",
    "data/dashboard/initial-home.json",
    "public/generated/manifest.json",
    "public/generated/demo/0.glb",
    importPath,
  ];
  const seed = JSON.stringify({ model: "/generated/demo/0.glb" });
  const config = {
    publicRoot,
    demoSeedSha256: createHash("sha256").update(seed).digest("hex"),
    files,
  };
  await put("README.md", "Public source\n");
  await put("scripts/public-files.json", JSON.stringify(config));
  await put("data/dashboard/initial-home.json", seed);
  await put("public/generated/demo/0.glb", asset);
  await put(
    "public/generated/manifest.json",
    JSON.stringify({
      schemaVersion: 1,
      models: [
        {
          name: "demo",
          url: "/generated/demo/0.glb",
          bytes: 0,
          sha256: "stale",
        },
        { name: "unpublished", url: "/generated/unpublished/0.glb" },
      ],
    }),
  );
  await put(
    importPath,
    JSON.stringify({
      id: "demo",
      url: "/generated/demo/0.glb",
      bytes: 0,
      sha256: "stale",
    }),
  );
  await put(".env.local", "AHOLO_API_KEY=fixture-private-key-123456789\n");
  await put("data/dashboard/state.json", "private runtime state\n");
  await put("docs/new-plan.md", "private working note\n");
  commit();
  return { root, git, put, commit, config, publicRoot, asset, importPath };
}

test("public snapshots are repeatable, remove omitted files, repair metadata and keep private history out", async (t) => {
  const f = await fixture(t);
  const source = f.git("rev-parse", "HEAD");
  const index = await readFile(join(f.root, ".git/index"));
  const first = preparePublic(f.root);
  assert.equal(first.unchanged, false);
  assert.equal(f.git("rev-parse", "public-clean^"), f.publicRoot);
  assert.equal(f.git("rev-parse", "HEAD"), source);
  assert.deepEqual(await readFile(join(f.root, ".git/index")), index);
  assert.deepEqual(
    f.git("ls-tree", "-r", "--name-only", "public-clean").split("\n").sort(),
    [...f.config.files].sort(),
  );
  assert.throws(() =>
    f.git("merge-base", "--is-ancestor", source, "public-clean"),
  );
  assert.equal(
    f.git("rev-list", "--max-parents=0", "public-clean"),
    f.publicRoot,
  );
  const manifest = JSON.parse(
    f.git("show", "public-clean:public/generated/manifest.json"),
  );
  const expected = {
    bytes: f.asset.length,
    sha256: createHash("sha256").update(f.asset).digest("hex"),
  };
  assert.deepEqual(manifest.models, [
    { name: "demo", url: "/generated/demo/0.glb", ...expected },
  ]);
  assert.deepEqual(JSON.parse(f.git("show", "public-clean:" + f.importPath)), {
    id: "demo",
    url: "/generated/demo/0.glb",
    ...expected,
  });
  assert.deepEqual(preparePublic(f.root), { ...first, unchanged: true });
  await f.put("README.md", "Updated public source\n");
  f.commit();
  const next = preparePublic(f.root);
  assert.notEqual(next.commit, first.commit);
  assert.equal(f.git("rev-parse", "public-clean^"), first.commit);
  assert.equal(
    await readFile(join(f.root, "data/dashboard/state.json"), "utf8"),
    "private runtime state\n",
  );
});

test("invalid exports fail without moving the public branch", async (t) => {
  const cases: {
    name: string;
    change: (f: Awaited<ReturnType<typeof fixture>>) => Promise<void>;
    error: RegExp;
  }[] = [
    {
      name: "uncommitted source",
      change: async (f) => {
        await f.put("README.md", "Uncommitted\n");
      },
      error: /Commit or set aside/,
    },
    {
      name: "private file in allowlist",
      change: async (f) => {
        f.config.files.push(".env.local");
        await f.put("scripts/public-files.json", JSON.stringify(f.config));
        f.commit();
      },
      error: /Unapproved/,
    },
    {
      name: "symlink in allowlist",
      change: async (f) => {
        await symlink("../.env.local", join(f.root, "scripts/leak.ts"));
        f.config.files.push("scripts/leak.ts");
        await f.put("scripts/public-files.json", JSON.stringify(f.config));
        f.commit();
      },
      error: /non-regular/,
    },
    {
      name: "credential copied into source",
      change: async (f) => {
        await f.put("README.md", "fixture-private-key-123456789\n");
        f.commit();
      },
      error: /Private content detected.*value hidden/,
    },
    {
      name: "private repository host copied into source",
      change: async (f) => {
        f.git("remote", "add", "origin", "https://private.example/source.git");
        await f.put("README.md", "https://private.example/source.git\n");
        f.commit();
      },
      error: /Private content detected.*value hidden/,
    },
    {
      name: "unpublished resource",
      change: async (f) => {
        await f.put(
          "data/dashboard/initial-home.json",
          JSON.stringify({ model: "/generated/missing.glb" }),
        );
        f.commit();
      },
      error: /Unpublished local resource/,
    },
    {
      name: "private network in seed",
      change: async (f) => {
        await f.put(
          "data/dashboard/initial-home.json",
          JSON.stringify({ url: "http://192.168.1.10" }),
        );
        f.commit();
      },
      error: /Private network/,
    },
    {
      name: "unreviewed demo content without an address leak",
      change: async (f) => {
        await f.put(
          "data/dashboard/initial-home.json",
          JSON.stringify({
            model: "/generated/demo/0.glb",
            host: "private-server",
          }),
        );
        f.commit();
      },
      error: /Public demo seed changed/,
    },
    {
      name: "unreferenced custom icon",
      change: async (f) => {
        const path = "data/icon-library/" + "b".repeat(64) + ".json";
        await f.put(path, JSON.stringify({ name: "Private service icon" }));
        f.config.files.push(path);
        await f.put("scripts/public-files.json", JSON.stringify(f.config));
        f.commit();
      },
      error: /Unreferenced custom icon/,
    },
    {
      name: "private parent history",
      change: async (f) => {
        f.git(
          "update-ref",
          "refs/heads/public-clean",
          f.git("rev-parse", "HEAD"),
        );
      },
      error: /approved public root/,
    },
    {
      name: "unpublished document link",
      change: async (f) => {
        await f.put("README.md", "[Internal note](docs/new-plan.md)\n");
        f.commit();
      },
      error: /Unpublished document link/,
    },
  ];
  for (const item of cases) {
    await t.test(item.name, async (child) => {
      const f = await fixture(child);
      await item.change(f);
      const before = f.git("rev-parse", "public-clean");
      assert.throws(() => preparePublic(f.root), item.error);
      assert.equal(f.git("rev-parse", "public-clean"), before);
    });
  }
});
