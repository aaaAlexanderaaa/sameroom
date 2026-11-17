import { createHash } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import atomic from "write-file-atomic";
import { jsonWrite } from "../scripts/lib/store.js";

export interface IconAsset {
  id: string;
  name: string;
  url: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  createdAt: string;
}

const MAX_ICON_BYTES = 4 * 1024 * 1024;
const ALLOWED_FORMATS = new Set(["png", "jpeg", "webp", "gif", "svg"]);

function sanitizeName(raw?: string): string {
  const cleaned = (raw ?? "")
    .replace(/\.[a-z0-9]{1,8}$/i, "")
    .replace(/[^\p{L}\p{N}_. -]/gu, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "Custom icon";
}

export async function importIconAsset(
  root: string,
  bytes: Buffer,
  rawName?: string,
): Promise<IconAsset> {
  if (!bytes.length || bytes.length > MAX_ICON_BYTES) {
    throw new Error("Icon image must be between 1 byte and 4 MiB.");
  }
  const probe = sharp(bytes, { limitInputPixels: 16_000_000, density: 288 });
  const meta = await probe.metadata().catch(() => undefined);
  if (!meta?.format || !ALLOWED_FORMATS.has(meta.format)) {
    throw new Error("Unsupported icon format; use PNG, JPEG, WebP, GIF or SVG.");
  }
  const normalized = await sharp(bytes, {
    limitInputPixels: 16_000_000,
    density: 288,
  })
    .rotate()
    .resize(256, 256, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  const sha256 = createHash("sha256").update(normalized.data).digest("hex");
  const directory = join(root, "data/icon-library");
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const metaPath = join(directory, `${sha256}.json`);
  const pngPath = join(directory, `${sha256}.png`);

  // Preserve existing metadata entry if identical normalized bytes were already stored.
  const existing = await readFile(metaPath, "utf8")
    .then((raw) => JSON.parse(raw) as IconAsset)
    .catch(() => undefined);
  if (existing && existing.sha256 === sha256) {
    return existing;
  }

  const asset: IconAsset = {
    id: sha256,
    name: sanitizeName(rawName),
    url: `/api/icons/${sha256}`,
    bytes: normalized.data.length,
    width: normalized.info.width,
    height: normalized.info.height,
    sha256,
    createdAt: new Date().toISOString(),
  };

  await atomic(pngPath, normalized.data, { mode: 0o600 });
  await jsonWrite(metaPath, asset);
  return asset;
}

export async function listIconAssets(root: string): Promise<IconAsset[]> {
  const directory = join(root, "data/icon-library");
  const names = await readdir(directory).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const items = await Promise.all(
    names
      .filter((n) => /^[a-f0-9]{64}\.json$/.test(n))
      .map(
        async (n) =>
          JSON.parse(await readFile(join(directory, n), "utf8")) as IconAsset,
      ),
  );
  return items.sort(
    (a, b) =>
      b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id),
  );
}

export async function readIconAsset(
  root: string,
  id: string,
): Promise<Buffer> {
  if (!/^[a-f0-9]{64}$/.test(id)) {
    throw new Error("Invalid icon ID.");
  }
  return readFile(join(root, "data/icon-library", `${id}.png`));
}
