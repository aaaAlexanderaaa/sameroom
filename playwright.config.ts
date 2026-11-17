import { defineConfig } from "@playwright/test";
import { e2eAdminKey } from "./tests/browser/auth.js";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    viewport: { width: 1440, height: 960 },
    headless: true,
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx scripts/test-server.ts",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    env: {
      ...process.env,
      DASH_ADMIN_KEY: e2eAdminKey,
    },
  },
});
