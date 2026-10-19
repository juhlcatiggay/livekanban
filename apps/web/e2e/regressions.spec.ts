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
  await page.getByRole("dialog").getByRole("button", { name: "Add description" }).click();
  await page.getByRole("dialog").getByLabel("Description").fill("first line\nsecond line");
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();

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

  // Clicking a link in a note follows it rather than starting a drag (answered locally, no network).
  await page.context().route("https://example.com/**", (route) => route.fulfill({ body: "ok" }));
  const [popup] = await Promise.all([page.waitForEvent("popup"), note.getByRole("link").click()]);
  expect(popup.url()).toContain("example.com");
});

test("#7 the bulletin minimap shows notes and moves the view", async ({ page }) => {
  await createBoard(page);
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note text").fill("Mapped");
  await page.getByLabel("Note text").press("Escape");

  const map = page.getByRole("button", { name: /^Bulletin minimap/ });
  await expect(map.locator("span:not([data-minimap-view])")).toHaveCount(1);

  // Clicking the bottom-right of the map scrolls the canvas there and moves the frame.
  const scroller = page.locator("[data-presence-area]");
  const frame = map.locator("[data-minimap-view]");
  const before = (await frame.boundingBox())!;
  const box = (await map.boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height - 4);
  await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(1000);
  await expect.poll(async () => (await frame.boundingBox())!.x).toBeGreaterThan(before.x + 50);

  // Arrow keys pan from the map too.
  const top = await scroller.evaluate((el) => el.scrollTop);
  await map.focus();
  await page.keyboard.press("ArrowUp");
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeLessThan(top);

  await page.getByRole("button", { name: "Hide" }).click();
  await expect(map).toHaveCount(0);
  await page.getByRole("button", { name: "Show map" }).click();
  await expect(page.getByRole("button", { name: /^Bulletin minimap/ })).toBeVisible();
});

test("#8 the calendar shows cards by due date and drag reschedules them", async ({ browser }) => {
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const now = new Date();
  const due = iso(now);
  // Another day that's always in the visible month: the 1st, or the 2nd if today is the 1st.
  const target = iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() === 1 ? 2 : 1));

  const ada = await (await browser.newContext()).newPage();
  await createBoard(ada);
  const todo = ada.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Launch");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  await ada.getByRole("button", { name: /^Launch\. Press Enter/ }).click();
  await ada.getByRole("dialog").getByLabel("Due date").fill(due);
  await ada.getByRole("dialog").getByRole("button", { name: "Close" }).click();

  await ada.getByRole("tab", { name: "Calendar" }).click();
  const chip = ada.getByRole("button", { name: /^Launch \(To do\)/ });
  await expect(ada.locator(`section[data-day="${due}"]`).getByRole("button", { name: /^Launch/ })).toBeVisible();
  await expect(ada.locator(`section[data-day="${due}"] [aria-current="date"]`)).toBeVisible();

  // Someone else sees the move live in their kanban.
  const bob = await (await browser.newContext()).newPage();
  await bob.goto(ada.url().replace(/#.*$/, ""));
  await expect(bob.getByRole("button", { name: /^Launch\. Press Enter/ })).toBeVisible();

  await chip.dragTo(ada.locator(`section[data-day="${target}"]`));
  await expect(ada.locator(`section[data-day="${target}"]`).getByRole("button", { name: /^Launch/ })).toBeVisible();
  const [y, m, d] = target.split("-").map(Number);
  const dueLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
  await expect(bob.getByRole("button", { name: /^Launch\. Press Enter/ })).toContainText(`Due ${dueLabel}`);

  // Cards open from the calendar, and months can be browsed.
  await ada.locator(`section[data-day="${target}"]`).getByRole("button", { name: /^Launch/ }).click();
  await expect(ada.getByRole("dialog").getByLabel("Card title")).toHaveValue("Launch");
  await ada.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  const heading = ada.getByRole("heading", { level: 2 });
  const thisMonth = await heading.textContent();
  await ada.getByRole("button", { name: "Next month" }).click();
  await expect(heading).not.toHaveText(thisMonth!);
  await ada.getByRole("button", { name: "Today" }).click();
  await expect(heading).toHaveText(thisMonth!);
});

test("#12 the board creator is host and can make parts view-only for others", async ({ browser }) => {
  const hostContext = await browser.newContext();
  await hostContext.grantPermissions(["clipboard-read", "clipboard-write"]);
  const host = await hostContext.newPage();
  await createBoard(host);
  const url = host.url();
  const todo = (page: Page) => page.getByRole("region", { name: "Column To do" });
  await todo(host).getByRole("button", { name: "+ Add card" }).click();
  await todo(host).getByLabel("New card title").fill("Agenda");
  await todo(host).getByLabel("New card title").press("Enter");
  await todo(host).getByLabel("New card title").press("Escape");

  const guest = await (await browser.newContext()).newPage();
  await guest.goto(url);
  await expect(guest.getByText("Live", { exact: true })).toBeVisible();

  // Only the creator gets host settings; everyone sees who the host is.
  await expect(host.getByText("Host settings")).toBeVisible();
  await expect(guest.getByText("Host settings")).toHaveCount(0);
  await expect(guest.getByRole("list", { name: /people on this board/ }).getByText("Host")).toHaveCount(1);

  // Lock down cards and moving.
  await host.getByText("Host settings").click();
  await host.getByLabel("add, edit and delete cards and columns").uncheck();
  await host.getByLabel("move cards and columns").uncheck();
  await host.keyboard.press("Escape");

  await expect(guest.getByRole("status").filter({ hasText: /^View only/ })).toContainText("move cards and columns");
  await expect(todo(guest).getByRole("button", { name: "+ Add card" })).toHaveCount(0);
  await expect(guest.getByRole("button", { name: /^Move column/ })).toHaveCount(0);
  await expect(guest.getByLabel("Column To do options")).toHaveCount(0);
  // The card can't be moved (no "Space to move"), but it stays enabled because it still opens.
  await expect(guest.getByRole("button", { name: "Agenda. Press Enter to open." })).toBeEnabled();

  // Cards still open, read-only.
  await guest.getByRole("button", { name: /^Agenda\. Press Enter/ }).click();
  const dialog = guest.getByRole("dialog");
  await expect(dialog.getByLabel("Card title")).toHaveAttribute("readonly", "");
  await expect(dialog.getByText("· view only")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Delete card" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close" }).click();

  // The host is unaffected, and the bulletin is still open to everyone.
  await expect(todo(host).getByRole("button", { name: "+ Add card" })).toBeVisible();
  await guest.getByRole("tab", { name: /^Bulletin/ }).click();
  await expect(guest.getByRole("button", { name: "+ Add note" })).toBeVisible();

  // Restrictions persist across reloads.
  await guest.reload();
  await expect(guest.getByRole("status").filter({ hasText: /^View only/ })).toBeVisible();

  // A host link makes another device a host too.
  await host.getByText("Host settings").click();
  await host.getByRole("button", { name: "Copy host link" }).click();
  const link = await host.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#host=[A-Za-z0-9_-]{32}$/);
  const cohost = await (await browser.newContext()).newPage();
  await cohost.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(cohost.getByText("Host settings")).toBeVisible();
  expect(cohost.url()).not.toContain("#host=");
  await expect(todo(cohost).getByRole("button", { name: "+ Add card" })).toBeVisible();
});
