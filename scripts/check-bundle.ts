import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { root } from "./lib/config.js";

// Check the actual publication boundary, including copied public assets.
const denied = ["AHOLO_API_KEY", "@manycore/aholo-sdk", "api.aholo3d.cn"];
const key = process.env.AHOLO_API_KEY;
if (key && key !== "your_api_key_here") denied.push(key);
try {
  const settings = JSON.parse(
    await readFile(join(root, "data/private/providers.json"), "utf8"),
  );
  for (const connection of settings.connections)
    if (connection.key) denied.push(connection.key);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
try {
  const token = (
    await readFile(join(root, "data/private/agent-token"), "utf8")
  ).trim();
  if (token) denied.push(token);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
try {
  const adminToken = (
    await readFile(join(root, "data/private/admin-token"), "utf8")
  ).trim();
  if (adminToken) denied.push(adminToken);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
if (process.env.DASH_ADMIN_KEY?.trim()) denied.push(process.env.DASH_ADMIN_KEY.trim());
let count = 0;
async function inspect(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.name.startsWith(".env") || entry.name === "jobs") {
      throw new Error(
        `Private file/directory in build: ${relative(root, path)}`,
      );
    }
    if (entry.isDirectory()) await inspect(path);
    else {
      const content = await readFile(path);
      if (denied.some((value) => content.includes(Buffer.from(value)))) {
        throw new Error(
          `Server credential/API marker detected in ${relative(root, path)}; value hidden.`,
        );
      }
      count++;
    }
  }
}
await inspect(join(root, "dist"));
console.log(
  `Browser boundary passed: ${count} build files; no server API markers${key ? " or configured key" : ""}.`,
);
