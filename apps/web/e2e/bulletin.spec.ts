import { expect, test, type Browser, type Page } from "@playwright/test";

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

async function openBulletin(page: Page, url?: string) {
  if (url) await page.goto(`${url}#bulletin`);
  else await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Bulletin canvas")).toBeVisible();
}

const note = (page: Page, text: string) => page.getByRole("group", { name: new RegExp(`^Note: ${text}`) });

async function addNote(page: Page, text: string) {
  await page.getByRole("button", { name: "+ Add note" }).click();
  const editor = page.getByLabel("Note text");
  await editor.fill(text);
  await editor.press("Escape");
  await expect(note(page, text)).toBeVisible();
}

async function dragBy(page: Page, target: ReturnType<typeof note>, dx: number, dy: number, release = true) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 12 });
  if (release) await page.mouse.up();
}

const cursorTip = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = document.querySelector<HTMLElement>(`[data-cursor="${n}"]`);
    if (!el || el.style.display !== "block") return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  }, name);

const settled = (page: Page) => page.waitForTimeout(600);

test("notes can be added, edited, moved and recolored, and survive a reload", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await openBulletin(ada);
  await addNote(ada, "Standup at 10");

  const before = (await note(ada, "Standup at 10").boundingBox())!;
  await dragBy(ada, note(ada, "Standup at 10"), 240, 120);
  await expect.poll(async () => (await note(ada, "Standup at 10").boundingBox())!.x).toBeCloseTo(before.x + 240, -1);

  await note(ada, "Standup at 10").hover();
  await note(ada, "Standup at 10").getByLabel("Note options").click();
  await ada.getByRole("button", { name: "Note color Blue" }).click();
  await settled(ada);

  await ada.reload();
  await expect(note(ada, "Standup at 10")).toBeVisible();
  await expect(note(ada, "Standup at 10").locator("div").first()).toHaveClass(/bg-blue-100/);
  const after = (await note(ada, "Standup at 10").boundingBox())!;
  expect(Math.abs(after.x - (before.x + 240))).toBeLessThan(6);
  expect(Math.abs(after.y - (before.y + 120))).toBeLessThan(6);
});

// Phase 4 exit gate: same presence on canvas.
test("cursors land on the same canvas spot at different zoom levels", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await openBulletin(ada);
  await addNote(ada, "Target");

  const bob = await visitor(browser, "Bob", { width: 1000, height: 700 });
  await openBulletin(bob, ada.url().replace(/#.*$/, ""));
  await bob.getByRole("button", { name: "50%" }).click();
  await bob.locator("[data-presence-area]").evaluate((el) => el.scrollTo(30, 20));

  // Over a note: same spot on the note.
  const a = (await note(ada, "Target").boundingBox())!;
  await ada.mouse.move(a.x + a.width * 0.3, a.y + a.height * 0.6, { steps: 4 });
  const b = (await note(bob, "Target").boundingBox())!;
  await expect
    .poll(() => cursorTip(bob, "Ada"))
    .toEqual({ x: Math.round(b.x + b.width * 0.3), y: Math.round(b.y + b.height * 0.6) });

  // Over empty canvas: same canvas coordinate.
  const canvasA = (await ada.getByLabel("Bulletin canvas").boundingBox())!;
  const point = { x: canvasA.x + 900, y: canvasA.y + 500 };
  await ada.mouse.move(point.x, point.y, { steps: 4 });
  const canvasB = (await bob.getByLabel("Bulletin canvas").boundingBox())!;
  const fx = (point.x - canvasA.x) / canvasA.width;
  const fy = (point.y - canvasA.y) / canvasA.height;
  await expect
    .poll(() => cursorTip(bob, "Ada"))
    .toEqual({ x: Math.round(canvasB.x + fx * canvasB.width), y: Math.round(canvasB.y + fy * canvasB.height) });
});

test("a note being dragged shows a ghost and a placeholder to others", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await openBulletin(ada);
  await addNote(ada, "Moving day");
  const bob = await visitor(browser, "Bob");
  await openBulletin(bob, ada.url().replace(/#.*$/, ""));

  await dragBy(ada, note(ada, "Moving day"), 300, 200, false);
  await expect(bob.getByText("Ada is moving this note")).toBeVisible();
  await expect(bob.locator('[data-ghost] >> text="Moving day"')).toBeVisible();

  const before = (await bob.getByLabel("Note held by Ada").boundingBox())!;
  await ada.mouse.up();
  await expect(bob.getByText("Ada is moving this note")).toHaveCount(0);
  await expect.poll(async () => (await note(bob, "Moving day").boundingBox())!.x).toBeCloseTo(before.x + 300, -1);
});

test("a pinned note shows as an announcement on the kanban tab", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  const bob = await visitor(browser, "Bob");
  await bob.goto(ada.url());
  await openBulletin(ada);
  await addNote(ada, "Release freeze Friday");

  await note(ada, "Release freeze Friday").hover();
  await note(ada, "Release freeze Friday").getByLabel("Note options").click();
  await ada.getByRole("button", { name: "Pin as announcement" }).click();

  const banner = bob.getByRole("complementary", { name: "Pinned announcement" });
  await expect(banner).toContainText("Release freeze Friday");
  await banner.getByRole("button", { name: "Unpin" }).click();
  await expect(banner).toHaveCount(0);
  await expect(ada.getByText("Pinned", { exact: true })).toHaveCount(0);
});

test("notes become cards and cards become notes", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await openBulletin(ada);
  await ada.getByRole("button", { name: "+ Add note" }).click();
  await ada.getByLabel("Note text").fill("Ship v1\nwith release notes");
  await ada.getByLabel("Note text").press("Escape");

  await note(ada, "Ship v1").hover();
  await note(ada, "Ship v1").getByLabel("Note options").click();
  await ada.getByRole("button", { name: "→ Doing" }).click();
  await expect(note(ada, "Ship v1")).toHaveCount(0);

  await ada.getByRole("tab", { name: "Kanban" }).click();
  const doing = ada.getByRole("region", { name: "Column Doing" });
  await doing.getByRole("button", { name: /^Ship v1\. Press Enter/ }).click();
  await expect(ada.getByRole("dialog").getByLabel("Description")).toHaveValue("Ship v1\nwith release notes");

  await ada.getByRole("dialog").getByRole("button", { name: "Move to bulletin" }).click();
  await expect(doing.getByRole("button", { name: /^Ship v1\. Press Enter/ })).toHaveCount(0);
  await ada.getByRole("tab", { name: /^Bulletin/ }).click();
  await expect(note(ada, "Ship v1")).toContainText("with release notes");
});

test("deleting a note can be undone", async ({ browser }) => {
  const ada = await visitor(browser, "Ada");
  await createBoard(ada);
  await openBulletin(ada);
  await addNote(ada, "Keep me");
  await note(ada, "Keep me").hover();
  await note(ada, "Keep me").getByLabel("Note options").click();
  await ada.getByRole("button", { name: "Delete note" }).click();
  await expect(note(ada, "Keep me")).toHaveCount(0);
  await ada.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(note(ada, "Keep me")).toBeVisible();
  await settled(ada);
  await ada.reload();
  await expect(note(ada, "Keep me")).toBeVisible();
});
