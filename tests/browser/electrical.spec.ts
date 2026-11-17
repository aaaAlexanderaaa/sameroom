import { test, expect } from "@playwright/test";
import type { HomeTemplate } from "../../shared/domain.js";
import { loginAdmin } from "./auth.js";

test("metered devices show persisted supply channels on demand without fake readings", async ({
  page,
}) => {
  const csrf = await loginAdmin(page);
  const state = await (await page.request.get("/api/state")).json();
  const template: HomeTemplate = (
    await (await page.request.get("/api/templates")).json()
  )[0];
  const base = template.entities.find((e) => e.id === "studio-mini")!;
  template.assets.push({
    id: "test-strip-asset",
    name: "Test strip",
    kind: "smart-strip",
    width: 0.28,
    height: 0.035,
    depth: 0.065,
    color: "#dddddd",
    provenance: "Offline test fixture",
  });
  template.entities.push({
    ...base,
    id: "test-strip",
    name: "测试独立计量插排",
    category: "device",
    assetId: "test-strip-asset",
    position: [0.6, 0.8, 0.2],
  });
  template.electricalCircuits = [
    {
      id: "test-circuit",
      name: "测试床头供电",
      controllerEntityId: "test-strip",
      metering: "per-outlet",
      channels: [{ id: "mini", name: "主机独立通道", entityIds: [base.id] }],
      source: "sample",
      asOf: "2026-11-13",
    },
  ];
  const response = await page.request.post("/api/commands", {
    headers: { "X-Session-Token": csrf },
    data: {
      operationId: crypto.randomUUID(),
      expectedRevision: state.revision,
      issuedAt: new Date().toISOString(),
      action: { type: "template.import", template },
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByTestId("home-viewport")).toHaveAttribute(
    "data-frames",
    /[1-9]/,
  );
  await expect(page.getByRole("region", { name: "供电与控制" })).toHaveCount(0);
  await page.keyboard.press("/");
  await page.getByLabel("搜索物件").fill("测试独立计量插排");
  await page
    .getByRole("dialog", { name: "物件与搜索" })
    .getByRole("button", { name: /测试独立计量插排/ })
    .click();
  const details = page.getByRole("region", { name: "供电与控制" });
  await expect(details).toContainText("每个插孔独立统计电量");
  await expect(details).toContainText("实体插孔编号待核对");
  await expect(details).toContainText("实时功率与累计电量尚未接入");
  await details.getByRole("button", { name: base.name, exact: true }).click();
  await expect(
    details.getByRole("button", { name: "查看测试独立计量插排" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const saved = await (await page.request.get("/api/state")).json();
  await page.reload();
  expect(await (await page.request.get("/api/state")).json()).toEqual(saved);
});
