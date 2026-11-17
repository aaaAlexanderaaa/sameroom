import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createLux3dClient } from "@manycore/aholo-sdk-lux3d";

export const root = fileURLToPath(new URL("../../", import.meta.url));
config({ path: resolve(root, ".env.local"), quiet: true });

export function client() {
  const apiKey = process.env.AHOLO_API_KEY?.trim();
  if (!apiKey || apiKey === "your_api_key_here") {
    throw new Error("Set AHOLO_API_KEY in .env.local. See .env.example.");
  }
  if (process.env.AHOLO_REGION && process.env.AHOLO_REGION !== "cn") {
    throw new Error("This workspace supports AHOLO_REGION=cn only.");
  }
  // Verified in core 1.3.0: one fetch per request, no automatic retries.
  return createLux3dClient({ apiKey, region: "cn", timeoutMs: 60_000 });
}

const privateValues = new Set<string>();
export function registerSecret(value: string) {
  if (value) privateValues.add(value);
}
export function redact(text: string): string {
  if (process.env.AHOLO_API_KEY) privateValues.add(process.env.AHOLO_API_KEY);
  for (const value of privateValues)
    text = text.split(value).join("[REDACTED]");
  return text;
}

export function safeError(error: unknown): string {
  if (!(error instanceof Error))
    return "Unknown failure; inspect task state before retrying.";
  const detail = error as Error & {
    statusCode?: number;
    cmdCode?: string;
    bizCode?: string;
  };
  return redact(
    [
      detail.name,
      detail.message,
      detail.statusCode,
      detail.cmdCode,
      detail.bizCode,
    ]
      .filter((v) => v !== undefined)
      .join(": "),
  ).replace(/https?:\/\/\S+/g, "[URL omitted]");
}
