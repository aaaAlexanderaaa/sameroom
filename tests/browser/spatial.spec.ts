import { test, expect, type Page } from "@playwright/test";
import { OrthographicCamera, Vector3 } from "three";
import type { Action, Dashboard } from "../../shared/domain.js";
import { loginAdmin } from "./auth.js";

async function state(page: Page): Promise<Dashboard> {
  return page.evaluate(async () => (await fetch("/api/state")).json());
}
async function command(page: Page, action: Action) {
  const csrf = await loginAdmin(page);
  const current = await (await page.request.get("/api/state")).json();
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: current.revision,
      issuedAt: new Date().toISOString(),
      action,
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function setup(page: Page) {
  await loginAdmin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-frames",
    /\d+/,
  );
  const templates = await (await page.request.get("/api/templates")).json();
  await command(page, {
    type: "template.import",
    template: templates.find((h: { id: string }) => h.id === "workshop"),
  });
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-pickable",
    /workbench/,
  );
}
async function menu(page: Page) {
  await page.locator(".home-viewport[data-frames]").waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect(
    page.getByRole("dialog", { name: "共在中枢", exact: true }),
  ).toBeVisible();
}
async function mode(page: Page, name: string) {
  await menu(page);
  await page
    .getByRole("group", { name: "管理任务" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function select(page: Page, name: string) {
  await page.locator(".home-viewport[data-frames]").waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("/");
  await page.locator(".object-item").filter({ hasText: name }).click();
  await expect(page.locator(".detail-title")).toContainText(name);
}
async function point(page: Page, id: string, local?: [number, number, number]) {
  const s = await state(page),
    e = s.home.entities.find((x) => x.id === id)!,
    r = s.home.rooms.find((x) => x.id === e.locationId)!,
    a = s.home.assets.find((x) => x.id === e.assetId)!;
  const host = page.locator(".home-viewport"),
    b = (await host.boundingBox())!,
    c = new OrthographicCamera(
      -10,
      10,
      (10 * b.height) / b.width,
      (-10 * b.height) / b.width,
      0.1,
      250,
    );
  c.position.fromArray(
    (await host.getAttribute("data-camera"))!.split(",").map(Number),
  );
  c.zoom = Number(await host.getAttribute("data-zoom"));
  c.lookAt(
    new Vector3().fromArray(
      (await host.getAttribute("data-target"))!.split(",").map(Number),
    ),
  );
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  const p = new Vector3()
    .fromArray(r.origin)
    .add(new Vector3().fromArray(e.position))
    .add(
      local
        ? new Vector3(...local).applyAxisAngle(new Vector3(0, 1, 0), e.rotation)
        : new Vector3(0, a.height, 0),
    )
    .project(c);
  return {
    x: b.x + ((p.x + 1) * b.width) / 2,
    y: b.y + ((1 - p.y) * b.height) / 2,
  };
}

test("task eligibility, contextual focus, explicit front view and return preserve the chosen task", async ({
  page,
}) => {
  await setup(page);
  await command(page, {
    type: "entity.place",
    entityId: "studio-mini",
    locationId: "study",
    position: [-0.8, 0, 0],
    rotation: Math.PI / 2,
  });
  await mode(page, "设备管理");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-task", "devices");
  await expect(scene).toHaveAttribute("data-pickable", /studio-mini/);
  await expect(scene).not.toHaveAttribute("data-pickable", /workbench/);
  await page.keyboard.press("Escape");
  const before = await state(page);
  const p = await point(page, "workbench");
  await page.mouse.click(p.x, p.y);
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await select(page, "Studio mini");
  await expect(scene).toHaveAttribute("data-inspecting", "studio-mini");
  await expect(scene).toHaveAttribute("data-inspection-items", /workbench/);
  await page.getByRole("button", { name: "查看所选物件近景" }).click();
  await expect
    .poll(async () => {
      const c = (await scene.getAttribute("data-camera"))!
          .split(",")
          .map(Number),
        t = (await scene.getAttribute("data-target"))!.split(",").map(Number);
      return (
        Math.abs(c[1] - t[1]) < 0.02 &&
        Math.abs(c[2] - t[2]) < 0.02 &&
        c[0] > t[0] + 4
      );
    })
    .toBe(true);
  await expect(page.locator(".service-list")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(scene).toHaveAttribute("data-task", "devices");
  await select(page, "Cloud node");
  await expect(scene).toHaveAttribute("data-rooms", "1");
  await page.keyboard.press("Escape");
  await expect(scene).toHaveAttribute("data-rooms", "3");
  await mode(page, "库存管理");
  await expect(scene).toHaveAttribute("data-pickable", /wardrobe/);
  await expect(scene).not.toHaveAttribute("data-pickable", /studio-mini/);
  expect(await state(page)).toEqual(before);
});

test("storage grid persists quantities, moves by touch-compatible clicks and returns through parent focus", async ({
  page,
}, info) => {
  await setup(page);
  await mode(page, "库存管理");
  await page
    .getByRole("button", { name: "收纳柜 工作区", exact: true })
    .click();
  await expect(page.getByLabel("收纳格位")).toBeVisible();
  await page.getByLabel("选择收纳物品").selectOption("cat-litter");
  await page.getByRole("button", { name: "格位 2 空闲", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "格位 2 猫砂库存区", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "格位 2 猫砂库存区", exact: true })
    .click();
  await page.getByRole("button", { name: "增加一袋", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "格位 2 猫砂库存区", exact: true }),
  ).toContainText("×4");
  await page.getByRole("button", { name: "格位 4 空闲", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "格位 4 猫砂库存区", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("storage-desktop.png") });
  await page
    .getByRole("button", { name: "格位 4 猫砂库存区", exact: true })
    .click();
  await page.getByRole("button", { name: "查看物品", exact: true }).click();
  await expect(page.getByTestId("quantity-cat-litter")).toHaveText("4");
  await page.getByRole("button", { name: "返回上一层", exact: true }).click();
  await expect(page.getByLabel("收纳格位")).toBeVisible();
  await page.reload();
  await mode(page, "库存管理");
  await page
    .getByRole("button", { name: "收纳柜 工作区", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "格位 4 猫砂库存区", exact: true }),
  ).toContainText("×4");
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByLabel("收纳格位")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`storage-${width}.png`) });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    const canvas = (await page.locator(".home-viewport").boundingBox())!,
      panel = (await page.locator(".detail-panel").boundingBox())!;
    expect(
      width <= 700
        ? canvas.y + canvas.height <= panel.y + 1
        : canvas.x + canvas.width <= panel.x + 1,
    ).toBe(true);
  }
});

