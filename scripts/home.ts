import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Command } from "commander";
import { isLoopback, isTailscaleIP } from "../server/network.js";
import { root, registerSecret, safeError } from "./lib/config.js";

const cli = new Command()
  .name("home")
  .description(
    "Home dashboard agent client. All changes share the browser command API.",
  );
cli.option(
  "--url <url>",
  "Loopback or Tailscale server URL",
  "http://127.0.0.1:4100",
);
async function call(path: string, body?: unknown) {
  const target = new URL(cli.opts().url);
  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  const tailnet =
    isTailscaleIP(hostname) ||
    /^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname);
  if (
    !["http:", "https:"].includes(target.protocol) ||
    !(isLoopback(hostname) || tailnet) ||
    target.username ||
    target.password
  ) {
    throw new Error("The home CLI requires a loopback or Tailscale URL.");
  }
  const token =
    process.env.HOMEDASH_TOKEN ??
    (await readFile(join(root, "data/private/agent-token"), "utf8")).trim();
  registerSecret(token);
  const isForm = body instanceof FormData;
  const response = await fetch(new URL(path, target), {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body && !isForm ? { "Content-Type": "application/json" } : {}),
    },
    body: body
      ? isForm
        ? body
        : JSON.stringify(body)
      : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
  return value;
}
cli
  .command("state")
  .description("Read current state, source dates and revision")
  .action(async () =>
    console.log(JSON.stringify(await call("/api/state"), null, 2)),
  );
cli
  .command("schema")
  .description("Read the JSON schema for agent commands")
  .action(async () =>
    console.log(JSON.stringify(await call("/api/command-schema"), null, 2)),
  );
cli
  .command("command <file>")
  .description("Submit a complete command JSON; retain operationId for retries")
  .action(async (file: string) =>
    console.log(
      JSON.stringify(
        await call("/api/commands", JSON.parse(await readFile(file, "utf8"))),
        null,
        2,
      ),
    ),
  );
cli
  .command("event <file>")
  .description("Ingest a normalized external notification JSON")
  .action(async (file: string) =>
    console.log(
      JSON.stringify(
        await call("/api/events", JSON.parse(await readFile(file, "utf8"))),
        null,
        2,
      ),
    ),
  );
cli
  .command("icons")
  .description("List built-in icon keys and standalone local icon library assets")
  .action(async () =>
    console.log(JSON.stringify(await call("/api/icons"), null, 2)),
  );
cli
  .command("icon-upload <file>")
  .option("--name <name>", "Display name for the icon asset")
  .description("Upload a local PNG/JPEG/WebP/GIF/SVG into the icon library")
  .action(async (file: string, options: { name?: string }) => {
    const bytes = await readFile(file);
    const form = new FormData();
    form.append("image", new Blob([bytes]), basename(file));
    if (options.name) form.append("name", options.name);
    console.log(JSON.stringify(await call("/api/icons", form), null, 2));
  });
try {
  await cli.parseAsync();
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
