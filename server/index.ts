import { resolve } from "node:path";
import type { Server } from "node:http";
import { createApp } from "./app.js";
import { root } from "../scripts/lib/config.js";
import { displayHost, networkAccess } from "./network.js";

const port = Number(process.env.DASH_PORT ?? 4100);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("DASH_PORT must be a valid port.");
const dataRoot = process.env.DASH_DATA_ROOT
  ? resolve(process.env.DASH_DATA_ROOT)
  : root;
const access = networkAccess(process.env);
const { app } = await createApp(dataRoot, access);
const servers: Server[] = [];
function close() {
  for (const server of servers) {
    server.closeAllConnections();
    server.close();
  }
}
const listenHosts =
  access.bindHost === "0.0.0.0"
    ? ["0.0.0.0"]
    : ["127.0.0.1", ...(access.tailscaleIP ? [access.tailscaleIP] : [])];
for (const host of listenHosts) {
  const server = app.listen(port, host, () =>
    console.log(`Home dashboard: http://${displayHost(host)}:${port}`),
  );
  servers.push(server);
  server.on("error", (error) => {
    console.error(
      `Cannot listen on ${displayHost(host)}:${port}: ${error.message}`,
    );
    close();
    process.exitCode = 1;
  });
}
process.on("SIGTERM", close);
process.on("SIGINT", close);
