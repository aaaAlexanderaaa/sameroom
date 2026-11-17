import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { OrthographicCamera, Vector3 } from "three";
import { worldExample } from "../../shared/world-example.js";
import { loginAdmin } from "./auth.js";

async function state(page: Page) {
  return (await page.request.get("/api/state")).json();
}
async function setup(page: Page) {
  const csrf = await loginAdmin(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-frames",
    /\d+/,
  );
  const s = await state(page);
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: s.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "template.import", template: worldExample() },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-entities",
    /\d+/,
  );
}
async function menu(page: Page) {
  await page.keyboard.press("Escape");
  await page.keyboard.press("m");
  await expect(
    page.getByRole("dialog", { name: "共在中枢", exact: true }),
  ).toBeVisible();
}
async function world(page: Page, name: string) {
  await menu(page);
  await page.getByRole("button", { name: new RegExp("^" + name) }).click();
}

test("text and multiple photos create reusable inventory without generation, with persistence and cabinet placement", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await setup(page);
  let generations = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/generations"))
      generations++;
  });
  await menu(page);
  await page.getByRole("button", { name: /^记一件物品/ }).click();
  const dialog = page.getByRole("dialog", { name: "记下一件物品" });
  await dialog.getByLabel("物品名称", { exact: true }).fill("我记录的洗衣凝珠");
  await dialog.getByLabel("放在哪里").selectOption("wardrobe");
  await dialog.getByLabel("隔间 / 抽屉").selectOption("upper");
  await dialog.getByLabel("这是需要记录数量的消耗品 / 库存").check();
  await dialog.getByLabel("数量", { exact: true }).fill("20");
  await dialog.getByLabel("单位", { exact: true }).fill("颗");
  const first = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#70a090" },
    })
      .png()
      .toBuffer(),
    second = await sharp({
      create: { width: 80, height: 60, channels: 3, background: "#aa9070" },
    })
      .png()
      .toBuffer();
  await dialog.getByLabel("物品照片（可选，最多 8 张）").setInputFiles([
    { name: "front.png", mimeType: "image/png", buffer: first },
    { name: "back.png", mimeType: "image/png", buffer: second },
  ]);
  await expect(dialog.locator(".possession-photos img")).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "保存物品", exact: true }),
  ).toBeEnabled();
  await dialog.getByLabel("故事 / 备注").fill("放在上层，避免重复购买。");
  await page.screenshot({ path: info.outputPath("quick-photos.png") });
  await dialog.getByRole("button", { name: "保存物品", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  let s = await state(page),
    item = s.home.stocks.find(
      (i: { name: string }) => i.name === "我记录的洗衣凝珠",
    );
  expect(item.quantity).toBe(20);
  expect(item.photos).toHaveLength(2);
  expect(item.attachment.compartmentId).toBe("upper");
  await page.reload();
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-frames",
    /\d+/,
  );
  s = await state(page);
  expect(s.home.stocks.find((i: { id: string }) => i.id === item.id)).toEqual(
    item,
  );
  expect(generations).toBe(0);
});

