import { expect, test } from "@playwright/test";

const HOSTILE = [
  "## Plan",
  "**bold** and [docs](https://example.com) and [bad](javascript:alert(1))",
  "<script>window.__xss = 1</script>",
  '<img src="x" onerror="window.__xss = 2">',
  "![tracker](https://tracker.example/pixel.png)",
  "- first\n- second",
  // Blank lines between blocks: in CommonMark an HTML line opens a block that runs to the next blank line.
].join("\n\n");

test("descriptions render as Markdown, safely, for everyone", async ({ browser }) => {
  const ada = await (await browser.newContext()).newPage();
  await ada.goto("/");
  await ada.getByRole("button", { name: "Create board" }).click();
  await ada.waitForURL(/\/b\//);
  await expect(ada.getByText("Live", { exact: true })).toBeVisible();

  const todo = ada.getByRole("region", { name: "Column To do" });
  await todo.getByRole("button", { name: "+ Add card" }).click();
  await todo.getByLabel("New card title").fill("Spec");
  await todo.getByLabel("New card title").press("Enter");
  await todo.getByLabel("New card title").press("Escape");
  await ada.getByRole("button", { name: /^Spec\. Press Enter/ }).click();
  await ada.getByRole("dialog").getByLabel("Description").fill(HOSTILE);
  await ada.getByRole("dialog").getByRole("tab", { name: "preview" }).click();

  // A second visitor opening the card sees the same rendering.
  const bob = await (await browser.newContext()).newPage();
  await bob.goto(ada.url());
  await bob.getByRole("button", { name: /^Spec\. Press Enter/ }).click();

  for (const page of [ada, bob]) {
    const preview = page.getByRole("dialog").getByRole("region", { name: "Description preview" });
    await expect(preview.getByRole("heading", { name: "Plan" })).toBeVisible();
    await expect(preview.locator("strong")).toHaveText("bold");
    await expect(preview.getByRole("listitem")).toHaveText(["first", "second"]);

    const docs = preview.getByRole("link", { name: "docs" });
    await expect(docs).toHaveAttribute("href", "https://example.com");
    await expect(docs).toHaveAttribute("rel", /nofollow/);
    await expect(docs).toHaveAttribute("target", "_blank");
    const bad = preview.getByRole("link", { name: "bad" });
    expect(await bad.getAttribute("href")).not.toMatch(/javascript/i);

    // Raw HTML and images never reach the DOM; the image shows as its alt text.
    await expect(preview.locator("script, img")).toHaveCount(0);
    await expect(preview).toContainText("[image: tracker]");
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  }
});
