import { expect, test, type Browser, type Page } from "@playwright/test";

/** A visitor with a fixed name and color, so other tabs can find their cursor. */
async function visitor(browser: Browser, name: string, viewport = { width: 1400, height: 900 }) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(
    ([n]) => localStorage.setItem("lk:identity", JSON.stringify({ clientId: `test-${n}`, name: n, color: "#4f46e5" })),
    [name],
  );
  return context.newPage();
}

async function createBoard(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\/[A-Za-z0-9_-]{21}$/);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
}

const column = (page: Page, title: string) => page.getByRole("region", { name: `Column ${title}` });
const card = (page: Page, title: string) => page.getByRole("button", { name: new RegExp(`^${title}\\. Press Enter`) });

async function addCard(page: Page, columnTitle: string, title: string) {
  const col = column(page, columnTitle);
  await col.getByRole("button", { name: "+ Add card" }).click();
  await col.getByLabel("New card title").fill(title);
  await col.getByLabel("New card title").press("Enter");
  await col.getByLabel("New card title").press("Escape");
  await expect(card(page, title)).toBeVisible();
}

/** Viewport position of `name`'s remote cursor tip as drawn on `page`. */
const cursorTip = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.querySelector<HTMLElement>(`[data-cursor="${n}"]`);
    if (!el || el.style.display !== "block") return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  }, name);

test("a cursor lands on the same spot of the same card on a different screen", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await addCard(ada, "Done", "Target");

  // Bob has a narrower window and has scrolled the board sideways, so the card sits elsewhere.
  const bob = await visitor(browser, "Bob", { width: 900, height: 700 });
  await open(bob, ada.url());
  await bob.locator("[data-anchor=board]").evaluate((el) => (el.scrollLeft = 120));

  const a = (await card(ada, "Target").boundingBox())!;
  await ada.mouse.move(a.x + a.width * 0.25, a.y + a.height * 0.5, { steps: 5 });

  const b = (await card(bob, "Target").boundingBox())!;
  const expected = { x: Math.round(b.x + b.width * 0.25), y: Math.round(b.y + b.height * 0.5) };
  await expect.poll(() => cursorTip(bob, "Ada")).toEqual(expected);
});

test("someone off screen gets an edge indicator that jumps to them", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await addCard(ada, "Done", "Far away");

  const bob = await visitor(browser, "Bob", { width: 640, height: 700 });
  await open(bob, ada.url());
  const target = (await card(ada, "Far away").boundingBox())!;
  await ada.mouse.move(target.x + target.width * 0.9, target.y + target.height / 2, { steps: 5 });

  const jump = bob.getByRole("button", { name: "Jump to Ada" });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(card(bob, "Far away")).toBeInViewport();
  await expect(jump).toBeHidden();
  await expect.poll(() => cursorTip(bob, "Ada")).not.toBeNull();
});

test("a card being dragged shows a ghost and a placeholder, and can't be grabbed by others", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await addCard(ada, "To do", "Hot");
  const bob = await visitor(browser, "Bob");
  await open(bob, ada.url());

  const from = (await card(ada, "Hot").boundingBox())!;
  const to = (await column(ada, "Done").boundingBox())!;
  await ada.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await ada.mouse.down();
  await ada.mouse.move(to.x + to.width / 2, to.y + 80, { steps: 15 });

  await expect(bob.getByText("Ada is moving “Hot”")).toBeVisible();
  await expect(bob.locator("[data-ghost]")).toBeVisible();
  await expect(bob.locator('[data-cursor="Ada"]').getByText("Ada is moving")).toBeVisible();
  await expect(card(bob, "Hot")).toHaveCount(0); // the placeholder isn't a draggable card

  await ada.mouse.up();
  await expect(column(bob, "Done").getByRole("button", { name: /^Hot\. Press Enter/ })).toBeVisible();
  await expect(bob.getByText("Ada is moving “Hot”")).toHaveCount(0);
  await expect(bob.locator("[data-ghost]")).toHaveCount(0);
});

test("editing shows a badge to others, and typing appears live", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await addCard(ada, "To do", "Draft");
  const bob = await visitor(browser, "Bob");
  await open(bob, ada.url());

  await card(ada, "Draft").click();
  await expect(column(bob, "To do").getByText("Ada is editing")).toBeVisible();

  await ada.getByRole("dialog").getByLabel("Card title").fill("Draft v2");
  await expect(card(bob, "Draft v2")).toBeVisible();

  // Bob opens the same card: he sees Ada noted in the dialog and her later typing in untouched fields.
  await card(bob, "Draft v2").click();
  await expect(bob.getByRole("dialog").getByText("Ada is also editing")).toBeVisible();
  await ada.getByRole("dialog").getByLabel("Assignee").fill("Grace");
  await expect(bob.getByRole("dialog").getByLabel("Assignee")).toHaveValue("Grace");

  await ada.getByRole("dialog").getByRole("button", { name: "Close" }).click();
  await expect(bob.getByRole("dialog").getByText("Ada is also editing")).toHaveCount(0);
});

test("renaming a column shows who is editing it", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  const bob = await visitor(browser, "Bob");
  await open(bob, ada.url());

  await column(ada, "Doing").getByRole("button", { name: /^Rename column title/ }).click();
  await expect(column(bob, "Doing").getByText("Ada is editing")).toBeVisible();
  await ada.keyboard.press("Escape");
  await expect(column(bob, "Doing").getByText("Ada is editing")).toHaveCount(0);
});

test("changing your name and color updates everyone's presence bar", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  const bob = await visitor(browser, "Bob");
  await open(bob, ada.url());
  // Ada created the board, so her avatar also says she's the host.
  await expect(bob.getByTitle("Ada, host", { exact: true })).toBeVisible();

  await ada.getByLabel("Your name and color").click();
  await ada.getByRole("textbox", { name: "Your name" }).fill("Ada Lovelace");
  await ada.getByRole("textbox", { name: "Your name" }).press("Enter");
  await ada.getByRole("button", { name: "Color #e11d48" }).click();

  const avatar = bob.getByTitle("Ada Lovelace, host", { exact: true });
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveCSS("background-color", "rgb(225, 29, 72)");
});