test("cabinet 2D split, drawer type, numeric divider, drag, undo and merge retain contents", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await setup(page);
  await world(page, "库存视图");
  await expect(page.locator(".inventory-viewport")).toHaveAttribute(
    "data-frames",
    /\d+/,
  );
  await page.getByRole("button", { name: "收纳位置列表", exact: true }).click();
  await page.getByRole("button", { name: "编辑内部空间", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "收纳柜 · 编辑内部空间" });
  await editor
    .getByRole("button", { name: "选择隔间 清洁用品", exact: true })
    .click();
  await editor.getByRole("button", { name: "左右分隔", exact: true }).click();
  await editor.getByLabel("区域名称").fill("小抽屉");
  await editor.getByLabel("区域类型").selectOption("drawer");
  const ratioInput = editor.getByLabel("分隔比例");
  await ratioInput.click();
  await ratioInput.fill("");
  await ratioInput.pressSequentially("6");
  await expect(ratioInput).toHaveValue("6");
  await ratioInput.pressSequentially("0");
  await expect(ratioInput).toHaveValue("60");
  await ratioInput.press("Enter");
  await ratioInput.fill("0");
  await ratioInput.blur();
  await expect(ratioInput).toHaveValue("8");
  await ratioInput.fill("120");
  await ratioInput.blur();
  await expect(ratioInput).toHaveValue("92");
  await ratioInput.fill("35");
  await ratioInput.blur();
  const line = editor.getByRole("slider", {
    name: "分隔线 清洁用品",
    exact: true,
  });
  const b = (await line.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2, {
    steps: 4,
  });
  await page.mouse.up();
  await editor.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(editor.getByLabel("分隔比例")).toHaveValue("30");
  // Undo selected the root; select the drawer to inspect its parent divider.
  await editor
    .getByRole("button", { name: "选择隔间 小抽屉", exact: true })
    .click();
  await expect(editor.getByLabel("分隔比例")).toHaveValue("35");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: info.outputPath(`cabinet-${width}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await editor
    .getByRole("button", { name: "保存内部空间", exact: true })
    .click();
  await expect(editor).toHaveCount(0);
  const s = await state(page),
    interior = s.home.storage.find(
      (c: { entityId: string }) => c.entityId === "wardrobe",
    ).interior;
  const drawer = interior.parts.find(
    (p: { name: string }) => p.name === "小抽屉",
  );
  expect(drawer.kind).toBe("drawer");
  expect(
    s.home.stocks.find((i: { id: string }) => i.id === "capsules").attachment
      .compartmentId,
  ).toBe(drawer.id);
  await page.getByRole("button", { name: "编辑内部空间", exact: true }).click();
  await editor
    .getByRole("button", { name: "选择隔间 小抽屉", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "合并这两部分", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "保存内部空间", exact: true })
    .click();
  expect(
    (await state(page)).home.stocks.find(
      (i: { id: string }) => i.id === "capsules",
    ).attachment.compartmentId,
  ).toBe("upper");
});

test("cyber panels retain reading size during orbit, groups connect services across hosts and example edits stay isolated", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await setup(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const before = await state(page);
  await world(page, "赛博视图");
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-panels",
    /[6-9]/,
  );
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-edges",
    /[1-9]/,
  );
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-view-mode",
    "grid",
  );
  // Switch between Dashy-style grid view and list view cleanly.
  await expect(
    page.locator(".cyber-service.is-grid .service-icon-img").first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-view-mode",
    "list",
  );
  await expect(page.locator(".cyber-service.is-list").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("cyber-list.png") });
  await page.getByRole("button", { name: "网格视图" }).click();
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-view-mode",
    "grid",
  );
  const panels = page.locator(".cyber-host");
  const beforeBoxes = await panels.evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        w: r.width,
        bottom: r.bottom,
        cloud: e.classList.contains("is-cloud"),
      };
    }),
  );
  const widths = beforeBoxes.map((b) => b.w);
  const cloudMaxBottom = Math.max(
    ...beforeBoxes.filter((b) => b.cloud).map((b) => b.bottom),
  );
  const localMinTop = Math.min(
    ...beforeBoxes.filter((b) => !b.cloud).map((b) => b.y),
  );
  expect(cloudMaxBottom).toBeLessThanOrEqual(localMinTop);
  await page.screenshot({ path: info.outputPath("cyber-all.png") });
  const leaders = page.locator(".cyber-leaders path");
  const originalLeaders = await leaders.evaluateAll((es) =>
    es.map((e) => e.getAttribute("d")).join("|"),
  );
  const canvas = page.locator(".world-home-viewport canvas");
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.5, b.y + b.height * 0.9);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.85, {
    steps: 12,
  });
  await page.mouse.up();
  await expect.poll(async () => panels.count()).toBeGreaterThanOrEqual(6);
  await expect
    .poll(() =>
      leaders.evaluateAll((es) => es.map((e) => e.getAttribute("d")).join("|")),
    )
    .not.toBe(originalLeaders);
  const afterBoxes = await panels.evaluateAll((es) =>
    es.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width };
    }),
  );
  expect(
    afterBoxes.every((box) => Math.abs(box.w - widths[0]) < 1),
  ).toBeTruthy();
  expect(
    afterBoxes.every(
      (box, i) =>
        Math.abs(box.x - beforeBoxes[i].x) < 1 &&
        Math.abs(box.y - beforeBoxes[i].y) < 1,
    ),
  ).toBeTruthy();
  await page.getByRole("button", { name: "出网", exact: true }).click();
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "PostgreSQL" }),
  ).toHaveCount(0);
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-edges",
    "5",
  );
  await page.screenshot({ path: info.outputPath("cyber-outbound.png") });
  await page.getByRole("button", { name: "数据库访问", exact: true }).click();
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-edges",
    "3",
  );
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect(page.locator(".cyber-overlay")).toHaveAttribute(
      "data-layout-width",
      String(width),
    );
    await expect
      .poll(() =>
        panels.evaluateAll((es) =>
          es.every((e) => {
            const b = e.getBoundingClientRect();
            return (
              b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
            );
          }),
        ),
      )
      .toBeTruthy();
    const noOverlap = await panels.evaluateAll((es) => {
      const boxes = es.map((e) => e.getBoundingClientRect());
      return boxes.every((a, i) =>
        boxes.every(
          (c, j) =>
            i === j ||
            a.right <= c.left + 1 ||
            c.right <= a.left + 1 ||
            a.bottom <= c.top + 1 ||
            c.bottom <= a.top + 1,
        ),
      );
    });
    expect(noOverlap).toBeTruthy();
    await page.screenshot({ path: info.outputPath(`cyber-${width}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page.getByRole("button", { name: "全部关系", exact: true }).click();
  await expect(panels.filter({ hasText: "Cloud node" })).toHaveCount(1);
  await expect
    .poll(() =>
      leaders.evaluateAll((es) => es.map((e) => e.getAttribute("d")).join("|")),
    )
    .not.toBe("");
  await page.waitForTimeout(100);
  await page.screenshot({ path: info.outputPath("cyber-390-all.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("聚焦主机").selectOption("macbook");
  await expect(panels).toHaveCount(1);
  await expect(panels.first()).toContainText("MacBook");
  await page.getByRole("button", { name: "供电", exact: true }).click();
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-edges",
    /[1-3]/,
  );
  await page.screenshot({ path: info.outputPath("cyber-power.png") });
  await expect(
    page.getByText("已记录的供电关系 · 非实时读数", { exact: false }),
  ).toBeVisible();
  expect(await state(page)).toEqual(before);
  expect(errors).toEqual([]);
  await page.getByRole("button", { name: "示例小世界", exact: true }).click();
  await expect(page.locator(".world-example-banner")).toBeVisible();
  await page
    .getByRole("button", { name: "导入 HomeLab 图", exact: true })
    .click();
  const graph = worldExample().cyber!;
  graph.source = "demo.edited";
  graph.asOf = new Date().toISOString();
  await page.getByLabel("关系图 JSON").fill(JSON.stringify(graph));
  await page.getByRole("button", { name: "校验并保存关系图" }).click();
  await expect(
    page.getByRole("dialog", { name: "导入 HomeLab 关系图" }),
  ).toHaveCount(0);

  // Verify dense multi-host layout (>= 12 local hosts + 3 clouds) on 1280x800 stays clean without overlaps.
  await page.getByRole("button", { name: "返回我的家", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.route("**/api/world-example/state", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const roomIds = body.home.rooms
      .filter((r: { kind: string }) => r.kind === "room")
      .map((r: { id: string }) => r.id);
    const baseHost = body.home.entities.find(
      (e: { category: string; scope: string }) =>
        e.category === "host" && e.scope === "home",
    );
    const localTargets = body.home.cyber.nodes
      .filter((n: { kind: string }) => n.kind !== "external")
      .map((n: { id: string }) => n.id);
    const localNames = [
      "Proxmox-01",
      "Proxmox-02",
      "Pi-Hole DNS",
      "Home Assistant",
      "Media Box",
      "Build Runner",
      "Backup Vault",
      "Grafana",
      "TrueNAS Scale",
    ];
    for (let i = 0; i < localNames.length; i++) {
      const id = `dense-host-${i + 1}`;
      body.home.entities.push({
        ...baseHost,
        id,
        name: localNames[i],
        locationId: roomIds[i % roomIds.length],
        position: [-0.8 + (i % 4) * 0.55, 0.4, -0.6 + Math.floor(i / 4) * 0.55],
      });
      const svcId = `dense-svc-${i + 1}`;
      body.home.cyber.nodes.push({
        id: svcId,
        label: `${localNames[i]} Svc`,
        host: id,
        kind: "service",
        groups: ["prod"],
      });
      body.home.cyber.edges.push({
        id: `dense-edge-${i + 1}`,
        source: svcId,
        target: localTargets[i % localTargets.length],
        label: i % 2 === 0 ? "TCP" : "HTTPS",
        groups: ["prod"],
      });
    }
    const baseRemote = body.home.entities.find(
      (e: { category: string; scope: string }) =>
        e.category === "host" && e.scope === "remote",
    );
    body.home.entities.push({
      ...baseRemote,
      id: "cloud-dns",
      name: "Route53 DNS",
      scope: "remote",
    });
    body.home.cyber.clouds.push({
      host: "cloud-dns",
      provider: "AWS",
      region: "ap-northeast-1",
      direction: "east",
    });
    body.home.cyber.nodes.push({
      id: "cloud-dns-svc",
      label: "DNS Resolver",
      host: "cloud-dns",
      kind: "service",
      groups: ["prod"],
    });
    body.home.cyber.edges.push({
      id: "edge-dns-cloud",
      source: localTargets[0],
      target: "cloud-dns-svc",
      label: "DNS",
      groups: ["prod"],
    });
    await route.fulfill({ response: res, json: body });
  });
  await page.getByRole("button", { name: "示例小世界", exact: true }).click();
  await expect(page.locator(".world-example-banner")).toBeVisible();
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-layout-width",
    "1280",
  );
  await expect.poll(async () => panels.count()).toBeGreaterThanOrEqual(14);
  const denseNoOverlap = await panels.evaluateAll((es) => {
    const boxes = es.map((e) => e.getBoundingClientRect());
    return boxes.every((a, i) =>
      boxes.every(
        (c, j) =>
          i === j ||
          a.right <= c.left + 1 ||
          c.right <= a.left + 1 ||
          a.bottom <= c.top + 1 ||
          c.bottom <= a.top + 1,
      ),
    );
  });
  expect(denseNoOverlap).toBeTruthy();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.waitForTimeout(200);
  await page.screenshot({ path: info.outputPath("cyber-dense-12.png") });
  await page.unroute("**/api/world-example/state");

  // Verify standalone icon library modal & custom icon upload in CyberView.
  await page.getByRole("button", { name: "图标库" }).click();
  const iconDialog = page.getByRole("dialog", {
    name: "服务图标与本地图片资源库",
  });
  await expect(iconDialog).toBeVisible();
  await iconDialog.locator('input[type="file"]').setInputFiles({
    name: "my-custom-app.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0ea5e9"/><circle cx="16" cy="16" r="8" fill="#fff"/></svg>',
    ),
  });
  await expect(
    iconDialog.locator(".cyber-icon-section").first().locator("img"),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "关闭" }).click();

  expect(await state(page)).toEqual(before);
});

