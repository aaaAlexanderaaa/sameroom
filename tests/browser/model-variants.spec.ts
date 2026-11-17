import { test, expect } from "@playwright/test";
import type { Action, Dashboard, HomeTemplate } from "../../shared/domain.js";
import { loginAdmin } from "./auth.js";

test("primary models render in overview and appearance switching preserves identity across reload", async ({
  page,
}) => {
  const csrf = await loginAdmin(page);
  await page.goto("/");
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-frames",
    /\d+/,
  );
  const state = async (): Promise<Dashboard> =>
    (await page.request.get("/api/state")).json();
  const send = async (action: Action) => {
    const response = await page.request.post("/api/commands", {
      headers: { "X-Session-Token": csrf },
      data: {
        operationId: crypto.randomUUID(),
        expectedRevision: (await state()).revision,
        issuedAt: new Date().toISOString(),
        action,
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const templates: HomeTemplate[] = await (
    await page.request.get("/api/templates")
  ).json();
  const template = templates.find((h) => h.id === "studio")!;
  const original = template.assets.find((a) => a.id === "mini")!;
  // Fixture geometry is deliberately unrelated to the appearance labels.
  const variants = ["on", "off"].map((label) => ({
    ...original,
    id: `fixture-${label}`,
    url: "/models/offline-robot.glb",
    variant: {
      group: "fixture-computer",
      label: label === "on" ? "开机外观" : "关机外观",
    },
  }));
  template.assets.push(...variants);
  template.entities.find((e) => e.id === "studio-mini")!.assetId =
    variants[0].id;
  await send({ type: "template.import", template });
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-model-entities",
    /studio-mini/,
  );
  const before = await state();
  await page.keyboard.press("/");
  await page.locator(".object-item").filter({ hasText: "Studio mini" }).click();
  await page.locator(".model-tools summary").click();
  await page.getByRole("button", { name: "关机外观", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "关机外观", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const after = await state();
  const entityBefore = before.home.entities.find(
    (e) => e.id === "studio-mini",
  )!;
  expect(after.home.entities.find((e) => e.id === "studio-mini")).toEqual({
    ...entityBefore,
    assetId: variants[1].id,
  });
  expect(after.home.services).toEqual(before.home.services);
  await page.reload();
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-model-entities",
    /studio-mini/,
  );
  await page.keyboard.press("/");
  await page.locator(".object-item").filter({ hasText: "Studio mini" }).click();
  await page.locator(".model-tools summary").click();
  await expect(
    page.getByRole("button", { name: "关机外观", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const exported = await (await page.request.get("/api/export")).json();
  expect(
    exported.assets.filter(
      (a: { variant?: { group: string } }) =>
        a.variant?.group === "fixture-computer",
    ),
  ).toEqual(variants);
  // A failed replacement must retain its authored fallback and clear the old loaded marker.
  await send({
    type: "asset.upsert",
    asset: { ...variants[1], url: "/models/missing-variant.glb" },
  });
  await expect(page.locator(".home-viewport")).not.toHaveAttribute(
    "data-model-entities",
    /studio-mini/,
  );
  await expect(page.locator(".home-viewport")).toHaveAttribute(
    "data-pickable",
    /studio-mini/,
  );
});
