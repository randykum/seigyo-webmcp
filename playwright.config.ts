import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ }
  ],
  webServer: [
    { command: "pnpm --filter @seigyo/api dev", url: "http://localhost:8787/", reuseExistingServer: true, timeout: 120_000 },
    { command: "pnpm --filter @seigyo/app exec vite --port 15173", url: "http://localhost:15173/", reuseExistingServer: true, timeout: 120_000 },
    { command: "pnpm --filter @seigyo/myshop dev", url: "http://localhost:5174/", reuseExistingServer: true, timeout: 120_000 }
  ]
});
