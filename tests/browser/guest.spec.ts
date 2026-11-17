import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import { OrthographicCamera, Vector3 } from "three";
import type { Action, Dashboard, HomeTemplate } from "../../shared/domain.js";
import type { GuestDashboard, Hotspot } from "../../shared/guest.js";
import { e2eAdminKey } from "./auth.js";

async function createPng(background: string): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 90, channels: 3, background },
  })
    .png()
    .toBuffer();
}

async function adminSession(request: APIRequestContext) {
  const login = await request.post("/api/admin/login", {
    data: { key: e2eAdminKey },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const getState = async (): Promise<Dashboard> => {
    const res = await request.get("/api/state");
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  const send = async (action: Action) => {
    const current = await getState();
    const res = await request.post("/api/commands", {
      headers: { "X-Session-Token": csrfToken },
      data: {
        operationId: crypto.randomUUID(),
        expectedRevision: current.revision,
        issuedAt: new Date().toISOString(),
        action,
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  const upload = async (name: string, background: string): Promise<string> => {
    const buffer = await createPng(background);
    const res = await request.post("/api/uploads", {
      headers: { "X-Session-Token": csrfToken },
      multipart: {
        image: { name, mimeType: "image/png", buffer },
      },
    });
    expect(res.ok(), await res.text()).toBe(true);
    const body = (await res.json()) as { url: string };
    return body.url;
  };
  return { csrfToken, getState, send, upload };
}

async function projectGuestEntity(page: Page, entityId: string) {
  const guest = (await (
    await page.request.get("/api/guest/state")
  ).json()) as GuestDashboard;
  const entity = guest.home.entities.find((e) => e.id === entityId)!;
  const room = guest.home.rooms.find((r) => r.id === entity.locationId)!;
  const asset = guest.home.assets.find((a) => a.id === entity.assetId)!;
  const host = page.locator(".guest-viewport");
  const box = (await host.boundingBox())!;
  const camera = new OrthographicCamera(
    -10,
    10,
    (10 * box.height) / box.width,
    (-10 * box.height) / box.width,
    0.1,
    250,
  );
  camera.position.fromArray(
    (await host.getAttribute("data-camera"))!.split(",").map(Number),
  );
  camera.zoom = Number(await host.getAttribute("data-zoom"));
  camera.lookAt(
    new Vector3().fromArray(
      (await host.getAttribute("data-target"))!.split(",").map(Number),
    ),
  );
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const projected = new Vector3()
    .fromArray(room.origin)
    .add(new Vector3().fromArray(entity.position))
    .add(new Vector3(0, Math.max(0.18, asset.height * 0.55), 0))
    .project(camera);
  return {
    x: box.x + ((projected.x + 1) * box.width) / 2,
    y: box.y + ((1 - projected.y) * box.height) / 2,
  };
}

test.describe("guest showcase separation and interactive hotspots", () => {
  let privateUploadUrl = "";
  let albumUploadOne = "";
  let albumUploadTwo = "";

  test.beforeAll(async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    try {
      const admin = await adminSession(adminCtx);
      const templates: HomeTemplate[] = await (
        await adminCtx.get("/api/templates")
      ).json();
      const base = structuredClone(
        templates.find((item) => item.id === "studio") ?? templates[0],
      );
      const robotAsset = base.assets.find((a) => a.id === "robot")!;
      base.assets.push({
        ...robotAsset,
        id: "robot-gold",
        name: "鎏金机器人 · 变体",
        url: "/models/offline-robot.glb",
        color: "#d49b42",
        variant: {
          group: "robot-finish",
          label: "鎏金款",
        },
      });
      robotAsset.variant = {
        group: "robot-finish",
        label: "青瓷款",
      };

      const mini = base.entities.find((e) => e.id === "studio-mini")!;
      mini.guest = {
        visibility: "show",
        summary: "主力桌面工作站（访客公开简介）",
      };
      const nas = base.entities.find((e) => e.id === "home-nas")!;
      nas.guest = { visibility: "backdrop" };
      const plug = base.entities.find((e) => e.id === "desk-plug")!;
      plug.guest = { visibility: "hide" };
      const robot = base.entities.find((e) => e.id === "little-robot")!;
      robot.guest = {
        visibility: "show",
        summary: "桌面陪伴摆件",
      };

      privateUploadUrl = await admin.upload("private-note.png", "#4d5f59");
      albumUploadOne = await admin.upload("album-one.png", "#c9855a");
      albumUploadTwo = await admin.upload("album-two.png", "#4c8873");

      const hotspots: Hotspot[] = [
        {
          id: "hs-envelope",
          label: "桌角的一封信",
          audience: "guest-and-admin",
          anchor: {
            kind: "entity",
            entityId: "studio-mini",
            offset: [0, 0.52, 0],
          },
          visual: {
            icon: "mail",
            color: "#b65a44",
            size: "md",
            pulse: "beacon",
          },
          effect: {
            kind: "envelope",
            title: "给来访朋友的一封信",
            theme: "cream",
            sealText: "启",
            recipient: "远道而来的访客",
            sender: "屋主",
            date: "2026.11",
            body: "欢迎来到这个公开的 3D 小空间。\n\n这里保留了物件的位置与故事，隐藏了私人库存与后台控制。",
            signature: "Alex",
          },
        },
        {
          id: "hs-album",
          label: "空间拍立得相册",
          audience: "guest-only",
          anchor: {
            kind: "room",
            locationId: "study",
            position: [0.05, 0.72, -0.55],
          },
          visual: {
            icon: "camera",
            color: "#3d7a64",
            size: "md",
            pulse: "soft",
          },
          effect: {
            kind: "album",
            title: "工作室记录墙",
            subtitle: "拍立得与大图切换测试",
            layout: "polaroid",
            items: [
              {
                photo: albumUploadOne,
                caption: "第一张胶片",
                date: "2026-10",
                story: "秋日阳光照进书房。",
              },
              {
                photo: albumUploadTwo,
                caption: "第二张胶片",
                date: "2026-11",
                story: "重新整理了桌面布局。",
              },
            ],
          },
        },
        {
          id: "hs-link",
          label: "作者主页外链",
          audience: "guest-and-admin",
          anchor: {
            kind: "room",
            locationId: "living",
            position: [-0.4, 0.55, 0.5],
          },
          visual: {
            icon: "external-link",
            color: "#35688c",
            size: "md",
            pulse: "soft",
          },
          effect: {
            kind: "link",
            title: "主页笔记归档",
            url: "https://example.com/atelier",
            description: "点击卡片中的按钮前往外部站点。",
            buttonLabel: "立即前往",
            openMode: "card",
          },
        },
        {
          id: "hs-iframe",
          label: "内嵌互动卡片",
          audience: "guest-and-admin",
          anchor: {
            kind: "room",
            locationId: "living",
            position: [0.15, 0.6, -0.45],
          },
          visual: {
            icon: "app-window",
            color: "#58569c",
            size: "md",
            pulse: "soft",
          },
          effect: {
            kind: "iframe",
            title: "内嵌外部小页面",
            url: "https://example.com/embed",
            description: "演示懒加载单个外部页面与原页回退入口。",
            aspectRatio: "16:9",
          },
        },
        {
          id: "hs-spotlight",
          label: "角落特写导览",
          audience: "guest-and-admin",
          anchor: {
            kind: "entity",
            entityId: "little-robot",
            offset: [-0.28, 0.65, 0.1],
          },
          visual: {
            icon: "sparkles",
            color: "#b67c2c",
            size: "lg",
            pulse: "beacon",
          },
          effect: {
            kind: "spotlight",
            title: "客厅小机器人角落",
            story: "这个视角会自动拉近到客厅小机器人附近，关闭后恢复全局视角。",
            targetEntityId: "little-robot",
            cameraOffset: [4, 3, 4],
            zoom: 2.1,
          },
        },
        {
          id: "hs-variant",
          label: "切换桌面彩蛋外观",
          audience: "guest-and-admin",
          anchor: {
            kind: "entity",
            entityId: "little-robot",
            offset: [0.28, 0.65, 0.1],
          },
          visual: {
            icon: "lightbulb",
            color: "#8c4a6e",
            size: "md",
            pulse: "soft",
          },
          effect: {
            kind: "variant",
            title: "换个涂装试试",
            entityId: "little-robot",
            assetIds: ["robot", "robot-gold"],
          },
        },
        {
          id: "hs-admin-draft",
          label: "管理员草稿私密点",
          audience: "admin-only",
          anchor: {
            kind: "room",
            locationId: "study",
            position: [0, 0.4, 0.6],
          },
          visual: {
            icon: "book",
            color: "#4c5c56",
            size: "sm",
            pulse: "static",
          },
          effect: {
            kind: "envelope",
            title: "不应该暴露给访客",
            theme: "night",
            body: "Admin draft content",
          },
        },
      ];
      base.hotspots = hotspots;
      base.guestTitle = "Alex 的公开三维空间";
      base.guestSubtitle = "访客导览 · 点亮光晕触发故事";
      await admin.send({ type: "template.import", template: base });
    } finally {
      await adminCtx.dispose();
    }
  });

  test.afterAll(async ({ playwright }) => {
    const adminCtx = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    try {
      const admin = await adminSession(adminCtx);
      const templates: HomeTemplate[] = await (
        await adminCtx.get("/api/templates")
      ).json();
      const studio =
        templates.find((item) => item.id === "studio") ?? templates[0];
      await admin.send({ type: "template.import", template: studio });
    } finally {
      await adminCtx.dispose();
    }
  });

  test("unauthenticated root exposes guest showcase only, enforces 403 isolation and object visibility", async ({
    page,
  }) => {
    const requestedUrls: string[] = [];
    page.on("request", (req) => {
      requestedUrls.push(new URL(req.url()).pathname);
    });

    await page.goto("/");
    await expect(page.locator('[data-mode="guest"]')).toBeVisible();
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-frames",
      /\d+/,
    );
    await expect(page.locator(".guest-brand-pill strong")).toHaveText(
      "Alex 的公开三维空间",
    );

    // Zero admin bundles or privileged endpoints requested on unauthenticated `/`
    expect(
      requestedUrls.some(
        (u) =>
          u.includes("dashboard-") ||
          u.includes("cyber-view") ||
          u.includes("world-workspace") ||
          u === "/api/state" ||
          u === "/api/events/stream" ||
          u === "/mcp",
      ),
    ).toBe(false);

    // Every admin/private endpoint and un-whitelisted asset returns 403
    for (const path of [
      "/api/state",
      "/api/export",
      "/api/command-schema",
      "/api/templates",
      "/api/icons",
      "/api/providers",
      "/api/assets/imports",
      "/mcp",
      "/inspector.html",
      "/demo/service",
      "/generated/manifest.json",
      "/icons/services/docker.svg",
      privateUploadUrl,
      privateUploadUrl.replace("/api/uploads/", "/api/guest/uploads/"),
      albumUploadOne,
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), `Expected 403 for ${path}`).toBe(403);
    }

    const cmdRes = await page.request.post("/api/commands", {
      data: { operationId: "x", expectedRevision: 0, issuedAt: "", action: {} },
    });
    expect(cmdRes.status()).toBe(403);

    // Whitelisted guest upload works via /api/guest/uploads/:id only
    const guestImgPath = albumUploadOne.replace(
      "/api/uploads/",
      "/api/guest/uploads/",
    );
    const guestImgRes = await page.request.get(guestImgPath);
    expect(guestImgRes.status()).toBe(200);

    // Verify guest state payload strips private internals and hidden entities
    const guestRes = await page.request.get("/api/guest/state");
    expect(guestRes.status()).toBe(200);
    const guest = (await guestRes.json()) as GuestDashboard &
      Record<string, unknown>;
    expect(guest.home.name).toBe("Alex 的公开三维空间");
    expect("stocks" in guest.home).toBe(false);
    expect("services" in guest.home).toBe(false);
    expect("electrical" in guest.home).toBe(false);
    expect("cyber" in guest.home).toBe(false);
    expect(
      guest.home.rooms.some(
        (r) =>
          r.id === "remote" ||
          r.id === "unplaced" ||
          r.kind === "remote" ||
          r.kind === "unplaced",
      ),
    ).toBe(false);
    expect(guest.home.entities.some((e) => e.id === "desk-plug")).toBe(false);
    expect(guest.home.hotspots.some((h) => h.id === "hs-admin-draft")).toBe(
      false,
    );

    // Verify pickable entities respect show vs backdrop vs hide
    const pickable =
      (await page.locator(".guest-viewport").getAttribute("data-pickable")) ??
      "";
    expect(pickable).toContain("studio-mini");
    expect(pickable).toContain("little-robot");
    expect(pickable).not.toContain("home-nas");
    expect(pickable).not.toContain("desk-plug");
    expect(pickable).not.toContain("cloud-node");
    expect(pickable).not.toContain("cat-litter");

    // Clicking a `show` entity focuses the camera and opens only the minimal focus pill
    const miniScreen = await projectGuestEntity(page, "studio-mini");
    await page.mouse.click(miniScreen.x, miniScreen.y);
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-inspecting",
      "studio-mini",
    );
    await expect(page.locator(".guest-focus-pill")).toContainText(
      "Studio mini",
    );
    await expect(page.locator(".guest-focus-pill")).toContainText(
      "主力桌面工作站（访客公开简介）",
    );
    await expect(
      page.locator(".dock, .drawer, .object-item, .service-frame"),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "正面查看" }).click();
    await page.getByRole("button", { name: "返回全景" }).click();
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-inspecting",
      "",
    );

    // Clicking a `backdrop` entity does not focus or select anything
    const nasScreen = await projectGuestEntity(page, "home-nas");
    await page.mouse.click(nasScreen.x, nasScreen.y);
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-inspecting",
      "",
    );
    await expect(page.locator(".guest-focus-pill")).toHaveCount(0);
  });

  test("all 6 built-in interactive hotspot effects operate natively in guest mode", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route("https://example.com/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><body><h1>Mock External Widget</h1></body></html>",
      }),
    );

    await page.goto("/");
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-hotspots",
      "6",
    );
    await expect(page.locator(".scene-hotspot-pin")).toHaveCount(6);
    await expect(
      page.locator('.scene-hotspot-pin[data-hotspot-id="hs-admin-draft"]'),
    ).toHaveCount(0);

    // Capture desktop overview screenshot
    await page.screenshot({
      path: info.outputPath("guest-1440.png"),
      fullPage: true,
    });

    // 1. Envelope (wax seal unlock -> reveal letter body -> close)
    await page
      .locator('.scene-hotspot-pin[data-hotspot-id="hs-envelope"]')
      .click();
    await expect(
      page.getByRole("dialog", { name: "给来访朋友的一封信" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "拆开信封" }).click();
    await expect(page.locator(".letter-sheet")).toContainText(
      "欢迎来到这个公开的 3D 小空间",
    );
    await expect
      .poll(async () =>
        page
          .locator(".letter-sheet")
          .evaluate((el) => getComputedStyle(el).opacity),
      )
      .toBe("1");
    await page.screenshot({
      path: info.outputPath("guest-envelope-open.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "收起返回空间" }).click();

    // 2. Album (polaroid grid + lightbox switch + loaded guest uploads)
    await page
      .locator('.scene-hotspot-pin[data-hotspot-id="hs-album"]')
      .click();
    await expect(page.locator(".polaroid-card")).toHaveCount(2);
    await expect
      .poll(async () =>
        page
          .locator(".polaroid-card img")
          .first()
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.locator(".polaroid-card").first().click();
    await expect(page.locator(".album-caption")).toContainText("第一张胶片");
    await page.getByRole("button", { name: "下一张" }).click();
    await expect(page.locator(".album-caption")).toContainText("第二张胶片");
    await page.getByRole("button", { name: "关闭窗口" }).click();

    // 3. Link card
    await page.locator('.scene-hotspot-pin[data-hotspot-id="hs-link"]').click();
    await expect(page.locator(".hotspot-domain-pill")).toContainText(
      "example.com",
    );
    await expect(page.locator("a.hotspot-url-pill")).toHaveAttribute(
      "href",
      "https://example.com/atelier",
    );
    await expect(page.locator("a.hotspot-url-pill")).toContainText(
      "https://example.com/atelier",
    );
    const extLink = page.locator("a.hotspot-primary-btn");
    await expect(extLink).toHaveAttribute(
      "href",
      "https://example.com/atelier",
    );
    await expect(extLink).toHaveAttribute("target", "_blank");
    await page.getByRole("button", { name: "关闭窗口" }).click();

    // 4. Lazy single iframe (never mounted before click)
    await expect(page.locator("iframe.hotspot-iframe")).toHaveCount(0);
    await page
      .locator('.scene-hotspot-pin[data-hotspot-id="hs-iframe"]')
      .click();
    const frame = page.locator("iframe.hotspot-iframe");
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute("src", "https://example.com/embed");
    await expect(
      page.getByRole("link", { name: "在新窗口打开原页" }),
    ).toHaveAttribute("href", "https://example.com/embed");
    await page.getByRole("button", { name: "关闭窗口" }).click();
    await expect(page.locator("iframe.hotspot-iframe")).toHaveCount(0);

    // 5. Spotlight camera tour + restoreView on close
    const beforeCam = await page
      .locator(".guest-viewport")
      .getAttribute("data-camera");
    const beforeZoom = Number(
      await page.locator(".guest-viewport").getAttribute("data-zoom"),
    );
    await page
      .locator('.scene-hotspot-pin[data-hotspot-id="hs-spotlight"]')
      .click();
    await expect(page.locator(".spotlight-dock")).toBeVisible();
    await expect
      .poll(async () =>
        Number(await page.locator(".guest-viewport").getAttribute("data-zoom")),
      )
      .toBeCloseTo(2.1, 1);
    await page.getByRole("button", { name: "关闭导览" }).click();
    await expect
      .poll(async () =>
        Number(await page.locator(".guest-viewport").getAttribute("data-zoom")),
      )
      .toBeCloseTo(beforeZoom, 1);
    await expect(page.locator(".guest-viewport")).toHaveAttribute(
      "data-camera",
      beforeCam!,
    );

    // 6. Variant switcher (local visitor preview only, zero server mutation)
    const serverBefore = (await (
      await page.request.get("/api/guest/state")
    ).json()) as GuestDashboard;
    await page
      .locator('.scene-hotspot-pin[data-hotspot-id="hs-variant"]')
      .click();
    await expect(page.locator(".guest-toast")).toContainText("仅本次浏览生效");
    const serverAfter = (await (
      await page.request.get("/api/guest/state")
    ).json()) as GuestDashboard;
    expect(serverAfter.revision).toBe(serverBefore.revision);
    expect(
      serverAfter.home.entities.find((e) => e.id === "little-robot")?.assetId,
    ).toBe("robot");
  });

  test("typewriter envelope skips to full body and popup spotlight card renders floating modal", async ({
    page,
    playwright,
  }) => {
    const adminCtx = await playwright.request.newContext({
      baseURL: "http://127.0.0.1:4173",
    });
    const admin = await adminSession(adminCtx);
    await admin.send({
      type: "hotspot.upsert",
      hotspot: {
        id: "hs-e2e-typewriter",
        label: "打字机信件测试",
        audience: "guest-only",
        anchor: { kind: "room", locationId: "study", position: [0.3, 0.7, 0.2] },
        visual: { icon: "mail", color: "#b65a44", size: "md", pulse: "beacon" },
        effect: {
          kind: "envelope",
          title: "测试打字机来信",
          theme: "cream",
          typewriter: true,
          typingDurationSeconds: 18,
          body: "第一段话。\n\n第二段还有不少内容，用来确保点击跳过之前不会瞬间全部打完。",
        },
      },
    });
    await admin.send({
      type: "hotspot.upsert",
      hotspot: {
        id: "hs-e2e-popup",
        label: "弹窗亮点测试",
        audience: "guest-only",
        anchor: { kind: "room", locationId: "living", position: [0.4, 0.7, 0.2] },
        visual: { icon: "sparkles", color: "#3d7a64", size: "md", pulse: "soft" },
        effect: {
          kind: "spotlight",
          title: "空气监测",
          badge: "空气传感器",
          presentation: "popup",
          story: "当前环境温度24，湿度55%，空气质量优，阳光热烈，风也温柔",
          targetEntityId: "little-robot",
        },
      },
    });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/");
      await page.locator('.guest-viewport[data-frames]').waitFor();

      await page
        .locator('.scene-hotspot-pin[data-hotspot-id="hs-e2e-typewriter"]')
        .click();
      await page.getByRole("button", { name: "拆开信封" }).click();
      await expect(page.locator(".typewriter-caret")).toBeVisible();
      await page.getByRole("button", { name: "跳过直接读全文" }).click();
      await page.waitForTimeout(250);
      await expect(page.locator(".letter-body")).toContainText(
        "第二段还有不少内容",
      );
      await expect(page.getByRole("button", { name: "重打一遍" })).toBeVisible();
      await page.getByRole("button", { name: "收起返回空间" }).click();

      await page
        .locator('.scene-hotspot-pin[data-hotspot-id="hs-e2e-popup"]')
        .click();
      await expect(page.locator(".spotlight-popup")).toBeVisible();
      await expect(page.locator(".spotlight-popup")).toContainText("空气传感器");
      await expect(page.locator(".spotlight-popup")).toContainText(
        "当前环境温度24，湿度55%，空气质量优，阳光热烈，风也温柔",
      );
      await page.getByRole("button", { name: "关闭导览" }).click();
    } finally {
      await admin.send({ type: "hotspot.delete", hotspotId: "hs-e2e-typewriter" });
      await admin.send({ type: "hotspot.delete", hotspotId: "hs-e2e-popup" });
      await adminCtx.dispose();
    }
  });

  test("admin login form, hotspot creation, visitor preview toggle, and logout", async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/admin/login");
    await expect(
      page.getByRole("heading", { name: "管理者入口" }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("admin-login.png"),
      fullPage: true,
    });

    // Reject wrong key first
    await page.getByLabel("管理员 Auth Key").fill("invalid-auth-key-check");
    await page.getByRole("button", { name: "进入管理工作台" }).click();
    await expect(page.getByRole("alert")).toBeVisible();

    // Valid key unlocks `/` into full Admin Workbench
    await page.getByLabel("管理员 Auth Key").fill(e2eAdminKey);
    await page.getByRole("button", { name: "进入管理工作台" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("button", { name: "打开共在中枢" }),
    ).toBeVisible();

    // Admin has full state access and WebMCP/dock UI
    const stateRes = await page.request.get("/api/state");
    expect(stateRes.status()).toBe(200);

    // Open HotspotManager from menu and create a hotspot through the UI
    await page.getByRole("button", { name: "打开共在中枢" }).click();
    await page.getByRole("button", { name: /交互光晕点/ }).click();
    await expect(
      page.getByRole("heading", { name: "交互光晕点管理" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "新建光晕点" }).click();
    await page.getByLabel("悬停标签名称").fill("UI 新建测试点");
    await page.getByRole("button", { name: "保存交互点" }).click();
    await expect(
      page.locator(".hotspot-admin-row").filter({ hasText: "UI 新建测试点" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭面板" }).click();

    // Reload and verify created hotspot persists, then delete it cleanly
    await page.reload();
    await expect(
      page.locator(".scene-hotspot-pin").filter({ hasText: "UI 新建测试点" }),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "打开共在中枢" }).click();
    await page.getByRole("button", { name: /交互光晕点/ }).click();
    await page.getByRole("button", { name: "删除 UI 新建测试点" }).click();
    await expect(
      page.locator(".hotspot-admin-row").filter({ hasText: "UI 新建测试点" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "关闭面板" }).click();

    // Toggle live visitor preview from Admin menu and return cleanly
    await page.getByRole("button", { name: "打开共在中枢" }).click();
    await page.getByRole("button", { name: /访客视角预览/ }).click();
    await expect(page.locator(".guest-preview-banner")).toContainText(
      "访客视角预览中",
    );
    await expect(
      page.locator('.scene-hotspot-pin[data-hotspot-id="hs-admin-draft"]'),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "退出预览" }).click();
    await expect(
      page.getByRole("button", { name: "打开共在中枢" }),
    ).toBeVisible();

    // Logout strips admin session and returns `/` to guest showcase
    await page.getByRole("button", { name: "打开共在中枢" }).click();
    await page.getByRole("button", { name: "退出管理员登录" }).click();
    await expect(page.locator('[data-mode="guest"]')).toBeVisible();
    const afterLogoutSession = await (
      await page.request.get("/api/session")
    ).json();
    expect(afterLogoutSession.role).toBe("guest");
    expect((await page.request.get("/api/state")).status()).toBe(403);
  });

  for (const [name, width, height] of [
    ["guest-768", 768, 1024],
    ["guest-390", 390, 844],
  ] as const) {
    test(`guest showcase layout remains usable and clip-free at ${width}px`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      await expect(page.locator(".guest-viewport")).toHaveAttribute(
        "data-frames",
        /\d+/,
      );
      await expect(page.locator(".scene-hotspot-pin")).toHaveCount(6);

      const layout = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        launcher: document
          .querySelector(".guest-launcher")!
          .getBoundingClientRect(),
        brand: document
          .querySelector(".guest-brand-pill")!
          .getBoundingClientRect(),
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth);
      expect(layout.launcher.right).toBeLessThanOrEqual(width);
      expect(layout.brand.right).toBeLessThanOrEqual(width);

      await page.screenshot({
        path: info.outputPath(`${name}.png`),
        fullPage: true,
      });

      // Verify modal fits cleanly without horizontal overflow on narrow viewport
      await page
        .locator('.scene-hotspot-pin[data-hotspot-id="hs-envelope"]')
        .click();
      const dialogBox = await page.locator(".hotspot-dialog").boundingBox();
      expect(dialogBox).toBeTruthy();
      expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width + 1);

      if (width === 390) {
        await page.getByRole("button", { name: "拆开信封" }).click();
        await expect
          .poll(async () =>
            page
              .locator(".letter-sheet")
              .evaluate((el) => getComputedStyle(el).opacity),
          )
          .toBe("1");
        await page.screenshot({
          path: info.outputPath("guest-390-envelope.png"),
          fullPage: true,
        });
      }
      await page.getByRole("button", { name: "收起返回空间" }).click();

      // Open explore menu cleanly on responsive widths
      await page.getByRole("button", { name: "打开共在导览" }).click();
      await expect(page.locator(".guest-menu-panel")).toBeVisible();
      const menuBox = await page.locator(".guest-menu-panel").boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width + 1);
    });
  }
});
