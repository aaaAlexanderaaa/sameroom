import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { root } from "./lib/config.js";
// Unique disposable test root; never touch the owner's dashboard or jobs.
process.env.DASH_DISABLE_PAID = "1";
await mkdir(join(root, ".cache"), { recursive: true });
const testRoot = await mkdtemp(join(root, ".cache/e2e-"));
const { app } = await createApp(testRoot);
const server = app.listen(4173, "127.0.0.1");
async function close() {
  server.closeAllConnections();
  server.close();
  await rm(testRoot, { recursive: true, force: true });
  process.exit(0);
}
process.once("SIGTERM", () => void close());
process.once("SIGINT", () => void close());
