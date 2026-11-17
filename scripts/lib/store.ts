import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
import writeFileAtomic from "write-file-atomic";
import type { Lux3dTaskResult } from "@manycore/aholo-sdk-lux3d";
import { validName, type Request, type ImageRequest } from "./request.js";

export type Phase =
  | "submitting"
  | "uncertain"
  | "submitted"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";
export interface Asset {
  index: number;
  path: string;
  sha256: string;
  bytes: number;
  format: "glb" | "zip" | "ply";
}
export interface ImageInput {
  path: string;
  sha256: string;
}
export interface Job {
  schemaVersion: 1;
  name: string;
  fingerprint: string;
  region: "cn";
  kind: "text-to-3d" | "image-to-3d";
  params: Request | ImageRequest;
  providerId?: "lux3d" | "fixture";
  connectionId?: string;
  input?: ImageInput;
  inputs?: ImageInput[];
  phase: Phase;
  taskId?: number;
  createdAt: string;
  updatedAt: string;
  result?: Lux3dTaskResult;
  lastError?: string;
  assets: Asset[];
  events: { at: string; action: string }[];
}
export async function jsonWrite(path: string, value: unknown) {
  await writeFileAtomic(path, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
    fsync: true,
  });
}
export class Store {
  readonly directory: string;
  constructor(readonly root: string) {
    this.directory = join(root, "data", "jobs");
  }
  async locked<T>(work: () => Promise<T>): Promise<T> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.directory, {
      retries: 0,
      stale: 120_000,
      update: 10_000,
    });
    try {
      return await work();
    } finally {
      await release();
    }
  }
  async read(name: string): Promise<Job | undefined> {
    const path = join(this.directory, `${validName(name)}.json`);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
    const job = JSON.parse(text) as Job;
    if (
      job.schemaVersion !== 1 ||
      job.name !== name ||
      !Array.isArray(job.events) ||
      !job.params
    ) {
      throw new Error(
        `Unsupported or damaged journal: ${name}. Restore its backup; do not resubmit.`,
      );
    }
    return job;
  }
  async require(name: string): Promise<Job> {
    const job = await this.read(name);
    if (!job) throw new Error(`Unknown local job: ${name}. Run list first.`);
    return job;
  }
  async all(): Promise<Job[]> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(this.directory))
      .filter((name) => name.endsWith(".json"))
      .sort();
    return Promise.all(names.map((name) => this.require(name.slice(0, -5))));
  }
  async save(job: Job, action: string): Promise<Job> {
    job.updatedAt = new Date().toISOString();
    job.events.push({ at: job.updatedAt, action });
    await jsonWrite(join(this.directory, `${validName(job.name)}.json`), job);
    return job;
  }
}