test("cyber view isolates dense intra-host self-references into layered architecture frame and responds to immediate hover clicks", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.route("**/api/world-example/state", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const baseHost = body.home.entities.find(
      (e: { category: string; scope: string }) =>
        e.category === "host" && e.scope === "home",
    );
    const n100Host = {
      ...baseHost,
      id: "n100-sim",
      name: "n100 · 火影 N100",
      tags: ["docker", "proxy"],
    };
    body.home.entities.push(n100Host);
    body.home.services.push(
      {
        id: "svc-app-sim",
        entityId: "n100-sim",
        name: "工作台服务",
        version: "v1.132",
        embed: "link",
        description: "常规应用入口",
        asOf: new Date().toISOString(),
        demo: true,
      },
      {
        id: "svc-immich-sim",
        entityId: "n100-sim",
        name: "Immich",
        version: "v1.132",
        embed: "link",
        description: "相册服务",
        asOf: new Date().toISOString(),
        demo: true,
      },
    );
    const internalNodes = [
      {
        id: "sim-npm",
        label: "NPM",
        host: "n100-sim",
        kind: "gateway",
        serviceId: "svc-app-sim",
        groups: ["gateway"],
      },
      {
        id: "sim-dashy",
        label: "Dashy",
        host: "n100-sim",
        kind: "service",
        serviceId: "svc-app-sim",
        groups: ["nav"],
      },
      {
        id: "sim-lobehub",
        label: "LobeHub",
        host: "n100-sim",
        kind: "service",
        serviceId: "svc-app-sim",
        groups: ["ai"],
      },
      {
        id: "sim-immich",
        label: "Immich",
        host: "n100-sim",
        kind: "service",
        serviceId: "svc-immich-sim",
        groups: ["media"],
      },
      {
        id: "sim-searxng",
        label: "SearXNG",
        host: "n100-sim",
        kind: "service",
        groups: ["ai"],
      },
      {
        id: "sim-pg",
        label: "Lobe ParadeDB",
        host: "n100-sim",
        kind: "database",
        groups: ["ai"],
      },
      {
        id: "sim-redis",
        label: "Lobe Redis",
        host: "n100-sim",
        kind: "database",
        groups: ["ai"],
      },
      {
        id: "sim-portainer",
        label: "Portainer CE",
        host: "n100-sim",
        kind: "service",
        groups: ["manage"],
      },
      {
        id: "sim-n8n",
        label: "n8n",
        host: "n100-sim",
        kind: "service",
        groups: ["automation"],
      },
      {
        id: "sim-uptime",
        label: "Uptime Kuma",
        host: "n100-sim",
        kind: "service",
        groups: ["ops"],
      },
      {
        id: "sim-newapi",
        label: "New API",
        host: "n100-sim",
        kind: "service",
        groups: ["relay"],
      },
      {
        id: "sim-agent",
        label: "beszel-agent · n100",
        host: "n100-sim",
        kind: "service",
        groups: ["ops"],
      },
      ...Array.from({ length: 6 }, (_, idx) => ({
        id: `sim-app-${idx + 1}`,
        label: `App ${idx + 1}`,
        host: "n100-sim",
        kind: "service",
        serviceId: "svc-app-sim",
        groups: ["apps"],
      })),
    ];
    body.home.cyber.nodes.push(...internalNodes);
    const peerTarget = body.home.cyber.nodes[0].id;
    body.home.cyber.edges.push(
      {
        id: "sim-fb",
        source: "sim-dashy",
        target: "sim-npm",
        label: "入口导航",
        groups: ["nav"],
      },
      {
        id: "sim-lobe-1",
        source: "sim-lobehub",
        target: "sim-searxng",
        label: "搜索",
        groups: ["ai"],
      },
      {
        id: "sim-lobe-2",
        source: "sim-lobehub",
        target: "sim-pg",
        label: "pgvector",
        groups: ["ai"],
      },
      {
        id: "sim-lobe-3",
        source: "sim-lobehub",
        target: "sim-redis",
        label: "缓存",
        groups: ["ai"],
      },
      {
        id: "sim-immich-pg",
        source: "sim-immich",
        target: "sim-pg",
        label: "SQL",
        groups: ["media"],
      },
      {
        id: "sim-immich-redis",
        source: "sim-immich",
        target: "sim-redis",
        label: "缓存",
        groups: ["media"],
      },
      ...internalNodes
        .filter((n) => n.kind === "service" && n.id !== "sim-agent")
        .map((n, idx) => ({
          id: `sim-npm-${idx}`,
          source: "sim-npm",
          target: n.id,
          label: "反代",
          groups: ["gateway"],
        })),
      // Cross-host edges from tail nodes bundle cleanly when collapsed under overflow.
      {
        id: "sim-cross-1",
        source: "sim-app-5",
        target: peerTarget,
        label: "HTTPS",
        groups: ["app"],
      },
      {
        id: "sim-cross-2",
        source: "sim-app-6",
        target: peerTarget,
        label: "HTTPS",
        groups: ["app"],
      },
    );
    await route.fulfill({ response: res, json: body });
  });

  await setup(page);
  await world(page, "赛博视图");
  await page.getByRole("button", { name: "示例小世界", exact: true }).click();
  await expect(page.locator(".world-example-banner")).toBeVisible();

  const overlay = page.locator(".cyber-overlay");
  // Base example has 9 cross-host edges + 2 visible cross-host edges from sim-app-5/6;
  // all intra-host edges on n100-sim stay cleanly scoped out of the global scene.
  await expect(overlay).toHaveAttribute("data-edges", "11");

  const quickHoverClick = async (
    locator: import("@playwright/test").Locator,
  ) => {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    await page.mouse.move(cx, cy);
    await page.waitForTimeout(5);
    await page.mouse.down();
    await page.waitForTimeout(20);
    await page.mouse.up();
  };

  // Verify fast hover+click works on a service card in grid mode.
  const firstSvc = page.locator(
    '[data-id="node:sim-npm"] button.cyber-service',
  );
  await expect(firstSvc).toBeVisible();
  await quickHoverClick(firstSvc);
  const svcDialog = page.getByRole("dialog", { name: "NPM" });
  await expect(svcDialog).toBeVisible();
  await expect(
    svcDialog.getByRole("button", { name: "打开服务" }),
  ).toBeVisible();
  await svcDialog.getByRole("button", { name: "关闭" }).click();
  await expect(svcDialog).toHaveCount(0);

  // Switch to list mode and verify service click AND "另有 N 个服务 · 展开" fast click both work.
  await page.getByRole("button", { name: "列表视图" }).click();
  await expect(overlay).toHaveAttribute("data-view-mode", "list");
  const listSvc = page.locator('[data-id="node:sim-npm"] button.cyber-service');
  await expect(listSvc).toBeVisible();
  await expect(listSvc).toHaveClass(/is-list/);
  await quickHoverClick(listSvc);
  await expect(page.getByRole("dialog", { name: "NPM" })).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  const moreBtn = page.locator(
    '[data-id="more:n100-sim"] button.cyber-service.is-more',
  );
  await expect(moreBtn).toBeVisible();
  await expect(moreBtn).toContainText(/另有 \d+ 个服务/);
  await quickHoverClick(moreBtn);

  const frame = page.getByRole("dialog", { name: "n100 · 火影 N100 分层架构" });
  await expect(frame).toBeVisible();
  await expect(
    frame.locator('[data-arch-tier="tier-boundary-top"]'),
  ).toContainText("边界门户");
  await expect(frame.locator('[data-arch-tier="tier-app"]')).toContainText(
    "顶层应用层",
  );
  await expect(frame.locator('[data-arch-tier="tier-app"]')).toHaveAttribute(
    "data-isolation",
    "virtual",
  );
  await expect(frame.locator('[data-arch-tier="tier-infra"]')).toContainText(
    "基础设施层",
  );
  await expect(
    frame.locator('[data-arch-tier="tier-middleware"]'),
  ).toContainText("中间件与数据层");
  await expect(
    frame.locator('[data-arch-tier="tier-middleware"]'),
  ).toHaveAttribute("data-isolation", "strict");
  await expect(frame.locator("[data-arch-node]")).toHaveCount(18);

  // Compact sizing check: desktop frame is <= 925px wide instead of sprawling full screen.
  const desktopFrameBox = await frame
    .locator(".cyber-host-frame")
    .boundingBox();
  expect(desktopFrameBox).not.toBeNull();
  expect(desktopFrameBox!.width).toBeLessThanOrEqual(925);

  await frame.locator('[data-arch-node="sim-npm"]').hover();
  await page.waitForTimeout(100);
  await page.screenshot({
    path: info.outputPath("cyber-n100-layered-desktop.png"),
  });

  // Category filter inside host architecture highlights matching members.
  await frame
    .locator(".cyber-arch-cats")
    .getByRole("button", { name: /健康监控/ })
    .click();
  await expect(frame.locator('[data-arch-node="sim-uptime"]')).toHaveClass(
    /is-active/,
  );
  await expect(frame.locator('[data-arch-node="sim-dashy"]')).toHaveClass(
    /is-dimmed/,
  );
  await frame
    .locator(".cyber-arch-cats")
    .getByRole("button", { name: "全部分类" })
    .click();

  await frame.getByRole("tab", { name: "Mermaid" }).click();
  await expect(frame.locator("pre")).toContainText("flowchart TD");
  await expect(frame.locator("pre")).toContainText("-.->");

  await frame.getByRole("tab", { name: "服务清单" }).click();
  await expect(frame.locator(".cyber-host-list .cyber-detail-row")).toHaveCount(
    18,
  );
  await frame.getByRole("tab", { name: "分层隔离图" }).click();

  // Clicking a service inside the layered architecture opens the service detail modal on top.
  await frame.locator('[data-arch-node="sim-immich"]').click();
  const immichDialog = page.getByRole("dialog", { name: "Immich" });
  await expect(immichDialog).toBeVisible();
  await expect(
    immichDialog.getByRole("button", { name: "打开服务" }),
  ).toBeVisible();
  await immichDialog.getByRole("button", { name: "关闭" }).click();

  // Check responsive widths for zero horizontal overflow inside expanded architecture frame.
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(150);
    const fitsViewport = await frame.evaluate(() => {
      const box = document
        .querySelector(".cyber-host-frame")!
        .getBoundingClientRect();
      const body = document.querySelector(
        ".cyber-host-frame-body",
      ) as HTMLElement;
      return (
        box.left >= 0 &&
        box.right <= innerWidth + 1 &&
        body.scrollWidth <= body.clientWidth + 1
      );
    });
    expect(fitsViewport).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`cyber-n100-layered-${width}.png`),
    });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await frame.getByRole("button", { name: "关闭" }).click();
  await expect(frame).toHaveCount(0);

  // Also confirm opening HostArchitectureFrame while a filter ("出网") is active still preserves full host services.
  await page.getByRole("button", { name: "出网", exact: true }).click();
  await expect(
    page.locator(".react-flow__node").filter({ hasText: "PostgreSQL" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "对比拓扑外" }).click();
  await expect(page.locator(".cyber-host.is-outside-topology")).not.toHaveCount(
    0,
  );
  await page
    .locator(".cyber-host")
    .filter({ hasText: "n100 · 火影 N100" })
    .locator("button.cyber-arch-pill")
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "n100 · 火影 N100 分层架构" })
      .locator("[data-arch-node]"),
  ).toHaveCount(18);
  await page
    .getByRole("dialog", { name: "n100 · 火影 N100 分层架构" })
    .getByRole("button", { name: "关闭" })
    .click();

  // Switch to Topology-first perspective ("machines are virtual labels, active topology is real").
  await page.getByRole("button", { name: "拓扑视角" }).click();
  await expect(overlay).toHaveAttribute("data-perspective", "topology");
  const topoStage = page.locator(".cyber-topo-stage");
  await expect(topoStage).toBeVisible();
  await expect(topoStage).toContainText("本地物理内网隔离域");
  await expect(topoStage).toContainText("出网边界 EGRESS");
  await expect(topoStage).toContainText(/不在此拓扑中/);
  await expect(topoStage.locator(".cyber-topo-vm-chip").first()).toBeVisible();
  await expect(topoStage.locator(".cyber-topo-edge")).not.toHaveCount(0);

  // Verify topology SVG edges render ABOVE zone backgrounds while cards stay clickable ABOVE SVG hit paths.
  const topoEdgeCheck = await page.evaluate(() => {
    const svg = document.querySelector(".cyber-topo-svg");
    const zone = document.querySelector(".cyber-topo-zone");
    const card = document.querySelector(".cyber-topo-card");
    const edge = document.querySelector(".cyber-topo-edge");
    const svgZ = svg ? Number(getComputedStyle(svg).zIndex) : 0;
    const zoneZ = zone ? getComputedStyle(zone).zIndex : "";
    const cardZ = card ? Number(getComputedStyle(card).zIndex) : 0;
    const edgeOpacity = edge ? Number(getComputedStyle(edge).opacity) : 0;
    return {
      edgeCount: document.querySelectorAll(".cyber-topo-edge").length,
      svgAboveZone: zoneZ === "auto" && svgZ > 0 && cardZ > svgZ,
      edgeVisible: edgeOpacity >= 0.35,
    };
  });
  expect(topoEdgeCheck.edgeCount).toBeGreaterThan(0);
  expect(topoEdgeCheck.svgAboveZone).toBeTruthy();
  expect(topoEdgeCheck.edgeVisible).toBeTruthy();

  await page.screenshot({
    path: info.outputPath("cyber-topology-desktop.png"),
  });

  // Check Topology-first perspective AND floating chrome cleanly fit 390px viewport with zero horizontal clipping.
  await page.setViewportSize({ width: 390, height: 960 });
  await page.waitForTimeout(150);
  const fitsMobile = await page.evaluate(() => {
    const chrome = document
      .querySelector(".cyber-chrome")!
      .getBoundingClientRect();
    return {
      docFits: document.documentElement.scrollWidth <= innerWidth + 1,
      chromeRightOk: chrome.right <= innerWidth + 1,
    };
  });
  expect(fitsMobile.docFits).toBeTruthy();
  expect(fitsMobile.chromeRightOk).toBeTruthy();
  await page.screenshot({
    path: info.outputPath("cyber-topology-390.png"),
  });

  await page.setViewportSize({ width: 1280, height: 800 });

  // Reset to full topology, inspect full-topology SVG + custom zones, and edit node attributes inline.
  await page.getByRole("button", { name: "全部关系" }).click();
  await page.waitForTimeout(150);
  await page.screenshot({
    path: info.outputPath("cyber-topology-full-desktop.png"),
  });

  await page.getByRole("button", { name: "域与分类配置" }).click();
  const taxDialog = page.getByRole("dialog", {
    name: "隔离域、分类与拓扑配置",
  });
  await expect(taxDialog).toBeVisible();
  await taxDialog.getByPlaceholder("例如：dmz-edge").fill("custom-home-dmz");
  await taxDialog
    .getByPlaceholder("例如：家庭 DMZ 隔离域")
    .fill("自定义核心隔离域");
  await taxDialog.getByRole("button", { name: "添加或更新隔离域" }).click();
  await expect(taxDialog).toContainText("自定义核心隔离域");

  await taxDialog.getByRole("button", { name: /自定义分类/ }).click();
  await taxDialog.getByPlaceholder("例如：ai-inference").fill("ai-inference");
  await taxDialog.getByPlaceholder("例如：AI 推理").fill("AI 推理");
  await taxDialog.getByRole("button", { name: "注册或更新分类" }).click();
  await expect(taxDialog).toContainText("AI 推理");
  await taxDialog.getByRole("button", { name: "关闭" }).click();

  await expect(page.getByLabel("职能分类")).toContainText("AI 推理");

  await topoStage
    .locator('[data-topo-node="app"] button.cyber-topo-card-btn')
    .click();
  const appDialog = page.getByRole("dialog", { name: "个人应用" });
  await expect(appDialog).toBeVisible();
  await appDialog.getByLabel("所属隔离域").selectOption("custom-home-dmz");
  await appDialog.getByLabel("节点职能分类").selectOption("ai-inference");
  await appDialog.getByRole("button", { name: "保存节点属性" }).click();
  await expect(appDialog).toContainText("已保存节点分层与拓扑属性");
  await appDialog.getByRole("button", { name: "关闭" }).click();
  await expect(
    topoStage.locator('.cyber-topo-zone[data-zone-id="custom-home-dmz"]'),
  ).toContainText("个人应用");

  await page.getByRole("button", { name: "机器视角" }).click();
  await expect(overlay).toHaveAttribute("data-perspective", "machine");
  expect(errors).toEqual([]);
});

