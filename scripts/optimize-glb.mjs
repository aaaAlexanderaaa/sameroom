#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Compress generated GLB assets with Meshopt geometry compression + simplification
 * and WebP texture resizing/compression while preserving calibration node transforms.
 *
 * Usage:
 *   node scripts/optimize-glb.mjs [--dry-run] [--force] [--target-tris 30000] [--max-tex 512] [--quality 82] [path...]
 */

const root = resolve(new URL("../", import.meta.url).pathname);
const generatedDir = join(root, "public/generated");

// Per-model budgets tailored to physical scale and inspection priority.
const MODEL_PRESETS = {
  "living-20261116/ergonor-jinhao-b.glb": { targetTris: 45000, maxTex: 1024 },
  "living-20261116/dds-bench.glb": { targetTris: 40000, maxTex: 1024 },
  "living-20261116/vgn-v98-pro-v2.glb": { targetTris: 40000, maxTex: 1024 },
  "living-20261116/roborock-g10s-pro.glb": { targetTris: 35000, maxTex: 1024 },
  "living-20261116/midea-fan.glb": { targetTris: 35000, maxTex: 1024 },
  "living-20261116/xiaomi-purifier.glb": { targetTris: 30000, maxTex: 1024 },
  "living-20261116/edifier-huazai.glb": { targetTris: 30000, maxTex: 512 },
  "living-20261116/bear-kettle.glb": { targetTris: 30000, maxTex: 512 },
  "living-20261116/xiaomi-ax3000t.glb": { targetTris: 25000, maxTex: 512 },
  "living-20261116/xiaomi-lightbar-1s.glb": { targetTris: 25000, maxTex: 512 },
  "living-20261116/apple-magic-mouse.glb": { targetTris: 20000, maxTex: 512 },
  "computers-20261115/g700-on.glb": { targetTris: 0, maxTex: 1024 },
  "computers-20261115/g700-off.glb": { targetTris: 0, maxTex: 1024 },
  "computers-20261115/mac-mini-m4.glb": { targetTris: 25000, maxTex: 512 },
  "computers-20261115/mac-mini-m1.glb": { targetTris: 0, maxTex: 512 },
  "corrugated-cat-bed-text-20261115/calibrated.glb": {
    targetTris: 30000,
    maxTex: 512,
  },
  "corrugated-cat-bed-text-20261115/0.glb": { targetTris: 30000, maxTex: 512 },
  "mac-mini-m4-multiview-20261115/0.glb": { targetTris: 25000, maxTex: 512 },
  "mac-mini-m1-multiview-20261115/0.glb": { targetTris: 0, maxTex: 512 },
  "rog-g700-multiview-20261115/0.glb": { targetTris: 0, maxTex: 1024 },
};

function parseArgs(argv) {
  let dryRun = false;
  let force = false;
  let defaultTris = 30000;
  let defaultTex = 512;
  let quality = 82;
  const targets = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--force") force = true;
    else if (arg === "--target-tris") defaultTris = Number(argv[++i]);
    else if (arg === "--max-tex") defaultTex = Number(argv[++i]);
    else if (arg === "--quality") quality = Number(argv[++i]);
    else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/optimize-glb.mjs [--dry-run] [--force] [--target-tris 30000] [--max-tex 512] [--quality 82] [file-or-dir...]",
      );
      process.exit(0);
    } else {
      targets.push(resolve(arg));
    }
  }
  return {
    dryRun,
    force,
    defaultTris,
    defaultTex,
    quality,
    targets: targets.length ? targets : [generatedDir],
  };
}

function loadTooling() {
  const projectRequire = createRequire(join(root, "package.json"));
  const sharp = projectRequire("sharp");
  const candidateDirs = [root, "/tmp/gltf-tools"];
  for (const dir of candidateDirs) {
    if (!existsSync(join(dir, "node_modules/@gltf-transform/core"))) continue;
    const req = createRequire(join(dir, "package.json"));
    return {
      sharp,
      ...req("@gltf-transform/core"),
      ...req("@gltf-transform/extensions"),
      ...req("@gltf-transform/functions"),
      ...req("meshoptimizer"),
    };
  }
  console.error(
    "Missing @gltf-transform/* or meshoptimizer. Install once into /tmp/gltf-tools:\n" +
      "  npm install --prefix /tmp/gltf-tools --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer",
  );
  process.exit(1);
}

async function collectGlbFiles(paths) {
  const out = [];
  for (const entry of paths) {
    if (entry.endsWith(".glb")) {
      out.push(entry);
      continue;
    }
    const items = await readdir(entry, { withFileTypes: true });
    for (const item of items) {
      const full = join(entry, item.name);
      if (item.isDirectory()) out.push(...(await collectGlbFiles([full])));
      else if (item.name.endsWith(".glb")) out.push(full);
    }
  }
  return [...new Set(out)].sort();
}

