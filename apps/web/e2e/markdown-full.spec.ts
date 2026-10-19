import { expect, test } from "@playwright/test";

const SAMPLE = `# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

Plain text with **bold**, *italic*, ***both***, ~~strikethrough~~, \`inline code\` and a [link](https://example.com).
A single Enter is a line break.

- Bullet
  - Nested bullet
    - Third level
1. First
2. Second
   1. Nested number

- [x] Done task
- [ ] Open task

> A quote that spans
> two lines.

\`\`\`ts
// Syntax highlighting
const greeting: string = "hello";
function add(a: number, b: number) {
  return a + b;
}
\`\`\`

| Feature | Status |
| --- | --- |
| Tables | ✅ |
| Zebra rows | ✅ |

---

![Kanban diagram](https://example.com/diagram.png)

A footnote reference.[^1]

[^1]: The footnote text.`;

// Full GitHub-flavored Markdown in a card description (and, compact, on a sticky note).
test("descriptions and notes render every Markdown feature", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/new");
  await page.getByRole("button", { name: "Create board" }).click();
  await page.waitForURL(/\/b\//);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  const todo = page.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Spec");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  await page.getByRole("button", { name: /^Spec\. Press Enter/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Add description" }).click();
  await dialog.getByLabel("Description").fill(SAMPLE);
  await dialog.getByRole("button", { name: "Done" }).click();

  const md = dialog.getByRole("region", { name: "Description preview" });
  await md.screenshot({ path: info.outputPath("card-markdown-top.png") });
  for (let level = 1; level <= 6; level++) {
    await expect(md.getByRole("heading", { level, name: `Heading ${level}` })).toBeVisible();
  }
  await expect(md.locator("strong").first()).toHaveText("bold");
  await expect(md.locator("em").first()).toHaveText("italic");
  await expect(md.locator("del")).toHaveText("strikethrough");
  await expect(md.locator("ul ul ul li")).toHaveText("Third level");
  await expect(md.locator("ol ol li")).toHaveText("Nested number");
  await expect(md.locator("input[type=checkbox]")).toHaveCount(2);
  await expect(md.locator("blockquote")).toContainText("two lines");
  await expect(md.locator("pre code .hljs-keyword").first()).toBeVisible();
  await expect(md.locator("table tbody tr")).toHaveCount(2);
  await expect(md.locator("hr")).toHaveCount(1);
  await expect(md.locator(".footnotes")).toContainText("The footnote text");

  // Images wait for a click before loading anything.
  await expect(md.locator("img")).toHaveCount(0);
  await page.context().route("https://example.com/**", (route) => route.fulfill({ status: 404 }));
  await md.getByRole("button", { name: "Load image from example.com" }).click();
  await expect(md.locator("img")).toHaveAttribute("referrerpolicy", "no-referrer");

  await page.screenshot({ path: info.outputPath("card-markdown.png"), fullPage: false });

  // The same text on a sticky note uses the compact paper style.
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("tab", { name: /^Bulletin/ }).click();
  await page.getByRole("button", { name: "+ Add note" }).click();
  await page.getByLabel("Note text").fill(SAMPLE);
  await page.getByLabel("Note text").press("Escape");
  const note = page.getByRole("group", { name: /^Note: # Heading 1/ });
  await expect(note.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(note.locator(".markdown-compact.markdown-paper")).toHaveCount(1);
  await note.screenshot({ path: info.outputPath("note-markdown.png") });
});