test("cyber topology renders large/medium/small icon tiers and hides subordinate agent edges until hover", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await setup(page);

  const csrf = await loginAdmin(page);
  const cur = await state(page);
  const richCyber = {
    version: 1,
    source: "size-tiers-e2e",
    asOf: new Date().toISOString(),
    clouds: cur.home.cyber.clouds,
    nodes: [
      {
        id: "npm-gw",
        label: "NPM",
        host: "studio-mini",
        kind: "gateway",
        groups: ["业务"],
      },
      {
        id: "lobe-app",
        label: "LobeHub",
        host: "studio-mini",
        kind: "service",
        groups: ["业务"],
      },
      {
        id: "lobe-pg",
        label: "Lobe ParadeDB",
        host: "studio-mini",
        kind: "database",
        groups: ["业务"],
      },
      {
        id: "lobe-redis",
        label: "Lobe Redis",
        host: "studio-mini",
        kind: "database",
        groups: ["业务"],
      },
      {
        id: "beszel-hub",
        label: "Beszel Hub",
        host: "home-nas",
        kind: "service",
        groups: ["监控"],
      },
      {
        id: "portainer-ce",
        label: "Portainer CE",
        host: "studio-mini",
        kind: "service",
        groups: ["运维"],
      },
      {
        id: "beszel-agent-mini1",
        label: "beszel-agent · mini1",
        host: "mini-1",
        kind: "service",
        groups: ["监控"],
      },
      {
        id: "beszel-agent-mini2",
        label: "beszel-agent · mini2",
        host: "mini-2",
        kind: "service",
        groups: ["监控"],
      },
      {
        id: "portainer-agent-mini1",
        label: "Portainer agent · mini1",
        host: "mini-1",
        kind: "service",
        groups: ["运维"],
      },
      {
        id: "portainer-agent-studio",
        label: "Portainer agent · studio",
        host: "studio-mini",
        kind: "service",
        groups: ["运维"],
      },
      {
        id: "gateway-ext",
        label: "远端网关",
        host: "cloud-node",
        kind: "gateway",
        groups: ["业务"],
      },
    ],
    edges: [
      {
        id: "e-npm-lobe",
        source: "npm-gw",
        target: "lobe-app",
        label: "HTTPS",
        groups: ["业务"],
      },
      {
        id: "e-lobe-gw",
        source: "lobe-app",
        target: "gateway-ext",
        label: "隧道",
        groups: ["业务"],
      },
      {
        id: "e-lobe-pg",
        source: "lobe-app",
        target: "lobe-pg",
        label: "SQL",
        groups: ["业务"],
      },
      {
        id: "e-lobe-redis",
        source: "lobe-app",
        target: "lobe-redis",
        label: "Redis",
        groups: ["业务"],
      },
      {
        id: "e-agent-mini1",
        source: "beszel-agent-mini1",
        target: "beszel-hub",
        label: "WS",
        groups: ["监控"],
      },
      {
        id: "e-agent-mini2",
        source: "beszel-agent-mini2",
        target: "beszel-hub",
        label: "WS",
        groups: ["监控"],
      },
      {
        id: "e-pt-mini1",
        source: "portainer-ce",
        target: "portainer-agent-mini1",
        label: "HTTPS",
        groups: ["运维"],
      },
      {
        id: "e-pt-studio",
        source: "portainer-ce",
        target: "portainer-agent-studio",
        label: "Socket",
        groups: ["运维"],
      },
    ],
  };

  const cmdRes = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: cur.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "cyber.replace", graph: richCyber },
    },
  });
  expect(cmdRes.ok(), await cmdRes.text()).toBeTruthy();

  await world(page, "赛博视图");
  await page.mouse.move(10, 10);

  // In Machine-first view, only the 1 cross-host business edge renders at rest; subordinate agent edges appear on hover.
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-perspective",
    "machine",
  );
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(1);
  await page
    .locator(".cyber-service")
    .filter({ hasText: "Beszel Hub" })
    .hover();
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(3);
  await page.mouse.move(10, 10);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(1);

  // Switch to Topology-first perspective and verify large / medium / small visual hierarchy.
  await page.getByRole("button", { name: "拓扑视角" }).click();
  await page.mouse.move(10, 10);
  const topo = page.locator(".cyber-topo-stage");
  await expect(topo).toBeVisible();

  const largeCard = topo.locator('[data-topo-node="lobe-app"]');
  const medCard = topo.locator('[data-topo-node="lobe-pg"]');
  const smallCard = topo.locator('[data-topo-node="beszel-agent-mini1"]');
  await expect(largeCard).toHaveAttribute("data-topo-size", "large");
  await expect(medCard).toHaveAttribute("data-topo-size", "medium");
  await expect(smallCard).toHaveAttribute("data-topo-size", "small");

  // Small icon has zero visible text inside; medium has label but no footer chips; large has full card footprint.
  expect((await smallCard.innerText()).trim()).toBe("");
  await expect(medCard).toContainText("Lobe ParadeDB");
  await expect(medCard.locator(".cyber-topo-card-foot")).toHaveCount(0);
  await expect(largeCard.locator(".cyber-topo-card-foot")).toHaveCount(1);

  const [largeBox, medBox, smallBox] = await Promise.all([
    largeCard.boundingBox(),
    medCard.boundingBox(),
    smallCard.boundingBox(),
  ]);
  expect(largeBox!.width).toBeGreaterThan(medBox!.width);
  expect(medBox!.width).toBeGreaterThan(smallBox!.width);
  expect(smallBox!.width).toBeLessThanOrEqual(34);
  expect(smallBox!.height).toBeLessThanOrEqual(34);

  // At rest, only the 4 business edges draw (the 4 subordinate agent lines stay hidden).
  await expect(topo.locator(".cyber-topo-edge")).toHaveCount(4);
  await expect(topo.locator(".cyber-topo-edge.is-quiet-revealed")).toHaveCount(
    0,
  );
  await page.screenshot({
    path: info.outputPath("cyber-topo-sizes-resting-1440.png"),
  });

  // Hovering a small icon reveals its floating tooltip and its quiet edge to Beszel Hub.
  await smallCard.hover();
  await expect(topo.locator(".cyber-topo-node-tooltip")).toContainText(
    "beszel-agent · mini1",
  );
  await expect(topo.locator(".cyber-topo-edge.is-quiet-revealed")).toHaveCount(
    1,
  );
  await page.screenshot({
    path: info.outputPath("cyber-topo-sizes-hover-small.png"),
  });

  // Hovering Beszel Hub reveals both connected agent edges at once.
  await topo.locator('[data-topo-node="beszel-hub"]').hover();
  await expect(topo.locator(".cyber-topo-edge.is-quiet-revealed")).toHaveCount(
    2,
  );

  await page.mouse.move(10, 10);
  await expect(topo.locator(".cyber-topo-edge.is-quiet-revealed")).toHaveCount(
    0,
  );

  // Verify intermediate (768px) and narrow (390px) responsive layout without overflow.
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.waitForTimeout(150);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: info.outputPath(`cyber-topo-sizes-${width}.png`),
    });
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  // Edit a node's size explicitly in CyberNodeDialog and verify persistence across reload.
  await medCard.locator("button.cyber-topo-card-btn").click();
  const pgDialog = page.getByRole("dialog", { name: "Lobe ParadeDB" });
  await expect(pgDialog).toBeVisible();
  await pgDialog.getByLabel("图标尺寸").selectOption("large");
  await pgDialog.getByRole("button", { name: "保存节点属性" }).click();
  await expect(pgDialog).toContainText("已保存节点分层与拓扑属性");
  await pgDialog.getByRole("button", { name: "关闭" }).click();
  await expect(topo.locator('[data-topo-node="lobe-pg"]')).toHaveAttribute(
    "data-topo-size",
    "large",
  );

  // Also check HostArchitectureFrame renders all 3 icon tiers and hides quiet intra-host edges until hover.
  await topo.locator('[data-topo-node="lobe-app"] .cyber-topo-vm-chip').click();
  const hostFrame = page.getByRole("dialog", { name: /Studio mini 分层架构/ });
  await expect(hostFrame).toBeVisible();
  await expect(hostFrame.locator('[data-arch-node="lobe-pg"]')).toHaveAttribute(
    "data-arch-size",
    "large",
  );
  await expect(
    hostFrame.locator('[data-arch-node="lobe-redis"]'),
  ).toHaveAttribute("data-arch-size", "medium");
  const archSmall = hostFrame.locator(
    '[data-arch-node="portainer-agent-studio"]',
  );
  await expect(archSmall).toHaveAttribute("data-arch-size", "small");
  expect((await archSmall.innerText()).trim()).toBe("");
  await expect(hostFrame.locator(".cyber-arch-edge")).toHaveCount(3);
  await archSmall.hover();
  await expect(hostFrame.locator(".cyber-topo-node-tooltip")).toContainText(
    "Portainer agent · studio",
  );
  await expect(
    hostFrame.locator(".cyber-arch-edge.is-quiet-revealed"),
  ).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("cyber-arch-sizes-hover.png"),
  });
  await hostFrame.getByRole("button", { name: "关闭" }).click();

  expect(errors).toEqual([]);
});