function countTriangles(doc) {
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      if (idx) tris += idx.getCount() / 3;
      else {
        const pos = prim.getAttribute("POSITION");
        if (pos) tris += pos.getCount() / 3;
      }
    }
  }
  return Math.round(tris);
}

const opts = parseArgs(process.argv.slice(2));
const {
  NodeIO,
  ALL_EXTENSIONS,
  dedup,
  getBounds,
  meshopt,
  prune,
  simplify,
  textureCompress,
  weld,
  MeshoptDecoder,
  MeshoptEncoder,
  MeshoptSimplifier,
  sharp,
} = loadTooling();

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "meshopt.decoder": MeshoptDecoder,
    "meshopt.encoder": MeshoptEncoder,
  });

const files = await collectGlbFiles(opts.targets);
if (!files.length) {
  console.log("No .glb files found.");
  process.exit(0);
}

let totalBefore = 0;
let totalAfter = 0;
const manifestUpdates = new Map();

for (const file of files) {
  const rel = relative(generatedDir, file);
  const preset = MODEL_PRESETS[rel] ?? {
    targetTris: opts.defaultTris,
    maxTex: opts.defaultTex,
  };
  const srcBuf = await readFile(file);
  totalBefore += srcBuf.length;

  const doc = await io.readBinary(srcBuf);
  const usedExts = new Set(
    doc.getRoot().listExtensionsUsed().map((e) => e.extensionName),
  );
  if (
    !opts.force &&
    usedExts.has("EXT_meshopt_compression") &&
    usedExts.has("EXT_texture_webp")
  ) {
    totalAfter += srcBuf.length;
    console.log(
      `${relative(root, file)}: already compressed (Meshopt + WebP), skipped`,
    );
    continue;
  }
  const beforeTris = countTriangles(doc);
  const beforeBounds = getBounds(doc.getRoot().getDefaultScene());

  const transforms = [dedup(), weld()];
  if (preset.targetTris > 0 && beforeTris > preset.targetTris) {
    transforms.push(
      simplify({
        simplifier: MeshoptSimplifier,
        ratio: preset.targetTris / beforeTris,
        error: 0.01,
        lockBorder: false,
      }),
    );
  }
  transforms.push(
    textureCompress({
      encoder: sharp,
      targetFormat: "webp",
      resize: [preset.maxTex, preset.maxTex],
      quality: opts.quality,
      effort: 6,
    }),
    prune(),
    meshopt({ encoder: MeshoptEncoder, level: "medium" }),
  );

  await doc.transform(...transforms);
  const outBuf = await io.writeBinary(doc);

  const verified = await io.readBinary(outBuf);
  const afterTris = countTriangles(verified);
  const afterBounds = getBounds(verified.getRoot().getDefaultScene());
  const beforeSize = [0, 1, 2].map(
    (i) => beforeBounds.max[i] - beforeBounds.min[i],
  );
  const afterSize = [0, 1, 2].map(
    (i) => afterBounds.max[i] - afterBounds.min[i],
  );
  const maxDrift = Math.max(
    ...beforeSize.map(
      (s, i) => Math.abs(s - afterSize[i]) / Math.max(s, 1e-6),
    ),
  );
  if (maxDrift > 0.02) {
    throw new Error(
      `Bounds drift exceeded 2% for ${file}: ${(maxDrift * 100).toFixed(2)}%`,
    );
  }

  totalAfter += outBuf.length;
  if (!opts.dryRun) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, outBuf);
    if (!rel.startsWith("..")) {
      manifestUpdates.set(`/generated/${rel.replaceAll("\\", "/")}`, {
        bytes: outBuf.length,
        sha256: createHash("sha256").update(outBuf).digest("hex"),
      });
    }
  }

  console.log(
    `${relative(root, file)}: ${(srcBuf.length / 1048576).toFixed(2)} MB -> ${(outBuf.length / 1048576).toFixed(2)} MB | tris ${beforeTris} -> ${afterTris} | drift ${(maxDrift * 100).toFixed(3)}%`,
  );
}

const manifestPath = join(generatedDir, "manifest.json");
if (!opts.dryRun && manifestUpdates.size && existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  let changed = false;
  for (const model of manifest.models ?? []) {
    const update = manifestUpdates.get(model.url);
    if (update) {
      model.bytes = update.bytes;
      model.sha256 = update.sha256;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
}

console.log(
  `Done${opts.dryRun ? " (dry-run)" : ""}: ${(totalBefore / 1048576).toFixed(2)} MB -> ${(totalAfter / 1048576).toFixed(2)} MB (-${((1 - totalAfter / Math.max(totalBefore, 1)) * 100).toFixed(1)}%)`,
);
