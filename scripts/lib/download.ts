import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Jobs } from "./jobs.js";
import { jsonWrite, type Asset } from "./store.js";
import { safeError } from "./config.js";

async function checksum(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function validExisting(root: string, asset: Asset): Promise<boolean> {
  try {
    return (
      (await stat(join(root, asset.path))).size === asset.bytes &&
      (await checksum(join(root, asset.path))) === asset.sha256
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}
export async function formatOf(
  path: string,
  bytes: number,
): Promise<Asset["format"]> {
  const file = await open(path, "r");
  const header = Buffer.alloc(12);
  try {
    await file.read(header, 0, 12, 0);
  } finally {
    await file.close();
  }
  if (header.toString("ascii", 0, 4) === "glTF") {
    if (
      header.readUInt32LE(4) !== 2 ||
      header.readUInt32LE(8) !== bytes ||
      bytes < 20
    )
      throw new Error("Invalid/truncated GLB.");
    const buffer = await readFile(path);
    const jsonLength = buffer.readUInt32LE(12);
    if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonLength > bytes)
      throw new Error("Invalid GLB JSON chunk.");
    const gltf = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength));
    if (gltf.asset?.version !== "2.0") throw new Error("Expected glTF 2.0.");
    for (const item of [...(gltf.buffers ?? []), ...(gltf.images ?? [])]) {
      if (item.uri && !item.uri.startsWith("data:"))
        throw new Error(
          "GLB references external resources; use a self-contained export.",
        );
    }
    return "glb";
  }
  if (header[0] === 0x50 && header[1] === 0x4b) return "zip";
  if (header.toString("ascii", 0, 3) === "ply") return "ply";
  throw new Error(
    "Output is not GLB, ZIP or PLY; inspect the saved task result.",
  );
}
export async function download(
  jobs: Jobs,
  name: string,
  fetcher: typeof fetch = fetch,
  refresh = true,
) {
  // Refresh expiring URLs without making a new generation request.
  if (refresh) await jobs.refresh(name);
  return jobs.store.locked(async () => {
    const job = await jobs.store.require(name);
    if (job.phase !== "succeeded")
      throw new Error(`Task is ${job.phase}; download requires success.`);
    const destination = join(jobs.store.root, "public", "generated", name);
    await mkdir(destination, { recursive: true });
    try {
      let count = 0;
      for (const [index, output] of job.result!.outputs.entries()) {
        if (!output.content || output.content === "NOT_REQUESTED") continue;
        const url = new URL(output.content);
        if (!["https:", "http:"].includes(url.protocol))
          throw new Error("Unsupported output URL protocol.");
        count++;
        const existing = job.assets.find((asset) => asset.index === index);
        if (existing && (await validExisting(jobs.store.root, existing)))
          continue;
        const partial = join(destination, `${index}.part`);
        try {
          const response = await fetcher(url, {
            signal: AbortSignal.timeout(120_000),
          });
          if (!response.ok || !response.body)
            throw new Error(
              `Download HTTP ${response.status}; rerun download to refresh URLs.`,
            );
          const hash = createHash("sha256");
          let bytes = 0;
          const meter = new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length;
              if (bytes > 200 * 1024 * 1024)
                return callback(
                  new Error("Asset exceeds the 200 MiB local download limit."),
                );
              hash.update(chunk);
              callback(null, chunk);
            },
          });
          await pipeline(
            Readable.fromWeb(
              response.body as Parameters<typeof Readable.fromWeb>[0],
            ),
            meter,
            createWriteStream(partial),
          );
          const format = await formatOf(partial, bytes);
          const path = `public/generated/${name}/${index}.${format}`;
          const handle = await open(partial, "r+");
          try {
            await handle.sync();
          } finally {
            await handle.close();
          }
          await rename(partial, join(jobs.store.root, path));
          const asset: Asset = {
            index,
            path,
            format,
            bytes,
            sha256: hash.digest("hex"),
          };
          job.assets = [...job.assets.filter((a) => a.index !== index), asset];
          await jobs.store.save(job, `downloaded output ${index}: ${format}`);
        } finally {
          await rm(partial, { force: true });
        }
      }
      if (!count)
        throw new Error(
          "Successful task returned no downloadable outputs. Query again; do not regenerate.",
        );
      // Rebuild from journals so interrupted publication can be repaired by rerunning download.
      const models = [];
      for (const item of await jobs.store.all()) {
        for (const asset of item.assets) {
          if (
            asset.format === "glb" &&
            (await validExisting(jobs.store.root, asset))
          ) {
            models.push({
              name: item.name,
              providerId: item.providerId ?? "lux3d",
              url: "/" + asset.path.replace(/^public\//, ""),
              bytes: asset.bytes,
              sha256: asset.sha256,
            });
          }
        }
      }
      await jsonWrite(join(jobs.store.root, "public/generated/manifest.json"), {
        schemaVersion: 1,
        models,
      });
      delete job.lastError;
      await jobs.store.save(
        job,
        "downloads verified; viewer manifest published",
      );
      return job;
    } catch (error) {
      job.lastError = safeError(error);
      await jobs.store.save(job, "download failed; completed assets retained");
      throw error;
    }
  });
}
