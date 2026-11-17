import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Command, InvalidArgumentError } from "commander";
import { root, redact, safeError } from "./lib/config.js";
import { type Job } from "./lib/store.js";
import { Providers } from "../server/providers.js";

const providers = new Providers(
  process.env.DASH_DATA_ROOT ? resolve(process.env.DASH_DATA_ROOT) : root,
);
await providers.init();
const jobs = providers.jobs;
const store = jobs.store;
const print = (value: unknown) =>
  console.log(redact(JSON.stringify(value, null, 2)));
const summary = (job: Job) => ({
  name: job.name,
  taskId: job.taskId,
  phase: job.phase,
  status: job.result?.status,
  updatedAt: job.updatedAt,
  assets: job.assets,
  lastError: job.lastError,
});
function integer(value: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new InvalidArgumentError("Expected a positive safe integer.");
  return n;
}
function assertTrackable(job: Job) {
  if (!job.taskId)
    throw new Error(
      `Job ${job.name} has no confirmed task ID. Use history, then attach; automatic resubmission is blocked.`,
    );
  if (["failed", "canceled"].includes(job.phase))
    throw new Error(
      `Existing task is ${job.phase}; no replacement was generated. Inspect show before deciding on another attempt.`,
    );
}
const cli = new Command()
  .name("lux3d")
  .description("Durable Lux3D tasks; credentials stay in .env.local.");
cli
  .command("submit")
  .description("Submit text-to-3D once, or reuse the existing journal")
  .requiredOption("--name <name>", "Stable local job name")
  .requiredOption("--request <file>", "JSON generation parameters")
  .option(
    "--allow-repeat",
    "Explicitly pay for the same parameters again under a NEW name",
  )
  .action(async (options) => {
    const { job, reused } = await jobs.submit(
      options.name,
      JSON.parse(await readFile(options.request, "utf8")),
      options.allowRepeat,
    );
    print({ reused, ...summary(job) });
    assertTrackable(job);
  });
cli
  .command("submit-image")
  .description("Normalize 1–32 local views, then submit one image-to-3D task")
  .requiredOption("--name <name>", "Stable local job name")
  .requiredOption(
    "--image <files...>",
    "Ordered local JPEG/PNG/WebP views; clearest primary view first (1–32)",
  )
  .option("--request <file>", "JSON image generation parameters (no prompt)")
  .option("--provider <id>", "lux3d or explicit offline fixture", "lux3d")
  .action(async (options) => {
    if (!["lux3d", "fixture"].includes(options.provider))
      throw new Error("Unknown image provider.");
    if (options.image.length < 1 || options.image.length > 32)
      throw new Error("Select between 1 and 32 views of the same object.");
    const uploadIds: string[] = [];
    for (const file of options.image)
      uploadIds.push((await providers.upload(await readFile(file))).id);
    const input = options.request
      ? JSON.parse(await readFile(options.request, "utf8"))
      : {};
    const { job, reused } = await providers.submit(
      options.name,
      uploadIds,
      options.provider,
      input,
    );
    print({ reused, ...summary(job) });
    assertTrackable(job);
  });
cli
  .command("list")
  .description("List local jobs, without API access")
  .action(async () => print((await store.all()).map(summary)));
cli
  .command("show <name>")
  .description(
    "Show local parameters, events and results (signed URLs remain private)",
  )
  .action(async (name: string) => {
    const job = await store.require(name);
    print({
      ...job,
      result: job.result
        ? {
            ...job.result,
            outputs: job.result.outputs.map((_, index) => ({
              index,
              content: "[stored in private journal]",
            })),
          }
        : undefined,
    });
  });
cli
  .command("history")
  .description("Query remote history for recovery; does not generate")
  .option("--page <number>", "Page number", integer, 1)
  .option("--page-size <number>", "Page size (max 100)", integer, 20)
  .option("--job <name>", "Use the connection pinned to this local job")
  .action(async (options) => {
    if (options.pageSize > 100) throw new Error("Page size must be <= 100.");
    print(await providers.history(options.job, options.page, options.pageSize));
  });
cli
  .command("attach <name> <taskId>")
  .description("Recover a journal using an ID you have confirmed belongs to it")
  .requiredOption(
    "--confirm-match",
    "Confirm ID matches the local parameters; API history cannot prove this",
  )
  .action(async (name: string, id: string) =>
    print(summary(await jobs.attach(name, integer(id)))),
  );
cli
  .command("status <name>")
  .description("Refresh status; optional bounded polling (no new generation)")
  .option("--watch", "Poll until terminal status")
  .option("--interval <seconds>", "Poll interval, at least 10", integer, 15)
  .option(
    "--timeout <seconds>",
    "Maximum wait; rerun status to resume",
    integer,
    600,
  )
  .action(async (name: string, options) => {
    if (options.interval < 10)
      throw new Error("Polling interval must be >= 10 seconds.");
    const deadline = Date.now() + options.timeout * 1000;
    do {
      const job = await jobs.refresh(name);
      print(summary(job));
      if (["failed", "canceled"].includes(job.phase))
        throw new Error(`Task ${job.phase}. No regeneration was attempted.`);
      if (!options.watch || job.phase === "succeeded") return;
      const remaining = deadline - Date.now();
      if (remaining <= options.interval * 1000) {
        throw new Error(
          "Polling deadline reached. Journal saved; rerun status --watch to resume.",
        );
      }
      await delay(options.interval * 1000);
    } while (Date.now() < deadline);
    throw new Error(
      "Polling deadline reached. Rerun status --watch to resume.",
    );
  });
cli
  .command("download <name>")
  .description("Refresh URLs and persist outputs; safe to rerun")
  .action(async (name: string) =>
    print(summary(await providers.download(name))),
  );
try {
  await cli.parseAsync();
} catch (error) {
  console.error(safeError(error));
  process.exitCode = 1;
}
