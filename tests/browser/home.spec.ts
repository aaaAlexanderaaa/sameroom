import { test, expect, type Page, type Locator } from "@playwright/test";
import sharp from "sharp";
import { OrthographicCamera, Vector3 } from "three";
import type { Action, Dashboard } from "../../shared/domain.js";
import { loginAdmin } from "./auth.js";

async function openMenu(page: Page) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "打开共在中枢", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "共在中枢", exact: true }),
  ).toBeVisible();
}
async function openBrowse(page: Page) {
  await openMenu(page);
  await page.getByRole("button", { name: "物件与搜索" }).click();
}
async function openOverview(page: Page) {
  await openMenu(page);
  await page.getByRole("button", { name: "家庭概览" }).click();
}
async function selectRecord(page: Page, name: string) {
  await openBrowse(page);
  await page.locator(".object-item").filter({ hasText: name }).click();
}
async function chooseRoom(page: Page, name: string) {
  await openBrowse(page);
  await page
    .getByRole("navigation", { name: "房间", exact: true })
    .getByRole("button", { name: new RegExp(name) })
    .click();
}
async function openLayout(page: Page) {
  await openMenu(page);
  await page.getByRole("button", { name: "编辑户型与模板" }).click();
}

async function snapshot(page: Page): Promise<Dashboard> {
  return page.evaluate(async () => (await fetch("/api/state")).json());
}
async function expectSceneIdle(page: Page, scene: Locator) {
  // A transition may finish after a fixed delay on software WebGL. Require
  // a continuous second without renders after asynchronous work settles.
  await expect
    .poll(async () => {
      const frames = await scene.getAttribute("data-frames");
      await page.waitForTimeout(1000);
      return (await scene.getAttribute("data-frames")) === frames;
    })
    .toBe(true);
}
async function command(page: Page, action: Action) {
  const sessionToken = await loginAdmin(page);
  const current = await (await page.request.get("/api/state")).json();
  const result = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": sessionToken },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: current.revision,
      issuedAt: new Date().toISOString(),
      action,
    },
  });
  expect(result.ok()).toBe(true);
}

async function objectPoint(page: Page, id: string) {
  const state = await snapshot(page);
  const entity = state.home.entities.find((entity) => entity.id === id)!;
  const room = state.home.rooms.find((room) => room.id === entity.locationId)!;
  const asset = state.home.assets.find((asset) => asset.id === entity.assetId)!;
  const scene = page.locator(".home-viewport");
  const box = (await scene.boundingBox())!;
  const camera = new OrthographicCamera(
    -10,
    10,
    (10 * box.height) / box.width,
    (-10 * box.height) / box.width,
    0.1,
    250,
  );
  camera.position.fromArray(
    (await scene.getAttribute("data-camera"))!.split(",").map(Number),
  );
  camera.zoom = Number(await scene.getAttribute("data-zoom"));
  camera.lookAt(
    new Vector3().fromArray(
      (await scene.getAttribute("data-target"))!.split(",").map(Number),
    ),
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const point = new Vector3()
    .fromArray(room.origin)
    .add(new Vector3().fromArray(entity.position))
    .add(new Vector3(0, asset.height * 0.55, 0))
    .project(camera);
  return {
    x: box.x + ((point.x + 1) * box.width) / 2,
    y: box.y + ((1 - point.y) * box.height) / 2,
  };
}

test.beforeEach(async ({ page }) => {
  await loginAdmin(page);
});

test("quiet scene reveals only hovered or selected objects; empty clicks, keyboard and drag behave deliberately", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-entities", "4");
  await expectSceneIdle(page, scene);
  const before = await snapshot(page);
  await expect(
    page.locator(".space-panel, header, aside, .camera-toolbar"),
  ).toHaveCount(0);
  await expect(page.locator(".scene-label-layer button:visible")).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "打开共在中枢" })).toBeVisible();
  const box = (await scene.boundingBox())!;
  expect(box).toEqual({ x: 0, y: 0, width: 1440, height: 960 });
  await page.screenshot({ path: info.outputPath("spatial-canvas.png") });
  const point = await objectPoint(page, "studio-mini");
  await page.mouse.move(point.x, point.y);
  await expect(page.locator(".scene-object-label:visible")).toHaveText(
    "Studio mini",
  );
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".detail-title")).toContainText("Studio mini");
  await page
    .getByLabel("这个物件的故事 / 备注")
    .fill("/ does not open search while editing");
  await expect(page.getByRole("dialog", { name: "物件与搜索" })).toHaveCount(0);
  await scene.locator("canvas").click({ position: { x: 15, y: 15 } });
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await page.mouse.move(160, 100, { steps: 3 });
  await page.mouse.move(80, 80, { steps: 3 });
  await page.mouse.up();
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await scene.locator("canvas").click({ position: { x: 15, y: 15 } });
  await expect(page.getByRole("dialog", { name: "共在中枢" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await page.getByRole("button", { name: "打开共在中枢" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "共在中枢" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "打开共在中枢" }),
  ).toBeFocused();
  await page.keyboard.press("/");
  await expect(page.getByLabel("搜索物件")).toBeFocused();
  await page.getByLabel("搜索物件").fill("Cloud node");
  await expect(page.locator(".scene-object-label:visible")).toHaveText(
    "Cloud node",
  );
  await page.keyboard.press("Escape");
  await expect(scene).toHaveAttribute("data-entities", "4");
  await expect(page.locator(".scene-object-label:visible")).toHaveCount(0);
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "连接与设置" }).click();
  await expect(page.locator("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog, .space-panel")).toHaveCount(0);
  expect(await snapshot(page)).toEqual(before);
});

