import { test, expect, type Page } from "@playwright/test";
import { OrthographicCamera, Vector3 } from "three";
import type { Dashboard } from "../../shared/domain.js";
import { loginAdmin } from "./auth.js";
async function state(page: Page): Promise<Dashboard> {
  return page.evaluate(async () => (await fetch("/api/state")).json());
}
async function edit(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("home-viewport")).toHaveAttribute(
    "data-frames",
    /[1-9]/,
  );
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "进入布局编辑模式" }).click();
  await expect(page.getByTestId("layout-editor")).toBeVisible();
}
async function number(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Tab");
}
async function addTable(page: Page) {
  if (!(await page.getByLabel("家具类型").isVisible()))
    await page.getByText("添加家具", { exact: true }).click();
  await page.getByLabel("家具类型").selectOption("table");
  await page.getByRole("button", { name: "添加到当前区域" }).click();
}
async function waitIdle(page: Page) {
  const scene = page.getByTestId("edit-viewport");
  await expect
    .poll(async () => {
      const before = await scene.getAttribute("data-frames");
      await page.waitForTimeout(600);
      return before === (await scene.getAttribute("data-frames"));
    })
    .toBe(true);
}
async function projection(page: Page) {
  const scene = page.getByTestId("edit-viewport");
  const rect = (await scene.boundingBox())!;
  const camera = new OrthographicCamera(
    -10,
    10,
    (10 * rect.height) / rect.width,
    (-10 * rect.height) / rect.width,
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
  // TransformControls orthographic helper scale is viewport height / zoom * size / 4.
  const handleLength =
    (((camera.top - camera.bottom) / camera.zoom) * 0.85) / 4;
  const project = (position: number[]) => {
    const point = new Vector3().fromArray(position).project(camera);
    return {
      x: rect.x + ((point.x + 1) * rect.width) / 2,
      y: rect.y + ((1 - point.y) * rect.height) / 2,
    };
  };
  const origin = (await state(page)).home.rooms.find(
    (r) => r.id === "study",
  )!.origin;
  return { scene, origin, handleLength, project };
}
test.beforeEach(async ({ page }) => {
  const csrf = await loginAdmin(page);
  const current = await (await page.request.get("/api/state")).json();
  const templates = await (await page.request.get("/api/templates")).json();
  const result = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: current.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "template.import", template: templates[0] },
    },
  });
  expect(result.ok()).toBe(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
});
test("layout draft adds independent furniture, changes dimensions, undoes, saves and survives reload", async ({
  page,
}, info) => {
  await edit(page);
  const before = await state(page);
  await addTable(page);
  await number(page, "位置 X（米）", "0.5");
  await number(page, "物件宽度（米）", "2");
  await page.getByRole("button", { name: "旋转 90 度", exact: true }).click();
  await expect(page.getByLabel("旋转角度（度）")).toHaveValue("90");
  await page.getByRole("button", { name: "撤销布局修改" }).click();
  await expect(page.getByLabel("旋转角度（度）")).toHaveValue("0");
  await page.getByRole("button", { name: "重做布局修改" }).click();
  expect(await state(page)).toEqual(before);
  await page.getByRole("button", { name: "切换 3D", exact: true }).click();
  await waitIdle(page);
  await page.screenshot({ path: info.outputPath("layout-desktop.png") });
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("布局已保存");
  const after = await state(page);
  const added = after.home.entities.find(
    (e) => !before.home.entities.some((old) => old.id === e.id),
  )!;
  expect(added.position[0]).toBe(0.5);
  expect(added.rotation).toBeCloseTo(Math.PI / 2);
  expect(after.home.assets.find((a) => a.id === added.assetId)?.width).toBe(2);
  expect(after.home.stocks).toEqual(before.home.stocks);
  expect(after.home.services).toEqual(before.home.services);
  await page.reload();
  await expect(page.getByRole("button", { name: "打开共在中枢" })).toBeVisible();
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "进入布局编辑模式" }).click();
  await page.getByLabel("选择物件").selectOption(`entity:${added.id}`);
  await expect(page.getByLabel("物件宽度（米）")).toHaveValue("2");
  await number(page, "位置 X（米）", "1");
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await expect(page.getByText("这轮调整尚未保存。")).toBeInViewport();
  await page.getByRole("button", { name: "放弃修改并退出" }).click();
  await expect(page.getByTestId("layout-editor")).toHaveCount(0);
  await expect(page.locator(".space-panel")).toHaveCount(0);
  expect(
    (await state(page)).home.entities.find((e) => e.id === added.id)
      ?.position[0],
  ).toBe(0.5);
});
test("detailed furniture remains independent, editable and persistent", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await edit(page);
  const before = await state(page);
  await page.getByText("添加家具", { exact: true }).click();
  await page.getByLabel("家具类型").selectOption("gaming-chair");
  await page.getByRole("button", { name: "添加到当前区域" }).click();
  await number(page, "位置 X（米）", "-0.6");
  await page.getByLabel("家具类型").selectOption("mini-fridge");
  await page.getByRole("button", { name: "添加到当前区域" }).click();
  await number(page, "位置 X（米）", "0.7");
  await number(page, "物件宽度（米）", "0.46");
  await page.getByRole("button", { name: "切换 3D", exact: true }).click();
  await waitIdle(page);
  expect(await state(page)).toEqual(before);
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("布局已保存");
  const saved = await state(page);
  const additions = saved.home.entities.filter(
    (entity) => !before.home.entities.some((old) => old.id === entity.id),
  );
  expect(additions).toHaveLength(2);
  const chair = additions.find(
    (entity) =>
      saved.home.assets.find((asset) => asset.id === entity.assetId)?.kind ===
      "gaming-chair",
  )!;
  const fridge = additions.find(
    (entity) =>
      saved.home.assets.find((asset) => asset.id === entity.assetId)?.kind ===
      "mini-fridge",
  )!;
  expect(chair.position[0]).toBe(-0.6);
  expect(fridge.position[0]).toBe(0.7);
  expect(fridge.assetId).not.toBe(chair.assetId);
  expect(
    saved.home.entities.filter((entity) => !additions.includes(entity)),
  ).toEqual(before.home.entities);
  await edit(page);
  await page.getByLabel("选择物件").selectOption(`entity:${fridge.id}`);
  await expect(page.getByLabel("物件宽度（米）")).toHaveValue("0.46");
  await page.getByRole("button", { name: "靠近所选", exact: true }).click();
  await waitIdle(page);
  expect(await state(page)).toEqual(saved);
  expect(errors).toEqual([]);
});
test("actual transform handle moves furniture without orbiting and commits only on save", async ({
  page,
}) => {
  await edit(page);
  await addTable(page);
  await waitIdle(page);
  const { scene, origin, handleLength, project } = await projection(page);
  const { x, y } = project([
    origin[0] + handleLength * 0.45,
    origin[1],
    origin[2],
  ]);
  const before = await state(page),
    cameraBefore = await scene.getAttribute("data-camera");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 70, y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () =>
      Number(await page.getByLabel("位置 X（米）").inputValue()),
    )
    .toBeGreaterThan(0.1);
  expect(await scene.getAttribute("data-camera")).toBe(cameraBefore);
  // Keep the heading beyond 90° after dragging: Euler.y alone would fold it back.
  await number(page, "旋转角度（度）", "180");
  await page.getByRole("button", { name: "旋转", exact: true }).click();
  await waitIdle(page);
  const movedX = Number(await page.getByLabel("位置 X（米）").inputValue());
  const start = project([
    origin[0] + movedX + handleLength * 0.5,
    origin[1],
    origin[2],
  ]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 12; step++) {
    const angle = (step * Math.PI) / 16;
    const point = project([
      origin[0] + movedX + Math.cos(angle) * handleLength * 0.5,
      origin[1],
      origin[2] + Math.sin(angle) * handleLength * 0.5,
    ]);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
  await expect
    .poll(async () => {
      const heading = Math.abs(
        Number(await page.getByLabel("旋转角度（度）").inputValue()),
      );
      return heading > 90 && heading < 179;
    })
    .toBe(true);
  expect(await scene.getAttribute("data-camera")).toBe(cameraBefore);
  expect(await state(page)).toEqual(before);
});
test("external revision and lost save keep drafts safe and recover without duplicate furniture", async ({
  page,
}) => {
  await edit(page);
  await addTable(page);
  const csrf = await loginAdmin(page);
  const before = await state(page);
  await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: before.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "stock.adjust", stockId: "cat-litter", delta: 1 },
    },
  });
  await expect(
    page.getByRole("button", { name: "保存布局", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("记录已有新变化，草稿仍保留。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("物件宽度（米）")).toHaveValue("1.8");
  await page.getByRole("button", { name: "放弃草稿并载入最新" }).click();
  await addTable(page);
  let once = false;
  await page.route("**/api/commands", async (route) => {
    if (!once) {
      once = true;
      await route.fetch();
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认保存结果" }),
  ).toBeVisible();
  const saved = await state(page);
  await page.reload();
  await page.getByRole("button", { name: "确认上次操作" }).click();
  await expect(page.getByRole("button", { name: "确认上次操作" })).toHaveCount(
    0,
  );
  expect((await state(page)).revision).toBe(saved.revision);
  expect((await state(page)).home.entities.length).toBe(
    saved.home.entities.length,
  );
});
for (const width of [390, 768])
  test(`layout editing remains reachable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await edit(page);
    await addTable(page);
    await number(page, "位置 Z（米）", "0.4");
    await page.getByRole("button", { name: "旋转 90 度", exact: true }).click();
    await waitIdle(page);
    await page.screenshot({ path: info.outputPath(`layout-${width}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const viewport = (await page.getByTestId("edit-viewport").boundingBox())!,
      panel = (await page.locator(".editor-panel").boundingBox())!;
    if (width < 700)
      expect(viewport.y + viewport.height).toBeLessThanOrEqual(panel.y);
    else expect(viewport.x + viewport.width).toBeLessThanOrEqual(panel.x);
    await page.getByRole("button", { name: "保存布局", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("布局已保存");
  });

test("touch drags a furniture handle and returns to the quiet view", async ({
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
  try {
    await loginAdmin(page);
    await page.goto("/");
    await expect(page.getByTestId("home-viewport")).toHaveAttribute(
      "data-frames",
      /[1-9]/,
    );
    await page.touchscreen.tap(20, 20);
    await page.getByRole("button", { name: "进入布局编辑模式" }).tap();
    await addTable(page);
    await waitIdle(page);
    const before = await state(page);
    const { scene, origin, handleLength, project } = await projection(page);
    const cameraBefore = await scene.getAttribute("data-camera");
    const point = project([
      origin[0] + handleLength * 0.45,
      origin[1],
      origin[2],
    ]);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ ...point, id: 1 }],
    });
    for (let step = 1; step <= 6; step++)
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: point.x + step * 6, y: point.y, id: 1 }],
      });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect
      .poll(async () =>
        Number(await page.getByLabel("位置 X（米）").inputValue()),
      )
      .toBeGreaterThan(0.1);
    expect(await scene.getAttribute("data-camera")).toBe(cameraBefore);
    expect(await state(page)).toEqual(before);
    await page.getByRole("button", { name: "退出编辑", exact: true }).tap();
    await page.getByRole("button", { name: "放弃修改并退出" }).tap();
    await expect(page.getByTestId("layout-editor")).toHaveCount(0);
    await expect(page.locator(".space-panel")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("stepped footprint and hidden structural markers survive editing and reload", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  const before = await state(page);
  const rooms = structuredClone(before.home.rooms);
  const room = rooms.find((r) => r.id === "study")!;
  const [w, d] = room.size;
  room.footprint = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2 - 0.5],
    [w / 2 - 0.2, d / 2 - 0.5],
    [w / 2 - 0.2, d / 2],
    [-w / 2, d / 2],
  ];
  const csrf = await loginAdmin(page);
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: before.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "layout.commit", rooms, placements: [], additions: [] },
    },
  });
  expect(response.ok()).toBe(true);
  await edit(page);
  await page.getByText("边界转角（米）", { exact: true }).click();
  await number(page, "转角 4 X", String(w / 2 - 0.3));
  await page.getByText("区域尺寸（估算，可调整）", { exact: true }).click();
  await number(page, "区域宽度（米）", String(w * 1.1));
  await expect(page.getByLabel("转角 4 X", { exact: true })).toHaveValue(
    String(Number(((w / 2 - 0.3) * 1.1).toFixed(3))),
  );
  await page.getByText("添加家具", { exact: true }).click();
  const kinds = [
    "window-marker",
    "door-marker",
    "wall-return",
    "round-storage-table",
    "armchair",
    "wall-display",
    "pegboard",
    "privacy-screen",
  ];
  for (const [i, kind] of kinds.entries()) {
    await page.getByLabel("家具类型").selectOption(kind);
    await page.getByRole("button", { name: "添加到当前区域" }).click();
    await number(page, "位置 X（米）", String(-1.5 + (i % 4)));
    await number(page, "位置 Z（米）", String(i < 4 ? -0.7 : 0.7));
    if (kind === "wall-display") await number(page, "离地高度（米）", "1");
  }
  await page.getByRole("button", { name: "切换 3D", exact: true }).click();
  await waitIdle(page);
  await page.screenshot({ path: info.outputPath("structural-editor.png") });
  await page.getByRole("button", { name: "保存布局", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("布局已保存");
  const saved = await state(page);
  const added = saved.home.entities.filter(
    (e) => !before.home.entities.some((old) => old.id === e.id),
  );
  expect(added).toHaveLength(8);
  expect(added.filter((e) => e.visibility === "editing")).toHaveLength(3);
  expect(
    saved.home.rooms.find((r) => r.id === "study")!.footprint![3][0],
  ).toBeCloseTo((w / 2 - 0.3) * 1.1);
  await page.getByRole("button", { name: "退出编辑", exact: true }).click();
  await page.reload();
  const visible = saved.home.entities.filter(
    (e) =>
      e.lifecycle === "active" &&
      e.visibility !== "editing" &&
      saved.home.rooms.find((r) => r.id === e.locationId)?.kind === "room",
  ).length;
  await expect(page.getByTestId("home-viewport")).toHaveAttribute(
    "data-entities",
    String(visible),
  );
  await expect(page.locator(".space-panel,header,aside")).toHaveCount(0);
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "进入布局编辑模式" }).click();
  await expect(page.getByTestId("edit-viewport")).toHaveAttribute(
    "data-entities",
    String(
      saved.home.entities.filter(
        (e) => e.lifecycle === "active" && e.locationId === "study",
      ).length,
    ),
  );
  const window = added.find((e) => e.visibility === "editing")!;
  await page.getByLabel("选择物件").selectOption(`entity:${window.id}`);
  await expect(page.getByLabel("物件高度（米）")).toHaveValue("1.5");
  expect(await state(page)).toEqual(saved);
  expect(errors).toEqual([]);
});

