import { expect, type Page } from "@playwright/test";

export const e2eAdminKey = "playwright-e2e-admin-key-20261116";

export async function loginAdmin(page: Page): Promise<string> {
  const existing = await page.request.get("/api/session");
  if (existing.ok()) {
    const info = (await existing.json()) as {
      role?: string;
      csrfToken?: string;
    };
    if (info.role === "admin" && info.csrfToken) return info.csrfToken;
  }
  const response = await page.request.post("/api/admin/login", {
    data: { key: e2eAdminKey },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as { csrfToken: string };
  return body.csrfToken;
}