test("touch can discover the menu and select an object without a hover; pinch never opens a panel", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  await loginAdmin(page);
  await page.goto("http://127.0.0.1:4173/");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-entities", "4");
  await expectSceneIdle(page, scene);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: 120, y: 180, id: 1 },
      { x: 240, y: 180, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: 90, y: 180, id: 1 },
      { x: 270, y: 180, id: 2 },
    ],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await page.touchscreen.tap(20, 20);
  await expect(page.getByRole("dialog", { name: "共在中枢" })).toBeVisible();
  await page.getByRole("button", { name: "重置家庭视角" }).tap();
  await page.getByRole("button", { name: "关闭空间面板" }).tap();
  await expectSceneIdle(page, scene);
  const point = await objectPoint(page, "studio-mini");
  await page.touchscreen.tap(point.x, point.y);
  await expect(page.locator(".detail-title")).toContainText("Studio mini");
  const panel = (await page.locator(".space-panel").boundingBox())!;
  const canvas = (await scene.boundingBox())!;
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(panel.y);
  await page.getByRole("button", { name: "取消选择" }).tap();
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await context.close();
});

test("presentation isolates rooms, compares materials and preserves every record", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "warning") errors.push(m.text());
  });
  await page.goto("/");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-rooms", "3");
  const before = await snapshot(page);
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await expect(page.locator(".scene-label-layer button:visible")).toHaveCount(
    0,
  );
  await page.screenshot({ path: info.outputPath("spatial-default.png") });
  await chooseRoom(page, "远端节点");
  await expect(scene).toHaveAttribute("data-rooms", "1");
  await expect(scene).toHaveAttribute("data-entities", "1");
  await expect(page.locator(".space-context")).toContainText("逻辑空间");
  await page.getByRole("button", { name: "返回整个家庭" }).click();
  await openBrowse(page);
  await page.getByLabel("搜索物件").fill("Cloud node");
  await expect(page.locator(".scene-object-label:visible")).toHaveCount(1);
  await page.getByLabel("搜索物件").fill("");
  await page
    .getByRole("navigation", { name: "房间", exact: true })
    .getByRole("button", { name: /工作区/ })
    .click();
  await expect(scene).toHaveAttribute("data-rooms", "1");
  await expect(scene).toHaveAttribute("data-entities", "2");
  await expectSceneIdle(page, scene);
  const natural = await scene.locator("canvas").screenshot();
  await page.screenshot({
    path: info.outputPath("study-natural.png"),
    fullPage: true,
  });
  await openMenu(page);
  await page.getByRole("button", { name: "柔和色彩", exact: true }).click();
  await page.keyboard.press("Escape");
  await expectSceneIdle(page, scene);
  await expect(scene).toHaveAttribute("data-style", "soft");
  const soft = await scene.locator("canvas").screenshot();
  const a = await sharp(natural).removeAlpha().raw().toBuffer();
  const b = await sharp(soft).removeAlpha().raw().toBuffer();
  expect(a.length).toBe(b.length);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference += Math.abs(a[i] - b[i]);
  expect(difference / a.length).toBeGreaterThan(1);
  await page.screenshot({
    path: info.outputPath("study-soft.png"),
    fullPage: true,
  });
  await openMenu(page);
  await page.getByRole("button", { name: "参考家具", exact: true }).click();
  await expect(scene).toHaveAttribute("data-decorative-meshes", "0");
  const overviewZoom = Number(await scene.getAttribute("data-zoom"));
  await selectRecord(page, "Studio mini");
  await expectSceneIdle(page, scene);
  await page.getByRole("button", { name: "查看所选物件近景" }).click();
  await expect
    .poll(async () => Number(await scene.getAttribute("data-zoom")))
    .toBeGreaterThan(overviewZoom);
  // Close inspection retains a surrounding place, even for a palm-sized device.
  expect(
    20 / Number(await scene.getAttribute("data-zoom")),
  ).toBeGreaterThanOrEqual(1.8);
  for (const peer of before.home.entities.filter(
    (entity) => entity.locationId === "study" && entity.lifecycle === "active",
  ))
    await expect(scene).toHaveAttribute(
      "data-visible-objects",
      new RegExp(peer.id),
    );
  await expect(scene).toHaveAttribute("data-inspecting", "studio-mini");
  await expectSceneIdle(page, scene);
  await page.screenshot({
    path: info.outputPath("object-close.png"),
    fullPage: true,
  });
  await openMenu(page);
  await page.getByRole("button", { name: "俯视", exact: true }).click();
  expect(await snapshot(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test("missing model stays selectable with a visible fallback; small rooms omit illustrative furniture", async ({
  page,
}) => {
  await page.goto("/");
  const state = await snapshot(page);
  await command(page, {
    type: "asset.upsert",
    asset: {
      ...state.home.assets.find((a) => a.id === "mini")!,
      kind: "glb",
      url: "/models/missing.glb",
    },
  });
  await selectRecord(page, "Studio mini");
  await expect(page.locator(".scene-asset-warning")).toBeVisible();
  await expect(page.locator(".scene-asset-warning")).toContainText(
    "基础造型",
  );
  await page
    .locator(".scene-object-label")
    .filter({ hasText: "Studio mini" })
    .click();
  await expect(page.locator(".detail-title")).toContainText("Studio mini");
  await command(page, {
    type: "room.update",
    room: {
      ...state.home.rooms.find((r) => r.id === "living")!,
      size: [2.8, 2.8],
    },
  });
  await chooseRoom(page, "生活区");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-decorative-meshes",
    "0",
  );
  await expect(page.locator(".scene-asset-warning")).toBeHidden();
});

test("a home with only a logical group still renders its records", async ({
  page,
}) => {
  await page.goto("/");
  const { home } = await snapshot(page);
  home.rooms = home.rooms.filter((r) => r.kind === "remote");
  home.entities = home.entities.filter((e) => e.scope === "remote");
  home.stocks = [];
  home.services = [];
  await command(page, { type: "template.import", template: home });
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-rooms",
    "1",
  );
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-entities",
    "1",
  );
  await expect(page.locator(".scene-collections")).toHaveCount(0);
  await expect(page.locator(".space-context")).toContainText("云端与远程节点");
});
test.beforeEach(async ({ page }) => {
  const sessionToken = await loginAdmin(page);
  const current = await (await page.request.get("/api/state")).json();
  const templates = await (await page.request.get("/api/templates")).json();
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": sessionToken },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: current.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "template.import", template: templates[0] },
    },
  });
  expect(response.ok()).toBe(true);
});

