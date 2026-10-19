import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

async function createBoard(page: Page) {
  await page.goto("/new");
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
  await col.getByLabel("New card title").press("Escape");
  await expect(card(col, title)).toBeVisible();
}

const settled = (page: Page) => page.waitForTimeout(600);

test("undo and redo your own changes from the keyboard and the header", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "To do", "Draft");

  await page.keyboard.press("Control+z");
  await expect(card(page, "Draft")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(card(column(page, "To do"), "Draft")).toBeVisible();

  // Typing into a title is several saves, but one undo step.
  await card(page, "Draft").click();
  await page.getByRole("dialog").getByLabel("Card title").fill("Draft v2");
  await page.waitForTimeout(400);
  await page.getByRole("dialog").getByLabel("Card title").fill("Draft v3");
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(card(page, "Draft v3")).toBeVisible();
  await page.getByRole("button", { name: "Undo your last change" }).click();
  await expect(card(page, "Draft")).toBeVisible();
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(card(page, "Draft v3")).toBeVisible();

  await settled(page);
  await page.reload();
  await expect(card(column(page, "To do"), "Draft v3")).toBeVisible();
});

test("deleted cards can be restored from the trash", async ({ page }) => {
  await createBoard(page);
  await addCard(page, "Doing", "Gone soon");
  await card(page, "Gone soon").click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete card" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete card" }).click();
  await expect(card(page, "Gone soon")).toHaveCount(0);

  await page.getByRole("button", { name: "Trash", exact: true }).click();
  const trash = page.getByRole("dialog", { name: "Trash" });
  await trash.getByRole("button", { name: "Restore card Gone soon" }).click();
  await expect(trash.getByText("The trash is empty.")).toBeVisible();
  await trash.getByRole("button", { name: "Close" }).click();
  await expect(card(column(page, "Doing"), "Gone soon")).toBeVisible();
});

test("a JSON export imports into a new board, and Markdown export reads well", async ({ page }) => {
  await createBoard(page);
  const original = page.url();
  await page.getByRole("button", { name: /^Rename board title/ }).click();
  await page.getByRole("textbox", { name: "board title" }).fill("Roadmap");
  await page.getByRole("textbox", { name: "board title" }).press("Enter");
  await addCard(page, "Doing", "Ship export");
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note text").fill("Remember the import");
  await page.getByLabel("Note text").press("Escape");
  await page.getByRole("tab", { name: "Kanban" }).click();
  await settled(page);

  await page.getByText("Export", { exact: true }).click();
  const [markdown] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Markdown" }).click()]);
  expect(markdown.suggestedFilename()).toBe("roadmap.md");
  const md = await readFile((await markdown.path())!, "utf8");
  expect(md).toContain("# Roadmap");
  expect(md).toContain("## Doing\n\n- [ ] Ship export");
  expect(md).toContain("## Bulletin\n\n- Remember the import");

  await page.getByText("Export", { exact: true }).click();
  const [json] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "JSON (re-importable)" }).click()]);
  const file = (await json.path())!;

  await page.goto("/new");
  await page.getByLabel("Import a JSON export").setInputFiles(file);
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL((url) => /\/b\/[A-Za-z0-9_-]{21}$/.test(url.pathname) && url.href !== original);
  await expect(page.getByRole("button", { name: /^Rename board title: Roadmap/ })).toBeVisible();
  await expect(card(column(page, "Doing"), "Ship export")).toBeVisible();
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await expect(page.getByRole("group", { name: /^Note: Remember the import/ })).toBeVisible();
});

test("importing something that isn't an export explains the problem", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Import a JSON export").setInputFiles({
    name: "trello.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ name: "Trello board", lists: [] })),
  });
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByText("That file isn't a LiveKanban export")).toBeVisible();
});