test("inventory walk changes position and two eye heights, opens drawers and uses distance detail", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await setup(page);
  await world(page, "库存视图");
  const view = page.locator(".inventory-viewport");
  await expect(view).toHaveAttribute("data-frames", /\d+/);
  await expect(view).toHaveAttribute("data-eye", "1.6");
  const before = await view.getAttribute("data-camera");
  await view.locator("canvas").focus();
  await page.keyboard.down("ArrowDown");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowDown");
  await expect(view).not.toHaveAttribute("data-camera", before!);
  await page.keyboard.press("Space");
  await expect(view).toHaveAttribute("data-eye", "0.4");
  await page.waitForTimeout(250);
  await page.getByLabel("走到收纳位置").selectOption("bedside");
  await expect(view).toHaveAttribute("data-eye", "0.4");
  const drawer = page.locator(
    '.inventory-board[data-container="bedside"][data-compartment="drawer"]',
  );
  await expect(drawer).toHaveAttribute("data-lod", "near");
  await drawer.locator(".inventory-region-title").click();
  await expect(drawer).toHaveClass(/drawer-open/);
  await expect(
    drawer.getByRole("button", { name: "备用转接头 · 查看", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("inventory-drawer.png") });
  await drawer
    .getByRole("button", { name: "备用转接头 · 查看", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "床头柜", exact: true })
    .getByRole("button", { name: /备用转接头/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "备用转接头", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await view.locator("canvas").focus();
  await page.keyboard.down("ArrowDown");
  try {
    await expect(drawer).toHaveAttribute("data-lod", "summary");
    const summaryBox = await drawer.evaluate((el) => {
      const board = el.getBoundingClientRect();
      const summary = el.querySelector(".inventory-summary")!;
      const rect = summary.getBoundingClientRect();
      return {
        fits:
          rect.left >= board.left - 1 &&
          rect.right <= board.right + 1 &&
          rect.top >= board.top - 1 &&
          rect.bottom <= board.bottom + 1,
        fontSize: parseFloat(getComputedStyle(summary).fontSize),
      };
    });
    expect(summaryBox.fits).toBeTruthy();
    expect(summaryBox.fontSize).toBeLessThanOrEqual(22);
  } finally {
    await page.keyboard.up("ArrowDown");
  }
  await page.keyboard.down("ArrowDown");
  try {
    await expect(drawer).toHaveAttribute("data-lod", "distant");
  } finally {
    await page.keyboard.up("ArrowDown");
  }
  await page.getByLabel("走到收纳位置").selectOption("wardrobe");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await expect
      .poll(() =>
        view.locator("canvas").evaluate((e) => (e as HTMLCanvasElement).width),
      )
      .toBe(width);
    await expect
      .poll(() =>
        page
          .locator(
            '.inventory-board[data-container="wardrobe"][data-compartment="upper"]',
          )
          .evaluate((e) => {
            const b = e.getBoundingClientRect();
            return (
              b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight
            );
          }),
      )
      .toBeTruthy();
    await page.screenshot({ path: info.outputPath(`inventory-${width}.png`) });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  await page
    .locator(
      '.inventory-board[data-container="wardrobe"][data-compartment="upper"] .inventory-summary',
    )
    .click();
  await expect(
    page
      .getByRole("dialog", { name: "收纳柜", exact: true })
      .getByRole("button", { name: /洗衣凝珠/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.getByRole("button", { name: "← 生活空间", exact: true }).click();
  await expect(page.locator(".world-workspace")).toHaveCount(0);
});

test("uncertain example item save survives reload, reuses its operation and remains findable outside a cabinet", async ({
  page,
}) => {
  test.setTimeout(150000);
  await setup(page);
  const before = await state(page);
  await world(page, "库存视图");
  await page.getByRole("button", { name: "示例小世界", exact: true }).click();
  await expect(page.locator(".world-example-banner")).toBeVisible();
  const seen: string[] = [];
  let dropped = false;
  await page.route("**/api/world-example/commands", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action.type === "item.record") {
      seen.push(body.operationId);
      if (!dropped) {
        dropped = true;
        await route.fetch();
        await route.abort("failed");
        return;
      }
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "记一件物品", exact: true }).click();
  await page.getByLabel("物品名称", { exact: true }).fill("暂未收纳的备用线");
  await page.getByRole("button", { name: "保存物品", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认保存结果", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page.locator(".home-viewport[data-frames]").waitFor();
  await world(page, "库存视图");
  await expect(page.locator(".world-example-banner")).toBeVisible();
  await page.getByRole("button", { name: "记一件物品", exact: true }).click();
  await page.getByRole("button", { name: "确认保存结果", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "暂未收纳的备用线", exact: true }),
  ).toBeVisible();
  expect(seen).toHaveLength(2);
  expect(seen[0]).toBe(seen[1]);
  await page.getByRole("button", { name: "关闭窗口", exact: true }).click();
  await page.getByRole("button", { name: /^待收纳/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: "待收纳物品", exact: true })
      .getByRole("button", { name: /^收纳柜/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /暂未收纳的备用线/ }).click();
  await page.getByLabel("目标柜子").selectOption("bedside");
  await page.getByLabel("目标隔间").selectOption("drawer");
  await page.getByRole("button", { name: "确认移动", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "返回所属柜子", exact: true }),
  ).toBeVisible();
  expect(await state(page)).toEqual(before);
  const example = await (
    await page.request.get("/api/world-example/state")
  ).json();
  expect(
    example.home.entities.filter(
      (i: { name: string }) => i.name === "暂未收纳的备用线",
    ),
  ).toHaveLength(1);
  expect(
    example.home.entities.find(
      (i: { name: string }) => i.name === "暂未收纳的备用线",
    ).attachment.compartmentId,
  ).toBe("drawer");
});

async function cyberPoint(page: Page, id: string) {
  const s = await state(page);
  const entity = s.home.entities.find((e: { id: string }) => e.id === id)!;
  const room = s.home.rooms.find(
    (r: { id: string }) => r.id === entity.locationId,
  )!;
  const asset = s.home.assets.find(
    (a: { id: string }) => a.id === entity.assetId,
  )!;
  const scene = page.locator(".world-home-viewport");
  const box = (await scene.boundingBox())!;
  const camera = new OrthographicCamera(
    -10,
    10,
    (10 * box.height) / box.width,
    (-10 * box.height) / box.width,
    0.1,
    250,
  );
  const insets = ((await scene.getAttribute("data-cyber-insets")) || "")
    .split(",")
    .map(Number);
  if (insets.length === 4 && insets.every((n) => Number.isFinite(n))) {
    const [left, top, right, bottom] = insets;
    camera.setViewOffset(
      box.width,
      box.height,
      (right - left) / 2,
      -(top - bottom) / 2,
      box.width,
      box.height,
    );
  }
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
  camera.updateMatrixWorld();
  const projected = new Vector3(
    room.origin[0] + entity.position[0],
    room.origin[1] + entity.position[1] + asset.height * 0.5,
    room.origin[2] + entity.position[2],
  ).project(camera);
  return {
    x: box.x + ((projected.x + 1) * box.width) / 2,
    y: box.y + ((1 - projected.y) * box.height) / 2,
  };
}

test("cyber view allows interacting with 3D devices and hosts while keeping furniture non-interactive", async ({
  page,
}, info) => {
  test.setTimeout(150000);
  await setup(page);
  const before = await state(page);
  await world(page, "赛博视图");
  const scene = page.locator(".world-home-viewport");
  await expect(scene).toHaveAttribute("data-task", "devices");
  await expect(scene).toHaveAttribute("data-pickable", /macbook/);
  await expect(scene).toHaveAttribute("data-pickable", /bedside-power/);
  await expect(scene).not.toHaveAttribute("data-pickable", /\bworkbench\b/);
  await expect(scene).not.toHaveAttribute("data-pickable", /\bbedside\b(,|$)/);
  await expect(scene).not.toHaveAttribute("data-pickable", /\bwardrobe\b/);
  await expect(page.locator(".cyber-overlay")).toHaveAttribute(
    "data-edges",
    "9",
  );
  await expect(scene).not.toHaveAttribute("data-cyber-insets", /^(0,0,0,0)?$/);

  // Clicking furniture in 3D does not show a hover label or switch focus.
  const furniture = await cyberPoint(page, "workbench");
  await page.mouse.move(furniture.x, furniture.y);
  await expect(scene.locator(".scene-object-label:visible")).toHaveCount(0);
  await page.mouse.click(furniture.x, furniture.y);
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await expect(scene).toHaveAttribute("data-inspecting", "");

  // Hovering and clicking a 3D device/host switches camera focus and highlights its card without opening 关于这件东西.
  const device = await cyberPoint(page, "macbook");
  await page.mouse.move(device.x, device.y);
  await expect(scene.locator(".scene-object-label:visible")).toContainText(
    "MacBook",
  );
  await page.mouse.click(device.x, device.y);
  await expect(scene).toHaveAttribute("data-inspecting", "macbook");
  await expect(scene.locator(".scene-object-label.selected")).toContainText(
    "MacBook",
  );
  await expect(page.locator(".space-panel")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "关于这件东西" })).toHaveCount(0);
  await expect(
    page.locator(".cyber-host.is-highlighted").filter({ hasText: "MacBook" }),
  ).toHaveCount(1);

  // Wheel zoom (even over overlay elements) and zoom controls adjust zoom freely; orbiting works while focused.
  const beforeZoom = Number(await scene.getAttribute("data-zoom"));
  await page.mouse.move(device.x, device.y);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(async () => Number(await scene.getAttribute("data-zoom")))
    .toBeGreaterThan(beforeZoom);
  const afterWheelZoom = Number(await scene.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "放大视角", exact: true }).click();
  await expect
    .poll(async () => Number(await scene.getAttribute("data-zoom")))
    .toBeGreaterThan(afterWheelZoom);
  const afterBtnZoomIn = Number(await scene.getAttribute("data-zoom"));
  await page.getByRole("button", { name: "缩小视角", exact: true }).click();
  await expect
    .poll(async () => Number(await scene.getAttribute("data-zoom")))
    .toBeLessThan(afterBtnZoomIn);

  const beforeCamera = await scene.getAttribute("data-camera");
  const box = (await scene.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.65);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.6, {
    steps: 8,
  });
  await page.mouse.up();
  await expect
    .poll(() => scene.getAttribute("data-camera"))
    .not.toBe(beforeCamera);
  await page.screenshot({ path: info.outputPath("cyber-device-focus.png") });

  // Narrow viewport keeps the Cyber View toolbar & graph usable without overflow.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "放大视角", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: info.outputPath("cyber-device-narrow.png") });

  // Escape and reset control restore the Cyber View overview.
  await page.keyboard.press("Escape");
  await expect(scene).toHaveAttribute("data-inspecting", "");
  await page.getByRole("button", { name: "放大视角", exact: true }).click();
  await page.getByRole("button", { name: "重置视角", exact: true }).click();
  await expect(scene).toHaveAttribute("data-inspecting", "");
  expect((await state(page)).revision).toBe(before.revision);
});

