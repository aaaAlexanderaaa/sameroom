import { readFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { createLux3dClient } from "@manycore/aholo-sdk-lux3d";
import { Jobs, type Api } from "../scripts/lib/jobs.js";
import { Store, jsonWrite, type Job } from "../scripts/lib/store.js";
import { download } from "../scripts/lib/download.js";
import { registerSecret, root as projectRoot } from "../scripts/lib/config.js";

interface Connection {
  id: string;
  key: string;
  createdAt: string;
}
interface Settings {
  schemaVersion: 1;
  active?: string;
  connections: Connection[];
}
const settingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    active: z.string().uuid().optional(),
    connections: z.array(
      z.object({
        id: z.string().uuid(),
        key: z.string().min(1).max(1000),
        createdAt: z.string().datetime(),
      }),
    ),
  })
  .refine(
    (value) =>
      !value.active || value.connections.some((c) => c.id === value.active),
  );
export class Providers {
  private settings: Settings = { schemaVersion: 1, connections: [] };
  readonly jobs: Jobs;
  private busy = new Set<string>();
  private queriedAt = new Map<string, number>();
  constructor(readonly root: string) {
    this.jobs = new Jobs(
      new Store(root),
      (job) => this.api(job),
      () => this.activeConnection(),
    );
  }
  async init() {
    await mkdir(join(this.root, "data/private"), {
      recursive: true,
      mode: 0o700,
    });
    try {
      this.settings = settingsSchema.parse(
        JSON.parse(
          await readFile(
            join(this.root, "data/private/providers.json"),
            "utf8",
          ),
        ),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(
          "Private provider settings are unreadable. Restore the settings backup; contents are hidden.",
        );
    }
    for (const connection of this.settings.connections)
      registerSecret(connection.key);
  }
  describe() {
    return {
      defaultProvider: "lux3d",
      region: "cn",
      configured: Boolean(this.keyFor(this.activeConnection(), false)),
      connectionId: this.activeConnection(),
      capabilities: ["image-to-3d", "multi-view-image-to-3d"],
      maxImages: 32,
      fixtureAvailable: true,
    };
  }
  activeConnection() {
    return this.settings.active ?? "environment";
  }
  private keyFor(connection: string, required = true) {
    const key =
      connection === "environment"
        ? process.env.AHOLO_API_KEY
        : this.settings.connections.find((c) => c.id === connection)?.key;
    if ((!key || key === "your_api_key_here") && required)
      throw new Error(
        "Configure a Lux3D key in provider settings or .env.local.",
      );
    return key && key !== "your_api_key_here" ? key : undefined;
  }
  async configure(key: string) {
    if (!key.trim() || key.length > 1000 || /\s/.test(key))
      throw new Error("API key must be a non-empty token without spaces.");
    registerSecret(key);
    const release = await lockfile.lock(join(this.root, "data/private"), {
      retries: { retries: 20, minTimeout: 20, maxTimeout: 100 },
    });
    try {
      await this.init();
      const connection = {
        id: randomUUID(),
        key,
        createdAt: new Date().toISOString(),
      };
      const next = {
        ...this.settings,
        active: connection.id,
        connections: [...this.settings.connections, connection],
      };
      await jsonWrite(join(this.root, "data/private/providers.json"), next);
      this.settings = next;
      return this.describe();
    } finally {
      await release();
    }
  }

  private api(job?: Job): Api {
    if (job?.providerId === "fixture")
      return {
        textTo3d: {
          create: async () => {
            throw new Error("Fixture supports image workflow only.");
          },
        },
        imgTo3d: {
          createFromFile: async () => 1,
          createFromFiles: async () => 1,
        },
        tasks: {
          retrieve: async () => ({
            taskId: 1,
            status: 3,
            outputs: [{ content: "https://fixture.invalid/offline-robot.glb" }],
          }),
        },
      };
    if (process.env.DASH_DISABLE_PAID === "1")
      throw new Error("Live provider disabled in test server.");
    const key = this.keyFor(
      job ? (job.connectionId ?? "environment") : this.activeConnection(),
    )!;
    registerSecret(key);
    return createLux3dClient({ apiKey: key, region: "cn", timeoutMs: 60000 });
  }
  async upload(bytes: Buffer) {
    if (bytes.length > 12 * 1024 * 1024)
      throw new Error("Image must be at most 12 MiB.");
    const image = sharp(bytes, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp", "heif"].includes(metadata.format ?? ""))
      throw new Error(
        "Use JPEG, PNG or WebP; convert unsupported phone images first.",
      );
    const transparent = metadata.hasAlpha && !(await image.stats()).isOpaque;
    const resized = image.rotate().resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    });
    const extension = transparent ? "png" : "jpg";
    const normalized = await (
      transparent ? resized.png() : resized.jpeg({ quality: 88 })
    ).toBuffer();
    if (normalized.length > 12 * 1024 * 1024)
      throw new Error("Normalized image must be at most 12 MiB.");
    const digest = createHash("sha256").update(normalized).digest("hex");
    const directory = join(this.root, "data/uploads");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, digest + "." + extension);
    const { default: atomic } = await import("write-file-atomic");
    await atomic(path, normalized, { mode: 0o600 });
    return {
      id: digest,
      url: `/api/uploads/${digest}`,
      bytes: normalized.length,
    };
  }
  async uploadSource(uploadId: string) {
    if (!/^[a-f0-9]{64}$/.test(uploadId)) throw new Error("Invalid upload ID.");
    for (const extension of ["jpg", "png"] as const) {
      const path = join(this.root, "data/uploads", uploadId + "." + extension);
      try {
        await stat(path);
        return { path, sha256: uploadId, extension };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw new Error("Image not found. Upload all views before generating.");
  }
  async submit(
    name: string,
    uploadIds: string | string[],
    providerId: "lux3d" | "fixture",
    input: unknown,
  ) {
    const ids = typeof uploadIds === "string" ? [uploadIds] : uploadIds;
    if (ids.length < 1 || ids.length > 32)
      throw new Error("Select between 1 and 32 views of the same object.");
    const connectionId =
      providerId === "fixture" ? "fixture" : this.activeConnection();
    const sources = [];
    for (const id of ids)
      sources.push({
        ...(await this.uploadSource(id)),
        providerId,
        connectionId,
      });
    return this.jobs.submitImages(name, input, sources);
  }
  publicJob(job: Job) {
    return {
      name: job.name,
      taskId: job.taskId,
      providerId: job.providerId ?? "lux3d",
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      lastError: job.lastError,
      uploadId: job.input?.sha256,
      uploadIds: (job.inputs ?? (job.input ? [job.input] : [])).map(
        (view) => view.sha256,
      ),
      assets: job.assets.map((a) => ({
        ...a,
        url: "/" + a.path.replace(/^public\//, ""),
      })),
    };
  }
  async refresh(name: string) {
    if (this.busy.has(name))
      return this.publicJob(await this.jobs.store.require(name));
    const current = await this.jobs.store.require(name);
    if (
      current.phase === "succeeded" &&
      !current.assets.some((a) => a.format === "glb")
    ) {
      this.busy.add(name);
      try {
        return this.publicJob(await this.download(name, false));
      } finally {
        this.busy.delete(name);
      }
    }
    if (Date.now() - (this.queriedAt.get(name) ?? 0) < 10000)
      return this.publicJob(current);
    this.busy.add(name);
    this.queriedAt.set(name, Date.now());
    try {
      const job = await this.jobs.refresh(name);
      if (job.phase === "succeeded") {
        return this.publicJob(await this.download(name, false));
      }
      return this.publicJob(job);
    } finally {
      this.busy.delete(name);
    }
  }
  async download(name: string, refresh = true) {
    const job = await this.jobs.store.require(name);
    const fetcher: typeof fetch =
      job.providerId === "fixture"
        ? async () =>
            new Response(
              await readFile(
                join(projectRoot, "public/models/offline-robot.glb"),
              ),
            )
        : fetch;
    return download(this.jobs, name, fetcher, refresh);
  }
  async history(name?: string, page = 1, pageSize = 20) {
    const job = name ? await this.jobs.store.require(name) : undefined;
    if (job?.providerId === "fixture") return { tasks: [] };
    if (process.env.DASH_DISABLE_PAID === "1")
      throw new Error("Live provider disabled in test server.");
    const api = createLux3dClient({
      apiKey: this.keyFor(
        job ? (job.connectionId ?? "environment") : this.activeConnection(),
      ),
      region: "cn",
      timeoutMs: 60000,
    });
    return api.tasks.list({ page, pageSize });
  }
}