test("surface placement avoids occupants and follows a moved support after reload", async ({
  page,
}, info) => {
  await setup(page);
  await mode(page, "设备管理");
  await select(page, "Studio mini");
  await page.getByRole("button", { name: "摆放", exact: true }).click();
  await page.getByLabel("目标台面").selectOption("workbench");
  await page.getByRole("button", { name: "确认摆放", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state(page)).home.entities.find((e) => e.id === "studio-mini")
          ?.attachment?.parentId,
    )
    .toBe("workbench");
  const first = (await state(page)).home.entities.find(
    (e) => e.id === "studio-mini",
  )!;
  await select(page, "桌面插座");
  await page.getByRole("button", { name: "摆放", exact: true }).click();
  await page.getByLabel("目标台面").selectOption("workbench");
  await page.screenshot({ path: info.outputPath("surface-preview.png") });
  await page.getByRole("button", { name: "确认摆放", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await state(page)).home.entities.find((e) => e.id === "desk-plug")
          ?.attachment?.parentId,
    )
    .toBe("workbench");
  const second = (await state(page)).home.entities.find(
    (e) => e.id === "desk-plug",
  )!;
  expect(second.position).not.toEqual(first.position);
  await command(page, {
    type: "entity.place",
    entityId: "workbench",
    locationId: "study",
    position: [0, 0, 0],
    rotation: Math.PI / 2,
  });
  await page.reload();
  const saved = await state(page);
  expect(
    saved.home.entities.find((e) => e.id === "studio-mini")?.attachment
      ?.parentId,
  ).toBe("workbench");
  expect(
    saved.home.entities.find((e) => e.id === "studio-mini")?.rotation,
  ).toBeCloseTo(Math.PI / 2);
});

