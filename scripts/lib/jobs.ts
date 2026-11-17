import type {
  Lux3dTaskResult,
  TextTo3dRequest,
} from "@manycore/aholo-sdk-lux3d";
import { createHash } from "node:crypto";
import {
  fingerprint,
  parseRequest,
  validName,
  imageRequestSchema,
  type ImageRequest,
} from "./request.js";
import { Store, type Job, type Phase, type ImageInput } from "./store.js";
import { safeError } from "./config.js";

export interface Api {
  textTo3d: { create(params: TextTo3dRequest): Promise<number> };
  imgTo3d?: {
    createFromFile(path: string, params: ImageRequest): Promise<number>;
    createFromFiles?(paths: string[], params: ImageRequest): Promise<number>;
  };
  tasks: { retrieve(id: number): Promise<Lux3dTaskResult> };
}
const phases: Record<number, Phase> = {
  0: "submitted",
  1: "running",
  3: "succeeded",
  4: "failed",
  6: "canceled",
};
export interface ImageSource extends ImageInput {
  providerId: "lux3d" | "fixture";
  connectionId: string;
}
export function checkedResult(
  result: Lux3dTaskResult,
  id: number,
): Lux3dTaskResult {
  if (
    result.taskId !== id ||
    !Object.hasOwn(phases, result.status) ||
    !Array.isArray(result.outputs)
  ) {
    throw new Error(
      "Unexpected SDK task response; saved state retained. Recheck official API contract.",
    );
  }
  return result;
}
export function checkedId(id: number): number {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new Error("Task ID must be a positive safe integer.");
  return id;
}
export class Jobs {
  constructor(
    readonly store: Store,
    readonly api: (job?: Job) => Api,
    readonly connection: () => string = () => "environment",
  ) {}
  async submit(
    name: string,
    input: unknown,
    allowRepeat = false,
  ): Promise<{ job: Job; reused: boolean }> {
    validName(name);
    const params = parseRequest(input);
    const connectionId = this.connection();
    const hash =
      connectionId === "environment"
        ? fingerprint(params)
        : createHash("sha256")
            .update(
              JSON.stringify({ params, connectionId, providerId: "lux3d" }),
            )
            .digest("hex");
    return this.store.locked(async () => {
      const named = await this.store.read(name);
      if (named && named.fingerprint !== hash)
        throw new Error(
          "This name belongs to different parameters. Choose a new name.",
        );
      const duplicate =
        named ??
        (!allowRepeat
          ? (await this.store.all()).find((job) => job.fingerprint === hash)
          : undefined);
      if (duplicate) return { job: duplicate, reused: true };
      const now = new Date().toISOString();
      const job: Job = {
        schemaVersion: 1,
        name,
        fingerprint: hash,
        region: "cn",
        kind: "text-to-3d",
        providerId: "lux3d",
        connectionId,
        params,
        phase: "submitting",
        createdAt: now,
        updatedAt: now,
        assets: [],
        events: [],
      };
      const api = this.api(job); // Fail configuration before creating an uncertain journal.
      await this.store.save(
        job,
        allowRepeat
          ? "submission intent: explicit paid repeat"
          : "submission intent",
      );
      try {
        job.taskId = checkedId(await api.textTo3d.create(params));
        job.phase = "submitted";
        await this.store.save(job, "task ID received");
      } catch (error) {
        job.phase = "uncertain";
        job.lastError = safeError(error);
        await this.store.save(
          job,
          "submission uncertain; automatic resubmission blocked",
        );
        throw new Error(
          `Submission uncertain for ${name}: ${job.lastError}. Use history and attach; do not resubmit.`,
        );
      }
      return { job, reused: false };
    });
  }
  async submitImage(name: string, input: unknown, source: ImageSource) {
    return this.submitImages(name, input, [source]);
  }
  async submitImages(name: string, input: unknown, sources: ImageSource[]) {
    validName(name);
    const params = imageRequestSchema.parse(input);
    if (sources.length < 1 || sources.length > 32)
      throw new Error("Select between 1 and 32 views of the same object.");
    const source = sources[0];
    if (
      sources.some(
        (view) =>
          view.providerId !== source.providerId ||
          view.connectionId !== source.connectionId,
      )
    )
      throw new Error("All views must use the same provider connection.");
    const inputs = sources.map(({ path, sha256 }) => ({ path, sha256 }));
    const hash = createHash("sha256")
      .update(
        JSON.stringify({
          kind: "image-to-3d",
          region: "cn",
          params,
          sha256:
            sources.length === 1
              ? source.sha256
              : sources.map((view) => view.sha256),
          providerId: source.providerId,
          connectionId: source.connectionId,
        }),
      )
      .digest("hex");
    return this.store.locked(async () => {
      const named = await this.store.read(name);
      if (named && named.fingerprint !== hash)
        throw new Error("Job name already belongs to another generation.");
      const existing =
        named ?? (await this.store.all()).find((j) => j.fingerprint === hash);
      if (existing) return { job: existing, reused: true };
      const now = new Date().toISOString();
      const job: Job = {
        schemaVersion: 1,
        name,
        fingerprint: hash,
        region: "cn",
        kind: "image-to-3d",
        params,
        providerId: source.providerId,
        connectionId: source.connectionId,
        input: { path: source.path, sha256: source.sha256 },
        ...(sources.length > 1 ? { inputs } : {}),
        phase: "submitting",
        createdAt: now,
        updatedAt: now,
        assets: [],
        events: [],
      };
      const api = this.api(job);
      if (!api.imgTo3d)
        throw new Error(
          "Selected provider does not support local image input.",
        );
      if (sources.length > 1 && !api.imgTo3d.createFromFiles)
        throw new Error("Selected provider does not support multi-view input.");
      await this.store.save(job, "image submission intent");
      try {
        job.taskId = checkedId(
          sources.length === 1
            ? await api.imgTo3d.createFromFile(source.path, params)
            : await api.imgTo3d.createFromFiles!(
                inputs.map((view) => view.path),
                params,
              ),
        );
        job.phase = "submitted";
        await this.store.save(job, "task ID received");
      } catch (error) {
        job.phase = "uncertain";
        job.lastError = safeError(error);
        await this.store.save(
          job,
          "image submission uncertain; automatic resubmission blocked",
        );
        throw new Error(
          `Submission uncertain for ${name}; inspect the job and remote history before another attempt.`,
        );
      }
      return { job, reused: false };
    });
  }
  async refresh(name: string): Promise<Job> {
    return this.store.locked(async () => {
      const job = await this.store.require(name);
      if (!job.taskId)
        throw new Error(
          `No task ID for ${name}. Inspect history, then attach the confirmed ID.`,
        );
      try {
        job.result = checkedResult(
          await this.api(job).tasks.retrieve(job.taskId),
          job.taskId,
        );
        job.phase = phases[job.result.status];
        delete job.lastError;
        return await this.store.save(job, `query: ${job.phase}`);
      } catch (error) {
        job.lastError = safeError(error);
        await this.store.save(job, "query failed; previous result preserved");
        throw error;
      }
    });
  }
  async attach(name: string, id: number): Promise<Job> {
    checkedId(id);
    return this.store.locked(async () => {
      const job = await this.store.require(name);
      if (job.taskId && job.taskId !== id)
        throw new Error(
          "This job already has a different task ID. It cannot be overwritten.",
        );
      if (
        (await this.store.all()).some(
          (j) =>
            j.name !== name &&
            j.taskId === id &&
            (j.providerId ?? "lux3d") === (job.providerId ?? "lux3d") &&
            (j.connectionId ?? "environment") ===
              (job.connectionId ?? "environment"),
        )
      ) {
        throw new Error("Task ID is already attached to another local job.");
      }
      const result = checkedResult(await this.api(job).tasks.retrieve(id), id);
      job.taskId = id;
      job.result = result;
      job.phase = phases[result.status];
      delete job.lastError;
      return this.store.save(job, "operator attached verified task ID");
    });
  }
}
