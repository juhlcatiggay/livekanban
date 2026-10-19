import { expect, test, type Page } from "@playwright/test";

// Landing → create page → board; passwords; My boards; search and filters; history.

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

async function quickBoard(page: Page) {
  await page.goto("/new");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

test("the create page names the board, sets a password and host settings", async ({ browser }) => {
  const host = await (await browser.newContext()).newPage();
  await host.goto("/");
  await host.getByRole("link", { name: "Create a board" }).first().click();
  await host.waitForURL(/\/new$/);

  await host.getByLabel("Board name").fill("Q4 launch");
  await host.getByLabel("Require a password to open this board").check();
  const create = host.getByRole("button", { name: "Create board" });
  await host.getByLabel("Password", { exact: true }).fill("abc");
  await expect(create).toBeDisabled();
  await host.getByLabel("Password", { exact: true }).fill("tangerine");
  await host.getByLabel("Everyone else can move cards and columns").uncheck();
  await create.click();
  await host.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(host.getByRole("button", { name: /^Rename board title: Q4 launch/ })).toBeVisible();
  const url = host.url();

  // Someone with only the link needs the password.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "This board has a password" })).toBeVisible();
  await guest.getByLabel("Password").fill("lemon");
  await guest.getByRole("button", { name: "Open board" }).click();
  await expect(guest.getByText("That password isn't right.")).toBeVisible();
  await guest.getByLabel("Password").fill("tangerine");
  await guest.getByRole("button", { name: "Open board" }).click();
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();
  await expect(guest.getByRole("status").filter({ hasText: "move cards and columns" })).toBeVisible();

  // The browser remembers it; a reload goes straight in.
  await guest.reload();
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();

  // My boards: the host's own board, and the guest's shared one with a lock.
  await host.goto("/");
  await expect(host.getByRole("list", { name: "My own boards" }).getByRole("link", { name: "Q4 launch" })).toBeVisible();
  await guest.goto("/");
  const shared = guest.getByRole("list", { name: "Others' boards" }).getByRole("listitem").filter({ hasText: "Q4 launch" });
  await expect(shared).toBeVisible();
  await expect(shared.getByLabel("Has a password")).toBeVisible();
  await expect(guest.getByRole("list", { name: "My own boards" })).toHaveCount(0);

  // The host removes the password; a new visitor walks straight in.
  await host.goto(url);
  await host.getByText("Host settings", { exact: true }).click();
  await host.getByRole("button", { name: "Remove" }).click();
  await host.getByRole("alertdialog", { name: "Remove the password?" }).getByRole("button", { name: "Remove password" }).click();
  await host.getByText("Host settings", { exact: true }).click();
  await expect(host.getByText("Off: anyone with the link can open the board.")).toBeVisible();
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(url);
  await expect(visitor.getByText("Live", { exact: true })).toBeVisible();
});

test("search and filters hide cards that don't match", async ({ page }) => {
  await quickBoard(page);
  await addCard(page, "To do", "Fix login bug");
  await addCard(page, "To do", "Write release notes");
  await addCard(page, "Doing", "Design new logo");

  await card(page, "Design new logo").click();
  await page.getByRole("dialog").getByLabel("Add label").fill("design,");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search cards" })).toBeFocused();
  await page.keyboard.type("login");
  await expect(card(page, "Fix login bug")).toBeVisible();
  await expect(card(page, "Write release notes")).toHaveCount(0);
  await expect(card(page, "Design new logo")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "1 of 3 cards match" })).toBeVisible();

  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByText("Filters ▾").click();
  await page.getByLabel("Label design").check();
  await expect(card(page, "Design new logo")).toBeVisible();
  await expect(card(page, "Fix login bug")).toHaveCount(0);
  await expect(page.getByText("Filters (1) ▾")).toBeVisible();

  // Searching by number.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Clear" }).click();
  await page.getByRole("searchbox", { name: "Search cards" }).fill("#2");
  await expect(card(page, "Write release notes")).toBeVisible();
  await expect(card(page, "Fix login bug")).toHaveCount(0);
});

test("history shows who changed what, for the board and for each card", async ({ page }) => {
  await quickBoard(page);
  await addCard(page, "To do", "Ship it");
  await card(page, "Ship it").click({ modifiers: ["Control"] });
  await page.getByLabel("Move selected cards to column").selectOption({ label: "Doing" });
  await expect(card(column(page, "Doing"), "Ship it")).toBeVisible();
  await page.keyboard.press("Escape");

  await card(page, "Ship it").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Add checklist item").fill("Tag build");
  await dialog.getByLabel("Add checklist item").press("Enter");
  await dialog.getByRole("checkbox", { name: "Tag build" }).check();
  await dialog.getByText("Activity").click();
  const activity = dialog.getByRole("list", { name: "Card activity" });
  await expect(activity.getByRole("listitem").first()).toContainText("checked “Tag build” on “Ship it”");
  await expect(activity).toContainText("moved “Ship it” from To do to Doing");
  await expect(activity).toContainText("added “Ship it” to To do");
  await dialog.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "History" }).click();
  const panel = page.getByRole("complementary", { name: "Board history" });
  const lines = panel.getByRole("list", { name: "Changes, newest first" }).getByRole("listitem");
  await expect(lines.first()).toContainText("checked “Tag build”");
  // Changes made while it's open appear at the top.
  await page.getByRole("button", { name: /^Rename board title/ }).click();
  await page.getByRole("textbox", { name: "board title" }).fill("Launch week");
  await page.getByRole("textbox", { name: "board title" }).press("Enter");
  await expect(lines.first()).toContainText("renamed the board to “Launch week”");
  await expect(lines.first()).toContainText("just now");
});