test("local GLB import shares calibration and association without duplicating the existing device", async ({
  page,
}, info) => {
  await setup(page);
  await mode(page, "设备管理");
  const before = await state(page);
  await menu(page);
  await page.getByRole("button", { name: "录入物品", exact: false }).click();
  await page.getByRole("button", { name: "本地导入", exact: true }).click();
  await page
    .getByLabel("导入 GLB 模型")
    .setInputFiles("public/models/offline-robot.glb");
  await expect(page.locator(".asset-preview")).toHaveAttribute(
    "data-meshes",
    /\d+/,
  );
  await page
    .getByRole("combobox", { name: /^用途/ })
    .selectOption("existing:studio-mini");
  await page.getByRole("combobox", { name: /^模型转向/ }).selectOption("90");
  await page.getByRole("combobox", { name: /^正面方向/ }).selectOption("180");
  await page.screenshot({ path: info.outputPath("model-import.png") });
  await page.getByRole("button", { name: "加入家庭场景", exact: true }).click();
  await expect(page.locator("dialog")).toHaveCount(0);
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-task",
    "devices",
  );
  const after = await state(page),
    entity = after.home.entities.find((e) => e.id === "studio-mini")!,
    asset = after.home.assets.find((a) => a.id === entity.assetId)!;
  expect(after.home.entities.length).toBe(before.home.entities.length);
  expect(after.home.services).toEqual(before.home.services);
  expect(entity.position).toEqual(before.home.entities[0].position);
  expect(asset.detailUrl).toMatch(/^\/generated\/import-/);
  expect(asset.modelRotation).toBeCloseTo(Math.PI / 2);
  await select(page, "Studio mini");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspecting",
    "studio-mini",
  );
  await expect(page.locator(".home-viewport")).not.toHaveAttribute(
    "data-asset-warning",
  );
});

