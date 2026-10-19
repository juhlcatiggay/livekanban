import { expect, test } from "@playwright/test";

// Appearance: System (default), Light or Dark, chosen once and kept everywhere.

const theme = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.dataset.theme);

test("appearance follows the system until you pick Light or Dark, and the choice sticks", async ({ browser }) => {
  const page = await (await browser.newContext({ colorScheme: "dark" })).newPage();
  await page.goto("/");
  expect(await theme(page)).toBe("dark");
  await expect(page.getByRole("button", { name: "Match system appearance" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Light appearance" }).click();
  expect(await theme(page)).toBe("light");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(245, 245, 247)");

  // Kept across pages and reloads, applied before the page paints.
  await page.goto("/new");
  expect(await theme(page)).toBe("light");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\//);
  expect(await theme(page)).toBe("light");
  await expect(page.getByRole("button", { name: "Light appearance" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Dark appearance" }).click();
  expect(await theme(page)).toBe("dark");
  await page.reload();
  expect(await theme(page)).toBe("dark");

  await page.getByRole("button", { name: "Match system appearance" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => theme(page)).toBe("light");
});
