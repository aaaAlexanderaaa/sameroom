import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseEnv } from "dotenv";

interface PublicFiles {
  publicRoot: string;
  demoSeedSha256: string;
  files: string[];
}
interface PublicFile {
  mode: string;
  content: Buffer;
}

const publicBranch = "refs/heads/public-clean";
const publicDocs = new Set([
  "docs/agent-api.md",
  "docs/lux3d.md",
  "docs/world-views.md",
]);
const rootFiles = new Set([
  ".dockerignore",
  ".env.example",
  ".gitignore",
  ".nvmrc",
  "Dockerfile",
  "LICENSE",
  "README.md",
  "compose.yaml",
  "index.html",
  "inspector.html",
  "package.json",
  "package-lock.json",
  "playwright.config.ts",
  "tsconfig.json",
  "vite.config.ts",
]);

function allowedPath(path: string) {
  if (
    posix.normalize(path) !== path ||
    path.startsWith("/") ||
    path.startsWith("..") ||
    path.includes("\\")
  )
    return false;
  if (
    path.split("/").some((part) => part.startsWith(".")) &&
    !rootFiles.has(path)
  )
    return false;
  if (/\.raw\.glb$|\/[^/]*-raw\//.test(path)) return false;
  return (
    rootFiles.has(path) ||
    publicDocs.has(path) ||
    /^(?:src|server|shared|scripts|tests|admin|examples|requests)\/[\w./-]+\.(?:ts|tsx|mjs|css|json|html)$/.test(
      path,
    ) ||
    path === "data/dashboard/initial-home.json" ||
    /^data\/(?:icon-library|model-imports)\/[a-f0-9]{64}\.(?:json|png)$/.test(
      path,
    ) ||
    /^public\/(?:generated|models|icons)\/[\w./-]+\.(?:json|glb|svg)$/.test(
      path,
    ) ||
    path === "public/sameroom-logo.svg"
  );
}

function optionalRead(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function knownSecrets(root: string) {
  const secrets = new Set<string>();
  for (const [name, value] of [
    ...Object.entries(parseEnv(optionalRead(join(root, ".env.local")))),
    ...Object.entries(process.env),
  ]) {
    if (
      /(?:KEY|TOKEN|PASSWORD|SECRET)$/.test(name) &&
      value &&
      value.length >= 8 &&
      !/your_|replace_with/i.test(value)
    )
      secrets.add(value);
  }
  for (const name of ["admin-token", "agent-token"]) {
    const value = optionalRead(join(root, "data/private", name)).trim();
    if (value) secrets.add(value);
  }
  const providers = optionalRead(join(root, "data/private/providers.json"));
  if (providers) {
    for (const connection of JSON.parse(providers).connections ?? []) {
      if (connection.key) secrets.add(connection.key);
    }
  }
  try {
    const remote = execFileSync(
      "git",
      ["config", "--get", "remote.origin.url"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ).trim();
    const host = remote.includes("://")
      ? new URL(remote).hostname
      : remote.match(/^[^@]+@([^:]+):/)?.[1];
    if (host && host !== "github.com") secrets.add(host);
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error;
  }
  return [...secrets].map((secret) => Buffer.from(secret));
}

function jsonBuffer(value: unknown) {
  return Buffer.from(JSON.stringify(value, null, 2) + "\n");
}

function verifyReferences(
  value: unknown,
  files: Map<string, PublicFile>,
  path: string,
) {
  if (Array.isArray(value)) {
    value.forEach((item) => verifyReferences(item, files, path));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => verifyReferences(item, files, path));
  } else if (typeof value === "string") {
    let resource: string | undefined;
    if (/^\/(?:generated|models)\//.test(value)) resource = "public" + value;
    if (value.startsWith("/api/icons/"))
      resource = "data/icon-library/" + value.slice(11) + ".png";
    if (
      value.startsWith("/api/uploads/") ||
      (resource && !files.has(resource))
    ) {
      throw new Error(
        `Unpublished local resource in ${path}; review the public file list.`,
      );
    }
    if (path.startsWith("data/") || path.startsWith("examples/")) {
      if (
        /(?:\b10\.(?:\d+\.){2}\d+|\b192\.168\.\d+\.\d+|\b172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|\b100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|\.ts\.net\b|https?:\/\/[^/\s]+\.local\b)/i.test(
          value,
        )
      ) {
        throw new Error(
          `Private network reference in ${path}; use synthetic sample data.`,
        );
      }
    }
  }
}

export function preparePublic(root: string) {
  const git = (args: string[], input?: Buffer | string, extraEnv = {}) =>
    execFileSync("git", args, {
      cwd: root,
      input,
      env: { ...process.env, ...extraEnv },
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 128 * 1024 * 1024,
    });
  const gitText = (args: string[]) => git(args).toString("utf8").trim();
  if (gitText(["status", "--porcelain", "--untracked-files=normal"])) {
    throw new Error(
      "Commit or set aside source changes before preparing public-clean.",
    );
  }
  if (
    gitText(["worktree", "list", "--porcelain"])
      .split("\n")
      .includes(`branch ${publicBranch}`)
  ) {
    throw new Error(
      "Switch away from public-clean in every checkout before preparing it.",
    );
  }
  const source = gitText(["rev-parse", "HEAD"]);
  const config = JSON.parse(
    gitText(["show", `${source}:scripts/public-files.json`]),
  ) as PublicFiles;
  if (
    !/^[a-f0-9]{40}$/.test(config.publicRoot) ||
    !/^[a-f0-9]{64}$/.test(config.demoSeedSha256) ||
    !Array.isArray(config.files) ||
    !config.files.length ||
    new Set(config.files).size !== config.files.length
  ) {
    throw new Error(
      "Invalid scripts/public-files.json; review the public file list.",
    );
  }
  let previous = "";
  try {
    previous = gitText(["rev-parse", "--verify", publicBranch]);
  } catch {
    /* A public clone can start from HEAD. */
  }
  const parent = previous || source;
  if (
    gitText(["rev-list", "--max-parents=0", parent]) !== config.publicRoot ||
    gitText(["rev-list", "--min-parents=2", parent])
  ) {
    throw new Error(
      "Public history must be linear and start at the approved public root. Fetch GitHub main into public-clean; never merge private main.",
    );
  }

  const tree = new Map(
    git(["ls-tree", "-r", "-z", source])
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [entry, path] = line.split("\t");
        const [mode, type, oid] = entry.split(" ");
        return [path, { mode, type, oid }] as const;
      }),
  );
  const files = new Map<string, PublicFile>();
  for (const path of [...config.files].sort()) {
    const entry = tree.get(path);
    if (
      !allowedPath(path) ||
      !entry ||
      entry.type !== "blob" ||
      !["100644", "100755"].includes(entry.mode)
    ) {
      throw new Error(
        `Unapproved, missing or non-regular public file: ${path}`,
      );
    }
    files.set(path, {
      mode: entry.mode,
      content: git(["cat-file", "blob", entry.oid]),
    });
  }
  const jsonFiles = new Map<string, unknown>();
  for (const [path, file] of files) {
    if (path.endsWith(".json"))
      jsonFiles.set(path, JSON.parse(file.content.toString("utf8")));
  }
  const metadata = (url: string) => {
    const asset = files.get("public" + url);
    if (!url.startsWith("/generated/") || !asset)
      throw new Error(
        "Model metadata refers to an unpublished GLB; review the public file list.",
      );
    return {
      bytes: asset.content.length,
      sha256: createHash("sha256").update(asset.content).digest("hex"),
    };
  };
  const manifestPath = "public/generated/manifest.json";
  if (files.has(manifestPath)) {
    const manifest = jsonFiles.get(manifestPath) as {
      schemaVersion: number;
      models: { url: string }[];
    };
    const models = manifest.models
      .filter((model) => files.has("public" + model.url))
      .map((model) => ({ ...model, ...metadata(model.url) }));
    const publicManifest = { schemaVersion: manifest.schemaVersion, models };
    files.get(manifestPath)!.content = jsonBuffer(publicManifest);
    jsonFiles.set(manifestPath, publicManifest);
  }
  for (const [path, value] of jsonFiles) {
    if (path.startsWith("data/model-imports/")) {
      const model = value as { url: string };
      const updated = { ...model, ...metadata(model.url) };
      files.get(path)!.content = jsonBuffer(updated);
      jsonFiles.set(path, updated);
    }
  }
  for (const [path, value] of jsonFiles) verifyReferences(value, files, path);
  const seed = files.get("data/dashboard/initial-home.json");
  if (
    !seed ||
    createHash("sha256").update(seed.content).digest("hex") !==
      config.demoSeedSha256
  ) {
    throw new Error(
      "Public demo seed changed. Review its complete content and update demoSeedSha256 before export.",
    );
  }
  const seedText = seed.content.toString("utf8");
  for (const path of files.keys()) {
    if (!path.startsWith("data/icon-library/")) continue;
    const id = posix.basename(path).split(".")[0];
    if (!seedText.includes(`"/api/icons/${id}"`)) {
      throw new Error(
        `Unreferenced custom icon in ${path}; remove it from the public file list.`,
      );
    }
  }
  const secrets = knownSecrets(root);
  for (const [path, file] of files) {
    const text = file.content.toString("utf8");
    if (
      secrets.some((secret) => file.content.includes(secret)) ||
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\/Users\/[\w.-]+\//.test(
        text,
      )
    ) {
      throw new Error(
        `Private content detected in ${path}; value hidden. Remove it before export.`,
      );
    }
    if (path.endsWith(".md")) {
      for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
        if (/^(?:[a-z]+:|#)/i.test(match[1])) continue;
        const target = posix.normalize(
          posix.join(posix.dirname(path), match[1].split("#")[0]),
        );
        if (!files.has(target))
          throw new Error(
            `Unpublished document link in ${path}; remove or update it.`,
          );
      }
    }
  }

  const temporary = mkdtempSync(join(tmpdir(), "sameroom-public-"));
  try {
    const env = { GIT_INDEX_FILE: join(temporary, "index") };
    git(["read-tree", "--empty"], undefined, env);
    const entries = [...files]
      .map(
        ([path, file]) =>
          `${file.mode} ${git(["hash-object", "-w", "--stdin"], file.content).toString("utf8").trim()}\t${path}\0`,
      )
      .join("");
    git(["update-index", "-z", "--index-info"], entries, env);
    const publicTree = git(["write-tree"], undefined, env)
      .toString("utf8")
      .trim();
    const unchanged = publicTree === gitText(["rev-parse", `${parent}^{tree}`]);
    const commit = unchanged
      ? parent
      : git(
          ["commit-tree", publicTree, "-p", parent],
          "Update 共在 · SameRoom public snapshot\n",
          {
            GIT_AUTHOR_NAME: "aaaAlexanderaaa",
            GIT_AUTHOR_EMAIL: "aaaAlexanderaaa@users.noreply.github.com",
            GIT_COMMITTER_NAME: "aaaAlexanderaaa",
            GIT_COMMITTER_EMAIL: "aaaAlexanderaaa@users.noreply.github.com",
          },
        )
          .toString("utf8")
          .trim();
    git(["update-ref", publicBranch, commit, previous || "0".repeat(40)]);
    return {
      branch: "public-clean",
      commit,
      tree: publicTree,
      files: files.size,
      unchanged,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      JSON.stringify(
        preparePublic(resolve(dirname(fileURLToPath(import.meta.url)), "..")),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof Error && !("stderr" in error)
        ? error.message
        : "Git export failed; inspect repository status and public-clean before retrying.",
    );
    process.exitCode = 1;
  }
}
