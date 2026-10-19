import { expect, test, type Browser, type Page } from "@playwright/test";

// Formatting toolbar, images, checklists, label chips and colors, start dates,
// box selection with multi-card drag, and deleting a board.

async function createBoard(page: Page) {
  await page.goto("/new");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

async function visitor(browser: Browser, url: string) {
  const page = await (await browser.newContext()).newPage();
  await page.goto(url);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  return page;
}

const column = (page: Page, title: string) => page.getByRole("region", { name: `Column ${title}` });
const card = (scope: Page | ReturnType<typeof column>, title: string) =>
  scope.getByRole("button", { name: new RegExp(`^${title}( \\(selected\\))?\\. Press Enter`) });

async function addCard(page: Page, columnTitle: string, title: string) {
  const col = column(page, columnTitle);
  await col.getByRole("button", { name: "+ Add card" }).click();
  await col.getByLabel("New card title").fill(title);
  await col.getByLabel("New card title").press("Enter");
  await expect(card(col, title)).toBeVisible();
  await col.getByLabel("New card title").press("Escape");
}

const settled = (page: Page) => page.waitForTimeout(600);

/** A tiny PNG served for any image from img.example, so tests never leave the machine. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("the toolbar formats selected text, and images are added by link", async ({ page }) => {
  await page.route("https://img.example/**", (route) => route.fulfill({ contentType: "image/png", body: PNG }));
  await createBoard(page);
  await addCard(page, "To do", "Pretty");
  await card(page, "Pretty").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add description" }).click();
  const text = dialog.getByLabel("Description");
  const toolbar = dialog.getByRole("toolbar", { name: "Formatting" });

  await text.fill("make this loud");
  await text.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(10, 14));
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(text).toHaveValue("make this **loud**");
  await toolbar.getByRole("button", { name: "Checklist" }).click();
  await expect(text).toHaveValue("- [ ] make this **loud**");

  await text.press("End");
  await text.press("Enter");
  await toolbar.getByRole("button", { name: "Image" }).click();
  const insert = dialog.getByRole("dialog", { name: "Insert image" });
  await insert.getByLabel("Image address (URL)").fill("https://img.example/cat.png");
  await insert.getByLabel("Description (for screen readers)").fill("A cat");
  await insert.getByRole("button", { name: "Insert" }).click();
  await expect(text).toHaveValue("- [ ] make this **loud**\n![A cat](https://img.example/cat.png)");
  await dialog.getByRole("button", { name: "Done" }).click();

  // Images wait for a click; "Always load" remembers the site and shows a cover on the card.
  const preview = dialog.getByRole("region", { name: "Description preview" });
  await expect(preview.locator("strong")).toHaveText("loud");
  await expect(preview.getByRole("img", { name: "A cat" })).toHaveCount(0);
  await preview.getByRole("button", { name: "Always load from img.example" }).click();
  await expect(preview.getByRole("img", { name: "A cat" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(card(page, "Pretty").getByRole("img", { name: "A cat" })).toBeVisible();
});

test("checklist progress shows on the card, and two people's ticks both count", async ({ browser }) => {
  const ada = await (await browser.newContext()).newPage();
  await createBoard(ada);
  await addCard(ada, "To do", "Release");
  await card(ada, "Release").click();
  const dialog = ada.getByRole("dialog");
  const add = dialog.getByLabel("Add checklist item");
  for (const item of ["Write notes", "Tag build", "Announce"]) {
    await add.fill(item);
    await add.press("Enter");
  }
  await expect(dialog.getByRole("list", { name: "Checklist items" }).getByRole("listitem")).toHaveCount(3);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(card(ada, "Release").getByRole("img", { name: "Checklist: 0 of 3 done" })).toBeVisible();

  const bob = await visitor(browser, ada.url());
  await card(ada, "Release").click();
  await card(bob, "Release").click();
  await ada.getByRole("dialog").getByRole("checkbox", { name: "Write notes" }).check();
  await bob.getByRole("dialog").getByRole("checkbox", { name: "Announce" }).check();
  await expect(bob.getByRole("dialog").getByRole("checkbox", { name: "Write notes" })).toBeChecked();
  await expect(ada.getByRole("dialog").getByText("2 of 3")).toBeVisible();
  await ada.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await bob.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(card(bob, "Release")).toContainText("☑ 2/3");

  await settled(ada);
  await ada.reload();
  await expect(card(ada, "Release").getByRole("img", { name: "Checklist: 2 of 3 done" })).toBeVisible();
});

test("labels become chips at each comma and keep one color across the board", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "To do", "First");
  await addCard(page, "Doing", "Second");

  await card(page, "First").click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add label").pressSequentially("Bug,design,");
  await expect(dialog.getByRole("button", { name: "Remove label Bug" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Remove label design" })).toBeVisible();
  await expect(dialog.getByLabel("Add label")).toHaveValue("");
  // Pick a color for "Bug": every card shows it.
  await dialog.getByRole("button", { name: "Color of label Bug" }).click();
  await dialog.getByRole("button", { name: "Pink label" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();

  await card(page, "Second").click();
  dialog = page.getByRole("dialog");
  // The board's spelling is reused, so "bug" joins the same label.
  await dialog.getByLabel("Add label").fill("bug");
  await dialog.getByLabel("Add label").press("Enter");
  await expect(dialog.getByRole("button", { name: "Remove label Bug" })).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();

  const chipClass = (title: string) =>
    card(page, title).getByRole("list", { name: "Labels" }).getByText("Bug", { exact: true }).getAttribute("class");
  expect(await chipClass("First")).toContain("bg-pink-100");
  expect(await chipClass("Second")).toContain("bg-pink-100");
  const design = await card(page, "First").getByRole("list", { name: "Labels" }).getByText("design").getAttribute("class");
  expect(design).toMatch(/bg-(red|amber|green|teal|blue|purple|pink)-100/);
});

test("a start date shows on the card and in the calendar", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "To do", "Sprint");
  await card(page, "Sprint").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Start date").fill("2026-11-02");
  await dialog.getByLabel("Due date").fill("2026-11-13");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(card(page, "Sprint")).toContainText("2 Nov – 13 Nov");

  await page.getByRole("tab", { name: "Calendar" }).click();
  // Move the calendar to November 2026 from wherever "today" is.
  const heading = page.getByRole("heading", { level: 2 });
  for (let i = 0; i < 36 && (await heading.textContent()) !== "November 2026"; i++) {
    const now = await heading.textContent();
    await page.getByRole("button", { name: /(Previous|Next) month/ }).nth(now && new Date(`1 ${now}`) > new Date("2026-11-01") ? 0 : 1).click();
  }
  await expect(page.getByRole("region", { name: /2 November 2026/ }).getByRole("button", { name: /^Starts: Sprint/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /13 November 2026/ }).getByRole("button", { name: /^Sprint/ })).toBeVisible();
});

test("a box selection drags several cards together, and one undo puts them back", async ({ browser }) => {
  const ada = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await createBoard(ada);
  for (const t of ["One", "Two", "Three"]) await addCard(ada, "To do", t);
  const bob = await visitor(browser, ada.url());

  // Draw a box from empty space in the column, across One and Two.
  const todo = column(ada, "To do");
  const one = (await card(ada, "One").boundingBox())!;
  const two = (await card(ada, "Two").boundingBox())!;
  const board = (await ada.locator('[data-anchor="board"]').boundingBox())!;
  await ada.mouse.move(board.x + 6, one.y - 4);
  await ada.mouse.down();
  await ada.mouse.move(one.x + 40, two.y + two.height / 2, { steps: 8 });
  await expect(ada.locator('div[aria-hidden].border-blue-500')).toBeVisible();
  await ada.mouse.up();
  await expect(ada.getByRole("toolbar", { name: "Selected cards" })).toContainText("2 cards selected");
  await expect(card(todo, "One")).toHaveAccessibleName(/^One \(selected\)/);

  // Ctrl+click adds Three, then removes it again.
  await card(ada, "Three").click({ modifiers: ["Control"] });
  await expect(ada.getByRole("toolbar", { name: "Selected cards" })).toContainText("3 cards selected");
  await card(ada, "Three").click({ modifiers: ["Control"] });
  await expect(ada.getByRole("toolbar", { name: "Selected cards" })).toContainText("2 cards selected");

  // Drag One into Done: Two comes along.
  const from = (await card(ada, "One").boundingBox())!;
  const done = (await column(ada, "Done").boundingBox())!;
  await ada.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await ada.mouse.down();
  await ada.mouse.move(done.x + done.width / 2, done.y + 60, { steps: 12 });
  await expect(ada.getByText("2 cards", { exact: true })).toBeVisible();
  await ada.mouse.move(done.x + done.width / 2, done.y + 64, { steps: 2 });
  await ada.mouse.up();

  for (const page of [ada, bob]) {
    await expect(card(column(page, "Done"), "One")).toBeVisible();
    await expect(card(column(page, "Done"), "Two")).toBeVisible();
    await expect(card(column(page, "To do"), "Three")).toBeVisible();
  }
  const titles = await column(bob, "Done").getByRole("button", { name: /Press Enter/ }).allTextContents();
  expect(titles.map((t) => t.replace(/#\d+$/, ""))).toEqual(["One", "Two"]);

  // One undo moves both back.
  await ada.keyboard.press("Escape");
  await ada.keyboard.press("Control+z");
  await expect(card(column(bob, "To do"), "One")).toBeVisible();
  await expect(card(column(bob, "To do"), "Two")).toBeVisible();
  await expect(ada.getByRole("toolbar", { name: "Selected cards" })).toHaveCount(0);
});

test("selected cards can be moved with the selection bar or deleted together", async ({ page }) => {
  await createBoard(page);
  for (const t of ["Alpha", "Beta"]) await addCard(page, "To do", t);
  await card(page, "Alpha").click({ modifiers: ["Control"] });
  await card(page, "Beta").click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Selected cards" });
  await bar.getByLabel("Move selected cards to column").selectOption({ label: "Doing" });
  await expect(card(column(page, "Doing"), "Alpha")).toBeVisible();
  await expect(card(column(page, "Doing"), "Beta")).toBeVisible();

  await page.keyboard.press("Delete");
  const confirm = page.getByRole("alertdialog", { name: "Delete 2 cards?" });
  await confirm.getByRole("button", { name: "Delete cards" }).click();
  await expect(card(page, "Alpha")).toHaveCount(0);
  await expect(card(page, "Beta")).toHaveCount(0);
});

test("the host can delete the whole board after typing its name", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await createBoard(host);
  await host.getByRole("button", { name: /^Rename board title/ }).click();
  await host.getByRole("textbox", { name: "board title" }).fill("Old plan");
  await host.getByRole("textbox", { name: "board title" }).press("Enter");
  const url = host.url();
  const guest = await visitor(browser, url);
  await expect(guest.getByText("Host settings", { exact: true })).toHaveCount(0);

  await host.getByText("Host settings", { exact: true }).click();
  await host.getByRole("button", { name: "Delete board…" }).click();
  const confirm = host.getByRole("alertdialog", { name: "Delete this board for everyone?" });
  const remove = confirm.getByRole("button", { name: "Delete board" });
  await expect(remove).toBeDisabled();
  await confirm.getByLabel("Type the name to confirm").fill("Old pla");
  await expect(remove).toBeDisabled();
  await confirm.getByLabel("Type the name to confirm").fill("Old plan");
  await remove.click();

  await expect(host.getByRole("heading", { name: "This board was deleted" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "This board was deleted" })).toBeVisible();
  await expect(guest.getByText(/the host, deleted this board/)).toBeVisible();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "This board expired" })).toBeVisible();
});
