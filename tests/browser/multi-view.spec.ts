import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { loginAdmin } from "./auth.js";

test.beforeEach(async ({ page }) => {
  await loginAdmin(page);
});

async function openCapture(page: Page) {
  await page.getByRole("button", { name: "打开共在中枢", exact: true }).click();
  await page.getByRole("button", { name: /^录入物品/ }).click();
}

test("multiple views keep the chosen primary, generate one model and reopen all references after reload", async ({
  page,
}, info) => {
  await page.goto("/");
  await openCapture(page);
  const initialState = await page.request.get("/api/state");
  expect(initialState.ok()).toBe(true);
  const before = await initialState.json();
  await page.getByLabel("生成服务").selectOption("fixture");
  const files = [];
  for (const [index, background] of [
    "#40659180",
    "#94adba",
    "#bac9d6",
  ].entries()) {
    files.push({
      name: ["front.png", "side.png", "top.png"][index],
      mimeType: "image/png",
      buffer: await sharp({
        create: { width: 240, height: 200, channels: 4, background },
      })
        .png()
        .toBuffer(),
    });
  }
  await page.getByLabel("物品照片").setInputFiles(files);
  const views = page.getByRole("list", { name: "生成视角" });
  await expect(views.locator("li")).toHaveCount(3);
  const original = await views
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  await page
    .getByRole("button", { name: "将视角 2 设为主图", exact: true })
    .click();
  await expect(views.locator("img").first()).toHaveAttribute(
    "src",
    original[1]!,
  );
  await page.getByRole("button", { name: "移除视角 3", exact: true }).click();
  await expect(views.locator("li")).toHaveCount(2);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    await expect(
      page.getByRole("button", { name: "生成 3D 模型", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const bounds = await page.locator(".capture-modal").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
    await page.screenshot({
      path: info.outputPath(`multi-view-input-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  const submissions: unknown[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/generations"
    )
      submissions.push(request.postDataJSON());
  });
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/generations",
  );
  await page.getByRole("button", { name: "生成 3D 模型", exact: true }).click();
  const job = await (await created).json();
  const expectedIds = [original[1]!, original[0]!].map((url) =>
    url.split("/").at(-1),
  );
  expect(job.uploadIds).toEqual(expectedIds);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    uploadIds: expectedIds,
    providerId: "fixture",
  });
  await expect(page.locator(".preview-badge")).toContainText("部件");
  await expect(page.locator(".capture-photo img")).toHaveCount(2);
  await expect(page.getByAltText("生成使用的参考照片")).toHaveAttribute(
    "src",
    original[1]!,
  );
  await page.reload();
  await openCapture(page);
  await page
    .locator(".job")
    .filter({ hasText: job.name.slice(-8) })
    .click();
  await expect(page.locator(".preview-badge")).toContainText("部件");
  await expect(page.locator(".capture-photo img")).toHaveCount(2);
  await expect(page.getByAltText("生成使用的参考照片")).toHaveAttribute(
    "src",
    original[1]!,
  );
  const after = await (await page.request.get("/api/state")).json();
  expect(after.revision).toBe(before.revision);
  expect(after.home).toEqual(before.home);
});

test("more than 32 views stop before uploading or creating a task", async ({
  page,
}) => {
  await page.goto("/");
  await openCapture(page);
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      ["/api/uploads", "/api/generations"].includes(
        new URL(request.url()).pathname,
      )
    )
      writes++;
  });
  const buffer = await sharp({
    create: { width: 8, height: 8, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("物品照片").setInputFiles(
    Array.from({ length: 33 }, (_, index) => ({
      name: `view-${index}.png`,
      mimeType: "image/png",
      buffer,
    })),
  );
  await expect(
    page.getByText("同一物品最多选择 32 张照片，请先移除多余视角。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成 3D 模型", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(0);
});