test("market discovery returns to GLB import and preserves attribution through cancellation and device replacement", async ({
  page,
  context,
}, info) => {
  test.setTimeout(150_000);
  await setup(page);
  await command(page, {
    type: "entity.note",
    entityId: "studio-mini",
    notes: "A device with a story.",
  });
  const before = await state(page);
  let uploads = 0,
    paidCreates = 0;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (new URL(request.url()).pathname === "/api/assets/import") uploads++;
    if (new URL(request.url()).pathname === "/api/generations") paidCreates++;
  });
  await menu(page);
  await page.getByRole("button", { name: /^录入物品/ }).click();
  await expect(
    page.getByRole("button", { name: "拍照生成", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "寻找现成模型", exact: true }).click();
  const query = "Mac mini M4 & 小主机";
  await page.getByLabel("搜索模型关键词").fill(query);
  const searchLink = page.getByRole("link", { name: /去 Sketchfab 搜索/ });
  const href = new URL((await searchLink.getAttribute("href"))!);
  expect(href.searchParams.get("q")).toBe(query);
  expect(href.searchParams.get("features")).toBe("downloadable");
  expect(
    new URL(
      (await page
        .getByRole("link", { name: /去 Poly Haven 搜索/ })
        .getAttribute("href"))!,
    ).searchParams.get("s"),
  ).toBe(query);
  // Verify new-tab return behavior offline; this does not assert live marketplace results.
  await context.route("https://sketchfab.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Offline marketplace navigation fixture</title>",
    }),
  );
  const popup = page.waitForEvent("popup");
  await searchLink.click();
  const market = await popup;
  await market.waitForLoadState();
  expect(market.url()).toBe(href.href);
  expect(await market.evaluate(() => window.opener === null)).toBe(true);
  await market.close();
  await expect(page.getByLabel("搜索模型关键词")).toHaveValue(query);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page
      .getByRole("group", { name: "物品来源", exact: true })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".capture-modal")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`model-market-${width}.png`),
    });
  }
  await page.getByLabel("导入 GLB 模型").setInputFiles({
    name: "unsupported.obj",
    mimeType: "text/plain",
    buffer: Buffer.from("synthetic"),
  });
  await expect(page.getByRole("alert")).toContainText("其他格式请先转换");
  await page.getByLabel("模型原始链接").fill("javascript:alert(1)");
  await page
    .getByLabel("导入 GLB 模型")
    .setInputFiles("public/models/offline-robot.glb");
  await expect(page.getByRole("alert")).toContainText("请检查模型出处");
  expect(uploads).toBe(0);
  await page.getByLabel("来源平台").fill("Offline fixture catalog");
  await page
    .getByLabel("模型原始链接")
    .fill("https://example.org/models/robot");
  await page.getByLabel("模型作者").fill("Fixture author");
  await page.getByLabel("模型许可").fill("Synthetic test metadata");
  await page
    .getByLabel("导入 GLB 模型")
    .setInputFiles("public/models/offline-robot.glb");
  await expect(page.locator(".asset-preview")).toHaveAttribute(
    "data-meshes",
    /\d+/,
  );
  await expect(page.locator(".model-attribution")).toContainText(
    "Fixture author",
  );
  // Re-selecting the same file URL must still enter inspection after returning.
  await page.getByRole("button", { name: "返回物品来源", exact: true }).click();
  await page.locator(".job").filter({ hasText: "Fixture author" }).click();
  await expect(page.locator(".asset-preview")).toHaveAttribute(
    "data-meshes",
    /\d+/,
  );
  await page.keyboard.press("Escape");
  expect(await state(page)).toEqual(before);
  await page.reload();
  await menu(page);
  await page.getByRole("button", { name: /^录入物品/ }).click();
  await page.getByRole("button", { name: "本地导入", exact: true }).click();
  await page.locator(".job").filter({ hasText: "Fixture author" }).click();
  await expect(page.locator(".asset-preview")).toHaveAttribute(
    "data-meshes",
    /\d+/,
  );
  await expect(page.locator(".model-attribution")).toContainText(
    "Synthetic test metadata",
  );
  await page
    .getByRole("combobox", { name: /^用途/ })
    .selectOption("existing:studio-mini");
  await page.getByRole("button", { name: "加入家庭场景", exact: true }).click();
  await expect(page.locator(".capture-modal")).toHaveCount(0);
  await page.reload();
  await select(page, "Studio mini");
  await page.getByText("外观与视角", { exact: true }).click();
  await expect(page.locator(".model-tools .model-attribution")).toContainText(
    "Fixture author",
  );
  await expect(
    page.getByRole("link", { name: "查看模型原始页面" }),
  ).toHaveAttribute("href", "https://example.org/models/robot");
  const saved = await state(page);
  const entity = saved.home.entities.find((e) => e.id === "studio-mini")!;
  expect(entity).toEqual({
    ...before.home.entities.find((e) => e.id === entity.id),
    assetId: entity.assetId,
  });
  expect(saved.home.entities.length).toBe(before.home.entities.length);
  expect(saved.home.services).toEqual(before.home.services);
  const asset = saved.home.assets.find((a) => a.id === entity.assetId)!;
  expect(asset.source?.license).toBe("Synthetic test metadata");
  const exported = await (await page.request.get("/api/export")).json();
  expect(
    exported.assets.find((a: { id: string }) => a.id === asset.id).source,
  ).toEqual(asset.source);
  expect(uploads).toBe(1);
  expect(paidCreates).toBe(0);
  expect(errors).toEqual([]);
});

test("mounted equipment remains visible at support focus and follows it without losing elevation", async ({
  page,
}) => {
  await setup(page);
  await select(page, "Studio mini");
  await page.getByRole("button", { name: "摆放", exact: true }).click();
  await page.getByText("固定在支架或家具上", { exact: true }).click();
  await page
    .getByRole("combobox", { name: /^安装到/ })
    .selectOption("workbench");
  await page
    .getByRole("button", { name: "保持当前位置并连接", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await state(page)).home.entities.find((e) => e.id === "studio-mini")
          ?.attachment?.kind,
    )
    .toBe("mount");
  const before = (await state(page)).home.entities.find(
    (e) => e.id === "studio-mini",
  )!;
  await page.getByRole("button", { name: /返回.*工作台.*整体视图/ }).click();
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspection-items",
    /studio-mini/,
  );
  await expect(page.locator(".home-viewport")).not.toHaveAttribute(
    "data-occluders",
    /studio-mini/,
  );
  await command(page, {
    type: "entity.place",
    entityId: "workbench",
    locationId: "study",
    position: [0, 0.2, 0.6],
    rotation: Math.PI / 2,
  });
  const after = (await state(page)).home.entities.find(
    (e) => e.id === "studio-mini",
  )!;
  expect(after.position[1]).toBeCloseTo(before.position[1] + 0.2);
  expect(after.attachment?.parentId).toBe("workbench");
});

