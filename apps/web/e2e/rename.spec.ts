import { expect, test, type Browser, type Page } from "@playwright/test";

// Renaming yourself updates your name everywhere on the board: assignees, "last edited by", history.

async function visitor(browser: Browser, name: string) {
  const context = await browser.newContext();
  await context.addInitScript(
    ([n]) => localStorage.setItem("lk:identity", JSON.stringify({ clientId: `test-${n}`, name: n, color: "#4f46e5", custom: true })),
    [name],
  );
  return context.newPage();
}

const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(`^${title}( \(selected\))?\. Press Enter`) });

test("when someone renames themselves, every card that names them follows, for everyone", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await ada.goto("/new");
  await ada.getByRole("button", { name: "Create board" }).click();
  await ada.waitForURL(/\/b\//);
  await expect(ada.getByText("Live", { exact: true })).toBeVisible();
  const bob = await visitor(browser, "Bob");
  await bob.goto(ada.url());
  await expect(bob.getByText("Live", { exact: true })).toBeVisible();

  const todo = ada.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Launch");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  await card(ada, "Launch").click();
  await ada.getByRole("dialog").getByLabel("Add assignee").fill("Ada, Bob,");
  await ada.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(card(bob, "Launch").getByLabel("Assigned to Ada, Bob")).toBeVisible();

  // Bob renames himself; Ada's board updates without a reload.
  await bob.getByLabel("Your name and color").click();
  await bob.getByRole("textbox", { name: "Your name" }).fill("Robert");
  await bob.getByRole("textbox", { name: "Your name" }).press("Enter");
  await expect(card(ada, "Launch").getByLabel("Assigned to Ada, Robert")).toBeVisible();

  // Ada renames herself too: assignee, "last edited by" and history all follow.
  await ada.getByLabel("Your name and color").click();
  await ada.getByRole("textbox", { name: "Your name" }).fill("Ada Lovelace");
  await ada.getByRole("textbox", { name: "Your name" }).press("Enter");
  await expect(card(bob, "Launch").getByLabel("Assigned to Ada Lovelace, Robert")).toBeVisible();
  await card(bob, "Launch").click();
  const dialog = bob.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Remove Robert" })).toBeVisible();
  await expect(dialog.getByText(/^Last edited by Ada Lovelace/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await bob.getByRole("button", { name: "History" }).click();
  const lines = bob.getByRole("list", { name: "Changes, newest first" });
  await expect(lines.getByRole("listitem").first()).toContainText("Ada Lovelace changed their name from “Ada” to “Ada Lovelace”");
  await expect(lines).not.toContainText(/\bAda added/);
});