test("home renders real WebGL, inventory persists, controls and idle rendering work", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-stock-instances", "3");
  await expect
    .poll(async () => Number(await scene.getAttribute("data-triangles")))
    .toBeGreaterThan(100);
  await openOverview(page);
  await page
    .getByRole("button", { name: "增加 猫砂库存区", exact: true })
    .click();
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await expect(scene).toHaveAttribute("data-stock-instances", "4");
  await page.reload();
  await openOverview(page);
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await openMenu(page);
  const zoom = Number(await scene.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "放大场景" }).click();
  await expect
    .poll(async () => Number(await scene.getAttribute("data-zoom")))
    .toBeGreaterThan(zoom);
  const camera = await scene.getAttribute("data-camera");
  const canvas = await scene.locator("canvas").boundingBox();
  await page.mouse.move(
    canvas!.x + canvas!.width / 2,
    canvas!.y + canvas!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas!.x + canvas!.width / 2 + 80,
    canvas!.y + canvas!.height / 2 + 20,
    { steps: 6 },
  );
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute("data-camera", camera!);
  await page.getByRole("button", { name: "重置家庭视角" }).click();
  await expectSceneIdle(page, scene);
  await page.screenshot({
    path: info.outputPath("home-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("lost command response can be confirmed after reload without adding inventory twice", async ({
  page,
}) => {
  await page.goto("/");
  await openOverview(page);
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("3");
  let intercepted = false;
  await page.route("**/api/commands", async (route) => {
    if (!intercepted) {
      intercepted = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await openOverview(page);
  await page
    .getByRole("button", { name: "增加 猫砂库存区", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "确认上次操作" }),
  ).toBeVisible();
  await page.reload();
  await openOverview(page);
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await page.getByRole("button", { name: "确认上次操作" }).click();
  await expect(page.getByRole("button", { name: "确认上次操作" })).toHaveCount(
    0,
  );
  expect((await snapshot(page)).home.stocks[0].quantity).toBe(4);
});
test("notes and placement survive reload, selected service is a single interactive iframe", async ({
  page,
}) => {
  await page.goto("/");
  await selectRecord(page, "Studio mini");
  await page
    .getByLabel("这个物件的故事 / 备注")
    .fill("这是一台放在书架上的工作站。");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("备注已保存");
  await page.getByRole("button", { name: "摆放", exact: true }).click();
  await page
    .getByRole("combobox", { name: "所在区域", exact: true })
    .selectOption("living");
  await page.getByLabel("左右 X").fill("0.3");
  await page.getByLabel("前后 Z").fill("0.6");
  await page.getByRole("button", { name: /保存位置|确认位置/ }).click();
  await expect
    .poll(async () => (await snapshot(page)).home.entities[0].locationId)
    .toBe("living");
  await page.reload();
  await selectRecord(page, "Studio mini");
  await expect(page.getByLabel("这个物件的故事 / 备注")).toHaveValue(
    "这是一台放在书架上的工作站。",
  );
  await page.getByRole("button", { name: "服务 1", exact: true }).click();
  expect(await page.locator("iframe").count()).toBe(0);
  await page.getByRole("button", { name: /服务页面示例/ }).click();
  await expect(page.locator("iframe")).toHaveCount(1);
  await page
    .frameLocator("iframe")
    .getByRole("button", { name: "测试页面交互" })
    .click();
  await expect(page.frameLocator("iframe").getByRole("button")).toHaveText(
    "页面交互成功 ✓",
  );
  await expect(page.getByRole("link", { name: "打开原页面" })).toHaveAttribute(
    "href",
    "/demo/service",
  );
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
});
test("explicit demo notification can be acknowledged, located, and recovered without claiming live monitoring", async ({
  page,
}) => {
  await page.goto("/");
  await openOverview(page);
  await page.getByText("体验演示通知", { exact: true }).click();
  await page.getByRole("button", { name: "演示告警", exact: true }).click();
  await expect(page.locator(".incident")).toContainText("演示事件");
  await page.getByRole("button", { name: "标记已知悉" }).click();
  await expect(page.locator(".incident")).toContainText("已知悉，待来源恢复");
  await page.locator(".incident-target").click();
  await expect(page.locator(".detail-title")).toContainText("Studio mini");
  await expect(page.locator(".badge-row")).toContainText("演示数据");
  await page.getByText("体验演示通知", { exact: true }).click();
  await page.getByRole("button", { name: "演示恢复", exact: true }).click();
  await expect
    .poll(async () => (await snapshot(page)).incidents[0].state)
    .toBe("resolved");
  await page.getByRole("button", { name: "取消选择" }).click();
  await expect(page.locator(".incident")).toHaveCount(0);
});
test("photo fixture workflow calibrates and repeats actual GLB geometry as stock instances", async ({
  page,
}, info) => {
  await page.goto("/");
  await openMenu(page);
  await page.getByRole("button", { name: /^录入物品/ }).click();
  await page.getByLabel("生成服务").selectOption("fixture");
  const png = await sharp({
    create: { width: 120, height: 100, channels: 3, background: "#cc9966" },
  })
    .png()
    .toBuffer();
  await page.getByLabel("物品照片").setInputFiles({
    name: "workflow-fixture.png",
    mimeType: "image/png",
    buffer: png,
  });
  await expect(page.getByAltText("已选择的物品照片")).toBeVisible();
  await page.getByRole("button", { name: "生成 3D 模型" }).click();
  await expect(page.locator(".asset-preview canvas")).toBeVisible();
  await expect(page.locator(".preview-badge")).toContainText("部件");
  await expect(page.locator(".preview-overlay")).toHaveCount(0);
  await page.getByLabel("物品名称", { exact: true }).fill("离线模型流程样品");
  await page.getByLabel("实际宽度").fill("24");
  await page
    .getByRole("combobox", { name: "用途", exact: true })
    .selectOption("cat-litter");
  await page.screenshot({
    path: info.outputPath("capture.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "加入家庭场景" }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-stock-glb-instances", "3");
  await openOverview(page);
  await page
    .getByRole("button", { name: "增加 猫砂库存区", exact: true })
    .click();
  await expect(scene).toHaveAttribute("data-stock-glb-instances", "4");
  const state = await snapshot(page);
  const asset = state.home.assets.find(
    (a) => a.id === state.home.stocks[0].assetId,
  )!;
  expect(asset.kind).toBe("glb");
  expect(asset.width).toBe(0.24);
  expect(asset.provenance).toContain("fixture");
  await page.reload();
  await expect(scene).toHaveAttribute("data-stock-glb-instances", "4");
});
test("second template and JSON round-trip are usable, invalid import retains current home", async ({
  page,
}) => {
  await page.goto("/");
  await openLayout(page);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出当前家庭" }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe("studio.json");
  const savedPath = await saved.path();
  await page.getByRole("button", { name: /一室一厅 · 第二套模板/ }).click();
  await expect(page.locator("h1")).toContainText("一室一厅 · 第二套模板");
  await openLayout(page);
  await page.getByLabel("导入家庭 JSON").setInputFiles({
    name: "bad.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"schemaVersion":9}'),
  });
  expect((await snapshot(page)).home.id).toBe("loft");
  await page.getByLabel("导入家庭 JSON").setInputFiles(savedPath!);
  await expect(page.locator("h1")).toContainText("小小工作室");
});
for (const width of [390, 768, 1024])
  test(`home remains usable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await expect(page.locator(".home-viewport")).toHaveAttribute(
      "data-entities",
      "4",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`overview-${width}.png`),
      fullPage: true,
    });
    await expect(
      page.locator(".space-panel, .scene-label-layer button:visible"),
    ).toHaveCount(0);
    expect(await page.locator(".home-viewport").boundingBox()).toEqual({
      x: 0,
      y: 0,
      width,
      height: 844,
    });
    await openOverview(page);
    await page
      .getByRole("button", { name: "增加 猫砂库存区", exact: true })
      .click();
    await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
    await selectRecord(page, "Studio mini");
    await expect(page.locator(".detail-title")).toContainText("Studio mini");
    await expectSceneIdle(page, page.locator(".home-viewport"));
    const canvas = (await page.locator(".home-viewport").boundingBox())!;
    const panel = (await page.locator(".space-panel").boundingBox())!;
    if (width <= 700)
      expect(canvas.y + canvas.height).toBeLessThanOrEqual(panel.y);
    else expect(canvas.x + canvas.width).toBeLessThanOrEqual(panel.x);
    const point = await objectPoint(page, "studio-mini");
    expect(point.x).toBeGreaterThan(canvas.x);
    expect(point.x).toBeLessThan(canvas.x + canvas.width);
    expect(point.y).toBeGreaterThan(canvas.y);
    expect(point.y).toBeLessThan(canvas.y + canvas.height);
    await page.screenshot({
      path: info.outputPath(`home-${width}.png`),
      fullPage: true,
    });
  });
test("WebGL failure retains inventory and list operations", async ({
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
  await page.goto("/");
  await expect(page.locator(".scene-error")).toContainText("WebGL");
  await openOverview(page);
  await page
    .getByRole("button", { name: "增加 猫砂库存区", exact: true })
    .click();
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await selectRecord(page, "Studio mini");
  await expect(page.locator(".detail-title")).toContainText("Studio mini");
});

test("HTTP without crypto.randomUUID still creates persisted operation and object IDs", async ({
  page,
}) => {
  // Non-loopback HTTP lacks this secure-context API; Web Crypto randomness remains available.
  await page.addInitScript(() =>
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: undefined,
    }),
  );
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await openOverview(page);
  await page
    .getByRole("button", { name: "增加 猫砂库存区", exact: true })
    .click();
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await openMenu(page);
  await page.getByRole("button", { name: "添加普通物件" }).click();
  await page.getByLabel("名称", { exact: true }).fill("HTTP-compatible object");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect
    .poll(async () =>
      (await snapshot(page)).home.entities.some(
        (entity) => entity.name === "HTTP-compatible object",
      ),
    )
    .toBe(true);
  expect(errors).toEqual([]);
});