test("small-item selection preserves its support, nearby furniture and the current orbit; pad is not a device target", async ({
  page,
}) => {
  await setup(page);
  const current = await state(page),
    base = current.home.entities.find((e) => e.id === "studio-mini")!;
  await command(page, {
    type: "layout.commit",
    additions: [
      {
        entity: {
          ...base,
          id: "test-mouse",
          name: "桌面鼠标",
          category: "device",
          assetId: "test-mouse-model",
          position: [0, 0.75, 0.85],
          attachment: { parentId: "workbench", kind: "mount" },
        },
        asset: {
          id: "test-mouse-model",
          name: "Mouse",
          kind: "mouse",
          width: 0.22,
          height: 0.04,
          depth: 0.22,
          color: "#333333",
          provenance: "Synthetic browser test",
        },
      },
    ],
    placements: [],
  });
  await mode(page, "设备管理");
  await select(page, "桌面鼠标");
  const scene = page.locator(".home-viewport");
  await expect(scene).toHaveAttribute("data-focus-anchor", "workbench");
  await expect(scene).toHaveAttribute("data-inspection-items", /wardrobe/);
  const initialCamera = await scene.getAttribute("data-camera"),
    viewport = (await scene.boundingBox())!;
  await page.mouse.move(
    viewport.x + viewport.width * 0.75,
    viewport.y + viewport.height * 0.75,
  );
  await page.mouse.down();
  await page.mouse.move(
    viewport.x + viewport.width * 0.75 + 45,
    viewport.y + viewport.height * 0.75,
    { steps: 5 },
  );
  await page.mouse.up();
  await expect(scene).not.toHaveAttribute("data-camera", initialCamera!);
  const beforeCamera = await scene.getAttribute("data-camera"),
    beforeZoom = await scene.getAttribute("data-zoom");
  await page.getByRole("button", { name: /返回.*工作台.*整体视图/ }).click();
  await expect(scene).toHaveAttribute("data-camera", beforeCamera!);
  await expect(scene).toHaveAttribute("data-zoom", beforeZoom!);
  const pad = await point(page, "test-mouse", [0.095, 0.002, 0]);
  await page.mouse.click(pad.x, pad.y);
  await expect(scene).toHaveAttribute("data-inspecting", "workbench");
  await page.getByRole("button", { name: "返回上一层", exact: true }).click();
  await expect(scene).toHaveAttribute("data-inspecting", "test-mouse");
  await expect(scene).toHaveAttribute("data-camera", beforeCamera!);
});

