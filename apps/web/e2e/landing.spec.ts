import { expect, test, type Page } from "@playwright/test";

// The landing page's try-it board: drag only, nothing saved.

const column = (page: Page, title: string) => page.getByRole("region", { name: `Demo column ${title}` });
const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(`^${title}\. Press Space`) });

test("visitors can drag the demo cards from To Do to Doing to Done", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/");
  const demo = page.getByRole("group", { name: /^Try it/ });
  await demo.scrollIntoViewIfNeeded();
  await expect(demo).toBeInViewport();

  // Pointer: To Do → Doing.
  const from = (await card(page, "Pick a domain").boundingBox())!;
  const to = (await column(page, "Doing").boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height - 12, { steps: 15 });
  await page.mouse.up();
  await expect(column(page, "Doing").getByRole("button", { name: /^Pick a domain/ })).toBeVisible();
  await expect(column(page, "To Do").getByRole("button", { name: /^Pick a domain/ })).toHaveCount(0);

  // Keyboard: Doing → Done.
  await card(page, "Pick a domain").focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: /^Picked up|was moved over/ })).toBeAttached();
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(150);
  await page.keyboard.press("Space");
  await expect(column(page, "Done").getByRole("button", { name: /^Pick a domain/ })).toBeVisible();

  // Nothing to edit; Reset puts everything back.
  await expect(demo.getByRole("textbox")).toHaveCount(0);
  await demo.getByRole("button", { name: "Reset" }).click();
  await expect(column(page, "To Do").getByRole("button", { name: /^Pick a domain/ })).toBeVisible();
  expect(errors.filter((e) => /hydrat/i.test(e))).toEqual([]);
});

test("over the demo, your cursor becomes a green \"You\" cursor that follows the pointer", async ({ page }) => {
  await page.goto("/");
  const demo = page.getByRole("group", { name: /^Try it/ });
  await demo.scrollIntoViewIfNeeded();
  const you = page.locator("[data-you-cursor]");
  await expect(you).toHaveCSS("opacity", "0");
  expect(await demo.evaluate((el) => getComputedStyle(el).cursor)).toBe("none");

  const box = (await demo.boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 150, { steps: 3 });
  await expect(you).toHaveCSS("opacity", "1");
  await expect(you).toContainText("You");
  const at = (await you.boundingBox())!;
  expect(Math.abs(at.x - (box.x + 199))).toBeLessThan(2);
  expect(Math.abs(at.y - (box.y + 149))).toBeLessThan(2);

  await page.mouse.move(box.x - 50, box.y - 50);
  await expect(you).toHaveCSS("opacity", "0");
});

test("in-page links scroll smoothly to their section", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("smooth");
  await page.getByRole("link", { name: "My boards" }).click();
  await expect(page.getByRole("heading", { name: "My boards." })).toBeInViewport();
});
