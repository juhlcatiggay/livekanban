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

test("#13 a single Enter in a description is a line break", async ({ page }) => {
  await createBoard(page);
  const todo = page.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Lines");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  await page.getByRole("button", { name: /^Lines\. Press Enter/ }).click();
  await page.getByRole("dialog").getByLabel("Description").fill("first line\nsecond line");
  await page.getByRole("dialog").getByRole("tab", { name: "preview" }).click();

  const preview = page.getByRole("dialog").getByRole("region", { name: "Description preview" });
  await expect(preview.locator("br")).toHaveCount(1);
  expect(await preview.innerText()).toBe("first line\nsecond line");
});

test("#6 sticky notes render Markdown", async ({ page }) => {
  await createBoard(page);
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note text").fill("# Agenda\n**Demo** at 10\nSee https://example.com\n<script>window.__xss = 1</script>");
  await page.getByLabel("Note text").press("Escape");

  const note = page.getByRole("group", { name: /^Note: # Agenda/ });
  await expect(note.getByRole("heading", { name: "Agenda" })).toBeVisible();
  await expect(note.locator("strong")).toHaveText("Demo");
  await expect(note.getByRole("link", { name: "https://example.com" })).toHaveAttribute("rel", /nofollow/);
  await expect(note.locator("script")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  // Clicking a link in a note follows it rather than starting a drag.
  const [popup] = await Promise.all([page.waitForEvent("popup"), note.getByRole("link").click()]);
  expect(popup.url()).toContain("example.com");
});