test("personal object arrival previews the current home, cancels cleanly and preserves its story on revisit", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let paidCreates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/generations"
    )
      paidCreates++;
  });
  const before = await state(page);
  const openImport = async () => {
    await menu(page);
    await page.getByRole("button", { name: /^录入物品/ }).click();
    await page.getByRole("button", { name: "本地导入", exact: true }).click();
    await page
      .getByLabel("导入 GLB 模型")
      .setInputFiles("public/models/offline-robot.glb");
    await expect(page.locator(".asset-preview")).toHaveAttribute(
      "data-meshes",
      /\d+/,
    );
    await page.getByLabel("物品名称", { exact: true }).fill("我的纪念机器人");
    await page.getByLabel("实际宽度").fill("12");
    await page
      .getByRole("button", { name: "给它找个位置", exact: true })
      .click();
    await page.getByLabel("摆放到台面").selectOption("workbench");
    await expect(page.locator(".capture-viewport")).toHaveAttribute(
      "data-inspection-items",
      /workbench/,
    );
  };
  await openImport();
  expect(await state(page)).toEqual(before);
  await page
    .getByRole("button", { name: "暂时不放，稍后继续", exact: true })
    .click();
  expect(await state(page)).toEqual(before);
  await openImport();
  // A genuinely oversized candidate must be blocked without moving existing objects.
  await page.getByRole("button", { name: "返回检查外观", exact: true }).click();
  await page.getByLabel("实际宽度").fill("900");
  await page.getByRole("button", { name: "给它找个位置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认位置，加入小世界", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".capture-placement")).toContainText(
    "超出台面边界",
  );
  expect(await state(page)).toEqual(before);
  await page.getByRole("button", { name: "返回检查外观", exact: true }).click();
  await page.getByLabel("实际宽度").fill("12");
  await page.getByRole("button", { name: "给它找个位置", exact: true }).click();
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.locator(".capture-viewport").scrollIntoViewIfNeeded();
    await expect(page.locator(".capture-viewport")).toHaveAttribute(
      "data-inspection-items",
      /workbench/,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const dialog = page.locator(".capture-modal");
    expect(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`arrival-preview-${width}.png`),
    });
  }
  const previewId = await page
    .locator(".capture-viewport")
    .getAttribute("data-inspecting");
  await page
    .getByRole("button", { name: "确认位置，加入小世界", exact: true })
    .click();
  await expect(page.locator(".capture-modal")).toHaveCount(0);
  await expect(page.locator(".detail-title")).toContainText("我的纪念机器人");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspecting",
    previewId!,
  );
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspection-items",
    /workbench/,
  );
  await page
    .getByLabel("这个物件的故事 / 备注")
    .fill("朋友送的小机器人，搬家后仍陪着我。");
  await page
    .getByRole("button", { name: "保存故事，回到小世界", exact: true })
    .click();
  await expect(page.locator(".space-panel")).toHaveCount(0);
  const saved = await state(page),
    item = saved.home.entities.find((e) => e.id === previewId)!;
  expect(item.notes).toContain("搬家后仍陪着我");
  expect(item.attachment).toEqual({ kind: "surface", parentId: "workbench" });
  expect(saved.home.entities.length).toBe(before.home.entities.length + 1);
  expect(saved.home.entities.filter((e) => e.id !== item.id)).toEqual(
    before.home.entities,
  );
  await page.reload();
  await select(page, "我的纪念机器人");
  await expect(page.locator(".object-story")).toHaveText(item.notes);
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspection-items",
    /workbench/,
  );
  await page.screenshot({ path: info.outputPath("arrival-story-mobile.png") });
  await page.getByRole("button", { name: "编辑故事", exact: true }).click();
  await page.getByLabel("这个物件的故事 / 备注").fill("更新后的纪念。");
  await page.getByRole("button", { name: "保存备注", exact: true }).click();
  await expect(page.locator(".object-story")).toHaveText("更新后的纪念。");
  expect(errors).toEqual([]);
  expect(paidCreates).toBe(0);
});

test("lost capture response recovers the original operation after reload and skipping the story preserves placement", async ({
  page,
}) => {
  await setup(page);
  const before = await state(page);
  const operationIds: string[] = [];
  let releaseResponse!: () => void;
  const heldResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  await page.route("**/api/commands", async (route) => {
    const input = route.request().postDataJSON();
    if (input.action.type !== "object.capture") return route.continue();
    operationIds.push(input.operationId);
    if (operationIds.length === 1) {
      await route.fetch();
      await heldResponse;
      await route.abort("failed");
    } else await route.continue();
  });
  await menu(page);
  await page.getByRole("button", { name: /^录入物品/ }).click();
  await page.getByRole("button", { name: "本地导入", exact: true }).click();
  await page
    .getByLabel("导入 GLB 模型")
    .setInputFiles("public/models/offline-robot.glb");
  await expect(page.locator(".asset-preview")).toHaveAttribute(
    "data-meshes",
    /\d+/,
  );
  await page.getByLabel("物品名称", { exact: true }).fill("响应恢复物品");
  await page.getByLabel("实际宽度").fill("12");
  await page.getByRole("button", { name: "给它找个位置", exact: true }).click();
  await page.getByLabel("摆放到台面").selectOption("workbench");
  await page
    .getByRole("button", { name: "确认位置，加入小世界", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".capture-modal")).toBeVisible();
  releaseResponse();
  await expect(
    page.getByRole("button", { name: "确认这次录入结果", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "确认上次操作", exact: true }).click();
  await expect(page.locator(".detail-title")).toContainText("响应恢复物品");
  await page
    .getByRole("button", { name: "以后再写，回到小世界", exact: true })
    .click();
  await expect(page.locator(".space-panel")).toHaveCount(0);
  expect(operationIds).toHaveLength(2);
  expect(new Set(operationIds).size).toBe(1);
  const saved = await state(page);
  expect(saved.home.entities.length).toBe(before.home.entities.length + 1);
  const item = saved.home.entities.find((e) => e.name === "响应恢复物品")!;
  expect(item.notes).toBe("");
  expect(item.attachment?.parentId).toBe("workbench");
  await select(page, item.name);
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-inspecting",
    item.id,
  );
});
