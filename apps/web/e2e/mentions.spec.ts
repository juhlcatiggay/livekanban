import { expect, test, type Page } from "@playwright/test";

// Reference numbers, and mentions picked from the # list that glide to, shake and (for cards) open the target.
// Typed text like "Top #1 Fan" is never a mention.

async function createBoard(page: Page) {
  await page.goto("/new");
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
  const description = dialog.getByLabel("Description");
  // "#1" and an email address are just text; "@" opens the picker.
  const picker = dialog.getByRole("listbox", { name: "Mention a card or note" });
  await description.pressSequentially("Top #1 Fan, mail ada@example.com.");
  await expect(picker).toHaveCount(0);
  await description.pressSequentially(" See @");
  await expect(picker.getByRole("option", { name: /#1 Agenda for Friday/ })).toBeVisible();
  await description.pressSequentially("agen");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await description.press("Enter");
  await expect(picker).toHaveCount(0);
  await expect(description).toHaveValue("Top #1 Fan, mail ada@example.com. See [@1](#1)");
  // The toolbar's @ button opens the same list; Escape closes only the list.
  await description.pressSequentially(" and ");
  await dialog.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name: "Mention a card or note" }).click();
  await expect(picker.getByRole("option")).toHaveCount(2);
  await description.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Done" }).click();

  const preview = dialog.getByRole("region", { name: "Description preview" });
  await expect(preview.locator(".md-mention")).toHaveCount(1);
  await expect(preview.getByRole("link", { name: /#1 Agenda for Friday/ })).toBeVisible();
  await expect(preview).toContainText("Top #1 Fan,");

  // Card → note: switches to the bulletin and shakes the note.
  await preview.getByRole("link", { name: /#1 Agenda/ }).click();
  await expect(page.getByRole("tab", { name: /^Bulletin/ })).toHaveAttribute("aria-selected", "true");
  await expect(note).toHaveClass(/lk-shake/);

  // Note → card: back to the kanban, the card shakes first, then opens.
  await note.dblclick();
  await page.getByLabel("Note text").fill("Agenda for Friday\nBlocked by ");
  await page.getByLabel("Note text").pressSequentially("@2");
  await page.getByRole("option", { name: /#2 Spec/ }).click();
  await page.getByLabel("Note text").press("Escape");
  await note.getByRole("link", { name: /#2 Spec/ }).click();
  await expect(page.getByRole("tab", { name: "Kanban" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-anchor].lk-shake')).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByLabel("Card title")).toHaveValue("Spec", { timeout: 3000 });
});
