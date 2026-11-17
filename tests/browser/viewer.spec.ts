import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loginAdmin } from "./auth.js";

test.beforeEach(async ({ page }) => {
  await loginAdmin(page);
});

test("renders GLB geometry and supports rotation, zoom, lighting, selection and file recovery", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/inspector.html");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  const viewport = page.locator("#viewport");
  await expect(viewport).toHaveAttribute("data-meshes", "10");
  await expect
    .poll(async () => Number(await viewport.getAttribute("data-triangles")))
    .toBeGreaterThan(100);
  await expect
    .poll(async () => Number(await viewport.getAttribute("data-frames")))
    .toBeGreaterThan(5);
  const before = await viewport.screenshot();
  const initialCamera = await viewport.getAttribute("data-camera");
  await page.getByRole("button", { name: "向右旋转" }).click();
  await expect(viewport).not.toHaveAttribute("data-camera", initialCamera!);
  const initialDistance = Number(await viewport.getAttribute("data-distance"));
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await expect
    .poll(async () => Number(await viewport.getAttribute("data-distance")))
    .toBeLessThan(initialDistance);
  await page.locator("#light").fill("1");
  await expect(viewport).toHaveAttribute("data-light", "1");
  expect(Buffer.compare(before, await viewport.screenshot())).not.toBe(0);
  await page.getByRole("button", { name: "重置视角" }).click();
  await page.locator("#light").fill("3");
  // Pointer rotation and wheel operate on the actual WebGL canvas.
  const canvas = page.locator("canvas");
  const box = (await canvas.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const prior = await viewport.getAttribute("data-camera");
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 85, center.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("data-camera", prior!);
  await page.mouse.wheel(0, -150);
  await page.getByRole("button", { name: "重置视角" }).click();
  await expect(viewport).toHaveAttribute("data-camera", "3.600,2.700,4.700");
  const selectionBox = (await canvas.boundingBox())!;
  await page.mouse.click(
    selectionBox.x + selectionBox.width / 2,
    selectionBox.y + selectionBox.height / 2,
  );
  await expect(page.locator("#selection")).not.toHaveText("未选择部件");
  await page.locator("#wireframe").check();
  await page.locator("#grid").uncheck();
  await page.locator("#auto-rotate").check();
  const rotating = await viewport.getAttribute("data-camera");
  await expect(viewport).not.toHaveAttribute("data-camera", rotating!);
  await page.locator("#auto-rotate").uncheck();
  await page.locator("#wireframe").uncheck();
  await page.locator("#grid").check();
  await page.locator("#file").setInputFiles({
    name: "broken.glb",
    mimeType: "model/gltf-binary",
    buffer: Buffer.from("not glb"),
  });
  await expect(page.locator("#status")).toHaveAttribute("data-state", "error");
  await expect(viewport).toHaveAttribute("data-meshes", "10");
  await page
    .locator("#file")
    .setInputFiles(resolve("public/models/offline-robot.glb"));
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#model-source")).toContainText("本地文件");
  await page.screenshot({
    path: testInfo.outputPath("desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

for (const width of [390, 768]) {
  test(`usable layout and WebGL at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/inspector.html");
    await expect(page.locator("#status")).toHaveAttribute(
      "data-state",
      "ready",
    );
    await expect(page.locator("#auto-rotate")).not.toBeChecked();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "重置视角" }),
    ).toBeInViewport();
    const canvas = await page.locator("canvas").boundingBox();
    expect(canvas!.width).toBeGreaterThan(250);
    expect(canvas!.height).toBeGreaterThan(400);
    await page.screenshot({
      path: testInfo.outputPath(`width-${width}.png`),
      fullPage: true,
    });
  });
}

test("context loss exposes a recovery message", async ({ page }) => {
  await page.goto("/inspector.html");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) =>
      canvas
        .getContext("webgl2")!
        .getExtension("WEBGL_lose_context")!
        .loseContext(),
    );
  await expect(page.locator("#status")).toContainText("刷新页面");
});

test("WebGL unavailable disables controls with actionable feedback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: unknown[]
    ) {
      if (type.startsWith("webgl")) return null;
      return Reflect.apply(original, this, [type, ...args]);
    } as typeof original;
  });
  await page.goto("/inspector.html");
  await expect(page.locator("#status")).toContainText("硬件加速");
  await expect(page.locator("#model-select")).toBeDisabled();
  await expect(page.getByRole("button", { name: "重置视角" })).toBeDisabled();
});

test("a slow older load cannot replace a newer selected local file", async ({
  page,
}) => {
  const glb = readFileSync(resolve("public/models/offline-robot.glb"));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/generated/manifest.json", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        models: [{ name: "Slow model", url: "/generated/slow/0.glb" }],
      },
    }),
  );
  await page.route("**/generated/slow/0.glb", async (route) => {
    requested = true;
    await gate;
    await route.fulfill({ body: glb, contentType: "model/gltf-binary" });
  });
  await page.goto("/inspector.html");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await page.locator("#model-select").selectOption("/generated/slow/0.glb");
  await expect.poll(() => requested).toBe(true);
  await page.locator("#file").setInputFiles({
    name: "newer.glb",
    mimeType: "model/gltf-binary",
    buffer: glb,
  });
  await expect(page.locator("#model-title")).toHaveText("newer.glb");
  const completed = page.waitForResponse("**/generated/slow/0.glb");
  release();
  await completed;
  const frame = Number(
    await page.locator("#viewport").getAttribute("data-frames"),
  );
  await expect
    .poll(async () =>
      Number(await page.locator("#viewport").getAttribute("data-frames")),
    )
    .toBeGreaterThan(frame + 5);
  await expect(page.locator("#model-title")).toHaveText("newer.glb");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
});

test("downloaded Lux3D asset renders when available locally", async ({
  page,
}, testInfo) => {
  const manifestPath = resolve("public/generated/manifest.json");
  test.skip(
    !existsSync(manifestPath),
    "No live generated asset; offline verification still runs.",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  test.skip(manifest.models.length === 0, "No generated GLB in manifest.");
  // The API tests use an isolated asset library. Explicitly mount this local,
  // already-paid asset for the inspector case without copying private journals.
  await page.route("**/generated/manifest.json", (route) =>
    route.fulfill({ json: manifest }),
  );
  await page.route("**" + manifest.models[0].url, (route) =>
    route.fulfill({
      body: readFileSync(resolve("public" + manifest.models[0].url)),
      contentType: "model/gltf-binary",
    }),
  );
  await page.goto("/inspector.html");
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await page.locator("#model-select").selectOption(manifest.models[0].url);
  await expect(page.locator("#status")).toHaveAttribute("data-state", "ready");
  await expect(page.locator("#model-source")).toContainText("Lux3D");
  await expect
    .poll(async () =>
      Number(await page.locator("#viewport").getAttribute("data-triangles")),
    )
    .toBeGreaterThan(100);
  await page.screenshot({
    path: testInfo.outputPath("lux3d.png"),
    fullPage: true,
  });
});
