import { expect, test, type Page } from "@playwright/test";

async function createBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

const column = (page: Page, title: string) => page.getByRole("region", { name: `Column ${title}` });
const card = (scope: Page | ReturnType<typeof column>, title: string) =>
  scope.getByRole("button", { name: new RegExp(`^${title}\\. Press Enter`) });

async function addCard(page: Page, columnTitle: string, title: string) {
  const col = column(page, columnTitle);
  await col.getByRole("button", { name: "+ Add card" }).click();
  await col.getByLabel("New card title").fill(title);
  await col.getByLabel("New card title").press("Enter");
  await expect(card(col, title)).toBeVisible();
  await col.getByLabel("New card title").press("Escape");
}

/**
 * Keyboard drag: Space picks up, arrows move, Space drops. dnd-kit attaches its
 * arrow-key listener just after pickup, so wait for its pickup announcement.
 */
async function keyboardDrag(page: Page, keys: string[]) {
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: /^Picked up|was moved over/ })).toBeAttached();
  // The announcement renders before the listener's setTimeout runs; give a loaded CI box a beat.
  await page.waitForTimeout(100);
  for (const key of keys) await page.keyboard.press(key);
  await page.keyboard.press("Space");
  await expect(page.getByRole("status").filter({ hasText: /was dropped/ })).toBeAttached();
}

/** Waits until every pending change has been acknowledged by the room. */
async function settled(page: Page) {
  // Debounced card edits flush within 300 ms; acks follow within one round trip.
  await page.waitForTimeout(600);
}

// Phase 2 exit gate: edits survive reload.
test("columns, cards and card details survive a reload", async ({ page }) => {
  await createBoard(page);
  for (const title of ["To do", "Doing", "Done"]) await expect(column(page, title)).toBeVisible();

  await page.getByRole("button", { name: /^Rename board title/ }).click();
  await page.getByRole("textbox", { name: "board title" }).fill("Launch plan");
  await page.getByRole("textbox", { name: "board title" }).press("Enter");

  await addCard(page, "To do", "Write spec");
  await card(page, "Write spec").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add description" }).click();
  await dialog.getByLabel("Description").fill("## Scope\nEverything in phase 2");
  await dialog.getByRole("button", { name: "Done" }).click();
  // Several assignees: Enter or a comma adds each one.
  await dialog.getByLabel("Add assignee").fill("Juhl");
  await dialog.getByLabel("Add assignee").press("Enter");
  await dialog.getByLabel("Add assignee").fill("Ada Lovelace,");
  await expect(dialog.getByRole("button", { name: "Remove Ada Lovelace" })).toBeVisible();
  await dialog.getByLabel("Labels").fill("docs, urgent");
  await dialog.getByLabel("Due date").fill("2026-11-30");
  await dialog.getByRole("button", { name: "Purple" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "+ Add column" }).click();
  await page.getByLabel("New column title").fill("Review");
  await page.getByLabel("New column title").press("Enter");
  await expect(column(page, "Review")).toBeVisible();
  await settled(page);

  await page.reload();
  await expect(page.getByRole("button", { name: /^Rename board title: Launch plan/ })).toBeVisible();
  await expect(column(page, "Review")).toBeVisible();
  const saved = card(column(page, "To do"), "Write spec");
  await expect(saved).toContainText("docs");
  await expect(saved).toContainText("urgent");
  await expect(saved.getByLabel("Assigned to Juhl, Ada Lovelace")).toBeVisible();
  await expect(saved).toContainText("JAL"); // initials of both
  await expect(saved).toContainText("Due 30 Nov");

  await saved.click();
  await expect(page.getByRole("dialog").getByRole("region", { name: "Description preview" }).getByRole("heading", { name: "Scope" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("dialog").getByLabel("Description")).toHaveValue("## Scope\nEverything in phase 2");
});

test("a second visitor sees edits live", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await createBoard(alice);
  const bob = await (await browser.newContext()).newPage();
  await bob.goto(alice.url());
  await expect(bob.getByText("Live", { exact: true })).toBeVisible();

  await addCard(alice, "To do", "Fix login");
  await expect(card(column(bob, "To do"), "Fix login")).toBeVisible();

  await column(bob, "Doing").getByRole("button", { name: /^Rename column title: Doing/ }).click();
  await bob.getByRole("textbox", { name: "column title" }).fill("In progress");
  await bob.getByRole("textbox", { name: "column title" }).press("Enter");
  await expect(column(alice, "In progress")).toBeVisible();
});

test("dragging a card with the pointer moves it to another column for everyone", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await createBoard(alice);
  const bob = await (await browser.newContext()).newPage();
  await bob.goto(alice.url());
  await addCard(alice, "To do", "Ship it");

  const source = card(alice, "Ship it");
  const target = column(alice, "Done");
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await alice.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await alice.mouse.down();
  await alice.mouse.move(to.x + to.width / 2, to.y + 60, { steps: 12 });
  await alice.mouse.move(to.x + to.width / 2, to.y + 64, { steps: 2 });
  await alice.mouse.up();

  await expect(card(column(alice, "Done"), "Ship it")).toBeVisible();
  await expect(card(column(bob, "Done"), "Ship it")).toBeVisible();
  await settled(alice);
  await alice.reload();
  await expect(card(column(alice, "Done"), "Ship it")).toBeVisible();
});

test("cards can be reordered and moved with the keyboard", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "To do", "First");
  await addCard(page, "To do", "Second");

  // Move "Second" above "First".
  await card(page, "Second").focus();
  await keyboardDrag(page, ["ArrowUp"]);
  await expect(column(page, "To do").getByRole("button", { name: /\. Press Enter/ })).toHaveText([/^Second/, /^First/]); // cards also show their #number

  // Move "First" into the next column.
  await card(page, "First").focus();
  await keyboardDrag(page, ["ArrowRight"]);
  await expect(card(column(page, "Doing"), "First")).toBeVisible();

  await settled(page);
  await page.reload();
  await expect(card(column(page, "To do"), "Second")).toBeVisible();
  await expect(card(column(page, "Doing"), "First")).toBeVisible();
});

test("deleting a column asks first, and can be undone", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "Doing", "Keep me");

  // Cancel keeps it.
  await column(page, "Doing").getByLabel("Column Doing options").click();
  await page.getByRole("button", { name: "Delete column" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Delete column “Doing”?" });
  await expect(confirm).toContainText("Its 1 card will be deleted with it");
  await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(column(page, "Doing")).toBeVisible();

  await column(page, "Doing").getByLabel("Column Doing options").click();
  await page.getByRole("button", { name: "Delete column" }).click();
  await confirm.getByRole("button", { name: "Delete column" }).click();
  await expect(column(page, "Doing")).toHaveCount(0);

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(card(column(page, "Doing"), "Keep me")).toBeVisible();
  await settled(page);
  await page.reload();
  await expect(card(column(page, "Doing"), "Keep me")).toBeVisible();
});

test("columns can be reordered with the keyboard", async ({ page }) => {
  await createBoard(page);
  await page.getByRole("button", { name: /^Move column Done/ }).focus();
  await keyboardDrag(page, ["ArrowLeft"]);
  await expect
    .poll(() => page.locator("section[aria-label^='Column ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))
    .toEqual(["Column To do", "Column Done", "Column Doing"]);

  await settled(page);
  await page.reload();
  await expect
    .poll(() => page.locator("section[aria-label^='Column ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))
    .toEqual(["Column To do", "Column Done", "Column Doing"]);
});
