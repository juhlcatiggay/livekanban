import { defineConfig, devices } from "@playwright/test";

const CI = !!process.env.CI;

// Dedicated ports so e2e never reuses (or fights with) a `pnpm dev` session on 3000/8787.
const WEB_PORT = 3100;
const WORKER_PORT = 8797;
const PARTY_HOST = `localhost:${WORKER_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `pnpm --filter worker exec wrangler dev --port ${WORKER_PORT} --var ALLOWED_ORIGINS:http://localhost:${WEB_PORT} --var CREATE_LIMIT_PER_HOUR:100000 --var TURNSTILE_SECRET:`,
      port: WORKER_PORT,
      reuseExistingServer: false,
    },
    {
      // CI builds in an earlier step (with the same PARTY_HOST); locally build first.
      command: CI ? `pnpm start --port ${WEB_PORT}` : `pnpm build && pnpm start --port ${WEB_PORT}`,
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 180_000,
      // Empty overrides any real key in .env.local, so tests never face a Turnstile challenge.
      env: { NEXT_PUBLIC_PARTY_HOST: PARTY_HOST, NEXT_PUBLIC_TURNSTILE_SITE_KEY: "" },
    },
  ],
});
