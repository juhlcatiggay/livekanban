import { expect, test, type Page } from "@playwright/test";

// Regression tests for GitHub issues, named by issue number.

async function createBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

const isOpen = (page: Page, label: string) =>
  page.getByLabel(label).evaluate((summary) => (summary.parentElement as HTMLDetailsElement).open);

test("#9 the column options menu closes on an outside click and on Escape", async ({ page }) => {
  await createBoard(page);
  const options = page.getByLabel("Column To do options");

  await options.click();
  await expect(page.getByRole("button", { name: "Delete column" })).toBeVisible();
  await page.getByRole("button", { name: /^Rename board title/ }).hover();
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(() => isOpen(page, "Column To do options")).toBe(false);

  await options.click();
  await expect.poll(() => isOpen(page, "Column To do options")).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(() => isOpen(page, "Column To do options")).toBe(false);
  await expect(options).toBeFocused();

  // Opening another menu closes the first.
  await options.click();
  await page.getByLabel("Column Done options").click();
  await expect.poll(() => isOpen(page, "Column To do options")).toBe(false);
  await expect.poll(() => isOpen(page, "Column Done options")).toBe(true);
});

test("#11 Create board works again after going back to the landing page", async ({ page }) => {
  await createBoard(page);
  const first = page.url();
  await page.goBack();
  await page.waitForURL((url) => url.pathname === "/");

  const button = page.getByRole("button", { name: "Create board" });
  await expect(button).toBeEnabled();
  await button.click();
  await page.waitForURL((url) => /\/b\/[A-Za-z0-9_-]{21}$/.test(url.pathname) && url.href !== first);
});
