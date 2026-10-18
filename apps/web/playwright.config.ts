import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter worker exec wrangler dev --port 8787",
      port: 8787,
      reuseExistingServer: !CI,
    },
    {
      // CI builds first, so serve the production build there; use the dev server locally.
      command: CI ? "pnpm start" : "pnpm dev",
      port: 3000,
      reuseExistingServer: !CI,
      env: { NEXT_PUBLIC_PARTY_HOST: "localhost:8787" },
    },
  ],
});
