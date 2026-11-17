import { createHash } from "node:crypto";
import { z } from "zod";
import type { TextTo3dRequest } from "@manycore/aholo-sdk-lux3d";

export const requestSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(4000),
  style: z
    .enum([
      "photorealistic",
      "cartoon",
      "anime",
      "hand_painted",
      "cyberpunk",
      "fantasy",
      "glass",
    ])
    .default("photorealistic"),
  version: z.enum(["G1", "G1-Turbo"]).default("G1-Turbo"),
  faceCount: z.number().int().min(10_000).max(300_000).default(10_000),
  outputFormat: z
    .array(z.enum(["glb", "zip", "ply"]))
    .min(1)
    .default(["glb"])
    .transform((v) => [...new Set(v)].sort()),
  enablePbr: z.boolean().default(true),
  aiPredictSize: z.boolean().default(false),
});
export type Request = z.output<typeof requestSchema>;
export const imageRequestSchema = requestSchema.omit({
  prompt: true,
  style: true,
});
export type ImageRequest = z.output<typeof imageRequestSchema>;
export function parseRequest(value: unknown): Request & TextTo3dRequest {
  return requestSchema.parse(value);
}
export function fingerprint(params: Request): string {
  return createHash("sha256")
    .update(JSON.stringify({ region: "cn", kind: "text-to-3d", params }))
    .digest("hex");
}
export function validName(name: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error(
      "Job name must be 1–64 lowercase letters, digits, underscores or hyphens.",
    );
  }
  return name;
}