test("clearing a room dimension retains the polygon before a valid replacement", async ({
  page,
}) => {
  await page.goto("/");
  const before = await state(page),
    rooms = structuredClone(before.home.rooms),
    room = rooms.find((r) => r.id === "study")!;
  const [w, d] = room.size;
  room.footprint = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  const csrf = await loginAdmin(page);
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: before.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "layout.commit", rooms, placements: [], additions: [] },
    },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("button", { name: "打开共在中枢" })).toBeVisible();
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "编辑户型与模板" }).click();
  const modal = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "空间与模板", exact: true }),
  });
  await modal
    .getByRole("combobox", { name: "区域", exact: true })
    .selectOption("study");
  await modal.getByLabel("宽（米）", { exact: true }).fill("");
  await expect(modal.getByLabel("宽（米）", { exact: true })).toHaveValue(
    String(w),
  );
  await modal.getByLabel("宽（米）", { exact: true }).fill(String(w * 1.2));
  await modal.getByRole("button", { name: "保存区域", exact: true }).click();
  await expect
    .poll(async () => (await state(page)).revision)
    .toBe(before.revision + 2);
  const saved = await state(page),
    updated = saved.home.rooms.find((r) => r.id === "study")!;
  expect(updated.footprint![1][0]).toBeCloseTo(w * 0.6);
  expect(updated.footprint![1][1]).toBe(-d / 2);
  expect(saved.home.entities).toEqual(before.home.entities);
  expect(saved.home.services).toEqual(before.home.services);
});
