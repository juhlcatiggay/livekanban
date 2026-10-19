import { expect, test } from "@playwright/test";

// Phase 1 exit gate: two tabs share one room.
test("two visitors on one board see each other join and leave", async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await alice.goto("/new");
  await alice.getByRole("button", { name: "Create board" }).click();
  await alice.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(alice.getByText("Live", { exact: true })).toBeVisible();
  await expect(alice.getByText(/^Kept until \d{1,2} \w{3} \d{4}$/)).toBeVisible();
  await expect(alice.getByLabel("1 people on this board")).toBeVisible();

  // A separate context has its own localStorage, so it gets its own identity.
  const bobContext = await browser.newContext();
  const bob = await bobContext.newPage();
  await bob.goto(alice.url());
  await expect(bob.getByLabel("2 people on this board")).toBeVisible();
  await expect(alice.getByLabel("2 people on this board")).toBeVisible();

  await bobContext.close();
  await expect(alice.getByLabel("1 people on this board")).toBeVisible();
});

test("a board you create appears under My own boards", async ({ page }) => {
  await page.goto("/new");
  await page.getByLabel("Name", { exact: true }).fill("Roadmap");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\//);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("list", { name: "My own boards" }).getByRole("link", { name: "Roadmap" })).toBeVisible();
});

test("an unknown board shows the expired screen", async ({ page }) => {
  await page.goto(`/b/${"Z".repeat(21)}`);
  await expect(page.getByRole("heading", { name: "This board expired" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a new board" })).toBeVisible();
});

// The id check runs inside the streamed Suspense boundary, so the status stays 200
// (Next adds noindex); a true 404 would need a Proxy on every board request.
test("a malformed board id shows the not-found screen", async ({ page }) => {
  await page.goto("/b/not-a-board");
  await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible();
});

test("everyone gets a different name on a board, and keeps it when they come back", async ({ browser }) => {
  const you = (page: import("@playwright/test").Page) =>
    page.getByLabel("Your name and color").locator("[title]").first().getAttribute("title");
  const nameOf = async (page: import("@playwright/test").Page) => (await you(page))!.replace(/ \(you\).*$/, "");

  const ada = await (await browser.newContext()).newPage();
  await ada.goto("/new");
  await ada.getByRole("button", { name: "Create board" }).click();
  await ada.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(ada.getByText("Live", { exact: true })).toBeVisible();
  await expect.poll(() => nameOf(ada)).not.toBe("Guest");
  const adaName = await nameOf(ada);

  const bob = await (await browser.newContext()).newPage();
  await bob.goto(ada.url());
  await expect(bob.getByLabel("2 people on this board")).toBeVisible();
  await expect.poll(() => nameOf(bob)).not.toBe("Guest");
  const bobName = await nameOf(bob);
  expect(bobName.toLowerCase()).not.toBe(adaName.toLowerCase());

  // Same name after closing and reopening the board.
  await ada.goto("/");
  await ada.goBack();
  await expect(ada.getByText("Live", { exact: true })).toBeVisible();
  await expect.poll(() => nameOf(ada)).toBe(adaName);

  // Someone else's name can't be taken.
  await bob.getByLabel("Your name and color").click();
  await bob.getByRole("textbox", { name: "Your name" }).fill(adaName);
  await bob.getByRole("textbox", { name: "Your name" }).press("Enter");
  await expect(bob.getByText(`Someone on this board is already called ${adaName}`)).toBeVisible();
  await expect(bob.getByRole("textbox", { name: "Your name" })).toHaveValue(bobName);
  await expect.poll(() => nameOf(bob)).toBe(bobName);
});
