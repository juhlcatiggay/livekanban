import { expect, test, type Page } from "@playwright/test";

// #10 reference numbers and #9 mentions that glide to, shake and (for cards) open the target.

async function createBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

test("cards and notes get numbers, and #mentions jump between them", async ({ page }) => {
  await createBoard(page);

  // Note #1 on the bulletin.
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note text").fill("Agenda for Friday");
  await page.getByLabel("Note text").press("Escape");
  const note = page.getByRole("group", { name: /^Note: Agenda/ });
  await expect(note).toContainText("#1");

  // Card #2 mentions the note and a number that doesn't exist.
  await page.getByRole("tab", { name: "Kanban" }).click();
  const todo = page.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Spec");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  const card = page.getByRole("button", { name: /^Spec\. Press Enter/ });
  await expect(card).toContainText("#2");
  await card.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("#2");
  await dialog.getByRole("button", { name: "Add description" }).click();
  await dialog.getByLabel("Description").fill("See #1 and #99, but not `#1` in code.");
  await dialog.getByRole("button", { name: "Done" }).click();

  const preview = dialog.getByRole("region", { name: "Description preview" });
  await expect(preview.getByRole("link", { name: /#1 Agenda for Friday/ })).toBeVisible();
  await expect(preview.getByTitle("No card or note #99 on this board")).toBeVisible();
  await expect(preview.locator("code")).toHaveText("#1");

  // Card → note: switches to the bulletin and shakes the note.
  await preview.getByRole("link", { name: /#1 Agenda/ }).click();
  await expect(page.getByRole("tab", { name: /^Bulletin/ })).toHaveAttribute("aria-selected", "true");
  await expect(note).toHaveClass(/lk-shake/);

  // Note → card: back to the kanban, the card shakes first, then opens.
  await note.dblclick();
  await page.getByLabel("Note text").fill("Agenda for Friday\nBlocked by #2");
  await page.getByLabel("Note text").press("Escape");
  await note.getByRole("link", { name: /#2 Spec/ }).click();
  await expect(page.getByRole("tab", { name: "Kanban" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-anchor].lk-shake')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByLabel("Card title")).toHaveValue("Spec", { timeout: 3000 });
});
