import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import atomic from "write-file-atomic";
import { formatOf } from "../scripts/lib/download.js";
import { jsonWrite } from "../scripts/lib/store.js";
import {
  modelSourceSchema,
  type ImportedModel,
} from "../shared/model-source.js";

export async function importModel(
  root: string,
  bytes: Buffer,
  name: string,
  sourceInput?: unknown,
): Promise<ImportedModel> {
  const parsed =
    sourceInput === undefined
      ? undefined
      : modelSourceSchema.parse(sourceInput);
  const source = parsed && Object.keys(parsed).length ? parsed : undefined;
  if (
    bytes.length < 20 ||
    bytes.length > 64 * 1024 * 1024 ||
    bytes.toString("ascii", 0, 4) !== "glTF"
  )
    throw new Error("Use a self-contained GLB, at most 64 MiB.");
  const digest = createHash("sha256").update(bytes).digest("hex"),
    directory = join(root, "data/model-imports");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, digest + "-" + randomUUID() + ".glb");
  await atomic(temporary, bytes, { mode: 0o600 });
  try {
    if ((await formatOf(temporary, bytes.length)) !== "glb")
      throw new Error("Expected GLB.");
    const sourceDigest = source
      ? "-" +
        createHash("sha256")
          .update(JSON.stringify(source))
          .digest("hex")
          .slice(0, 16)
      : "";
    const id = "import-" + digest + sourceDigest,
      url = `/generated/import-${digest}/model.glb`;
    await mkdir(join(root, "public/generated", "import-" + digest), {
      recursive: true,
    });
    await atomic(join(root, "public", url), bytes, { mode: 0o644 });
    const model = {
      id,
      name:
        name.replace(/[^\p{L}\p{N}_. -]/gu, "").slice(0, 120) ||
        "Imported model",
      url,
      bytes: bytes.length,
      sha256: digest,
      ...(source ? { source } : {}),
    };
    await jsonWrite(join(directory, digest + sourceDigest + ".json"), model);
    return model;
  } finally {
    await rm(temporary, { force: true });
  }
}
export async function importedModels(root: string): Promise<ImportedModel[]> {
  const dir = join(root, "data/model-imports");
  const names = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  return Promise.all(
    names
      .filter((n) => /^[a-f0-9]{64}(?:-[a-f0-9]{16})?\.json$/.test(n))
      .map(
        async (n) =>
          JSON.parse(await readFile(join(dir, n), "utf8")) as ImportedModel,
      ),
  );
}