test("browser WebMCP exposes registered tools and updates persisted services cleanly", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools: Array<{
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (args: Record<string, unknown>) => Promise<unknown>;
    }> = [];
    (window as unknown as { __webMcpTools: typeof tools }).__webMcpTools =
      tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(
          tool: (typeof tools)[number],
          options?: { signal?: AbortSignal },
        ) {
          tools.push(tool);
          options?.signal?.addEventListener("abort", () => {
            const idx = tools.indexOf(tool);
            if (idx >= 0) tools.splice(idx, 1);
          });
        },
      },
    });
  });

  await setup(page);
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          (window as unknown as { __webMcpTools: { name: string }[] })
            .__webMcpTools.length,
      ),
    )
    .toBeGreaterThanOrEqual(11);

  const registeredNames = await page.evaluate(() =>
    (
      window as unknown as {
        __webMcpTools: { name: string; inputSchema: { type?: string } }[];
      }
    ).__webMcpTools.map((t) => ({ name: t.name, type: t.inputSchema.type })),
  );
  for (const expected of [
    "get_home_state",
    "inspect_cyber_architecture",
    "list_icons",
    "upsert_service",
    "replace_cyber_graph",
    "upsert_cyber_node",
    "upsert_cyber_zone",
    "configure_cyber_taxonomy",
    "run_domain_command",
  ]) {
    expect(registeredNames).toContainEqual({ name: expected, type: "object" });
  }

  const receipt = (await page.evaluate(async () => {
    const tools = (
      window as unknown as {
        __webMcpTools: {
          name: string;
          execute: (args: Record<string, unknown>) => Promise<unknown>;
        }[];
      }
    ).__webMcpTools;
    const summary = (await tools
      .find((t) => t.name === "get_home_state")!
      .execute({ section: "summary" })) as {
      entities: { id: string; category: string }[];
    };
    const hostId = summary.entities.find((e) => e.category === "host")!.id;
    return tools
      .find((t) => t.name === "upsert_service")!
      .execute({
        service: {
          id: "webmcp-svc",
          entityId: hostId,
          name: "WebMCP App",
          version: "1.0.0",
          embed: "unverified",
          icon: "grafana",
          description: "Registered via document.modelContext",
          asOf: "2026-11-15T00:00:00Z",
          demo: false,
        },
      });
  })) as { revision: number; action: string };

  expect(receipt.action).toBe("service.upsert");
  await page.reload();
  const persisted = (await state(page)) as {
    home: { services: { id: string; icon?: string }[] };
  };
  expect(persisted.home.services.find((s) => s.id === "webmcp-svc")?.icon).toBe(
    "grafana",
  );
});
