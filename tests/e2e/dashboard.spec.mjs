import { expect, test } from "@playwright/test";

const TINY_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("add, disable and reorder accounts", async ({ page }) => {
  await page.goto("/providers");
  const xai = page.locator(".provider-block").filter({ has: page.getByRole("heading", { name: "xAI / Grok" }) });

  await xai.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account label").fill("Fixture primary");
  await page.getByLabel("xAI API key").fill("xai-fixture-primary");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(xai.getByText("Fixture primary")).toBeVisible();

  await xai.getByRole("button", { name: "Add account" }).click();
  await page.getByLabel("Account label").fill("Fixture secondary");
  await page.getByLabel("xAI API key").fill("xai-fixture-secondary");
  await page.getByRole("button", { name: "Save account" }).click();
  await expect(xai.getByText("Fixture secondary")).toBeVisible();

  await xai.getByRole("button", { name: "Move Fixture secondary up" }).click();
  await expect(xai.locator(".account-row__name").first()).toHaveText("Fixture secondary");
  await xai.getByRole("button", { name: "Disable Fixture secondary" }).click();
  await expect(xai.getByText("disabled", { exact: true })).toBeVisible();
});

test("route order changes the default and fallback state persists", async ({ page }) => {
  await page.goto("/routing");
  const xaiRow = page.locator(".route-row").filter({ hasText: "xAI / Grok" });
  await xaiRow.getByRole("button", { name: "Move xai down" }).click();
  await page.getByLabel("Enable cross-provider fallback in auto mode").uncheck();
  await page.getByRole("button", { name: "Save routing" }).click();
  await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.locator(".route-row").first()).toContainText("Antigravity");
  await expect(page.getByLabel("Enable cross-provider fallback in auto mode")).not.toBeChecked();
});

test("playground renders loading, success, replacement cleanup and error states", async ({ page }) => {
  await page.addInitScript(() => {
    const original = URL.revokeObjectURL.bind(URL);
    window.__revokedImageUrls = [];
    URL.revokeObjectURL = (value) => { window.__revokedImageUrls.push(value); original(value); };
  });
  let calls = 0;
  await page.route("**/api/playground", async (route) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (calls === 3) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "CAPACITY", message: "Fixture provider is at capacity.", attempts: [{ provider: "xai", model: "fixture", status: "failed", code: "CAPACITY", message: "capacity" }] } }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ image: TINY_PNG, mimeType: "image/png", provider: "xai", model: "grok-imagine-image-quality", fellBack: calls === 2, durationMs: 125, attempts: [{ provider: "xai", model: "grok-imagine-image-quality", accountId: "fixture", accountLabel: "Fixture", status: "success", code: null, durationMs: 125, message: null }] }) });
  });
  await page.goto("/playground");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Fixture prompt");
  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page.getByText("Generating one image…")).toBeVisible();
  await expect(page.getByAltText("Generated playground result")).toBeVisible();
  await expect(page.getByText("Default path")).toBeVisible();

  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page.getByText("Fallback used")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__revokedImageUrls.length)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page.locator(".notice[role='alert']")).toContainText("Fixture provider is at capacity.");
  await expect(page.getByText("CAPACITY · capacity")).toBeVisible();
});

test("prompt workbench searches and hands a selected template to the playground", async ({ page }) => {
  await page.route("**/api/prompts/status", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "ready", totalTemplates: 2, updatedAt: "fixture", previewHosts: ["example.com"], packs: [{ id: "gpt-image-2", name: "GPT Image 2", count: 2, license: "CC BY 4.0", sourceRepo: "fixture" }] }) });
  });
  await page.route("**/api/prompts?*", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: "ready", query: "poster", confidence: 0.9, searchMode: "local", results: [{ id: "tpl_fixture", title: "Fixture Poster", description: "A fixture poster", prompt: "A full English poster prompt", categories: ["poster"], needsReferenceImage: false, sources: [{ packId: "gpt-image-2" }], attribution: "YouMind", license: "CC BY 4.0", score: 0.9, previewUrls: [] }] }) });
  });
  await page.goto("/prompts");
  await page.getByLabel("Need").fill("poster");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: /Fixture Poster/ })).toBeVisible();
  await expect(page.getByText("A full English poster prompt")).toBeVisible();
  await expect(page.getByRole("link", { name: /Use in Playground/ })).toHaveAttribute("href", /template_id=tpl_fixture/);
});

for (const width of [320, 375, 414, 768]) {
  test(`all workbench screens fit ${width}px without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    for (const pathname of ["/", "/providers", "/routing", "/prompts", "/playground", "/activity", "/settings"]) {
      await page.goto(pathname);
      await expect(page.locator("h1")).toBeVisible();
      const metrics = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        wrappedAffordances: [...document.querySelectorAll("a, button")]
          .filter((element) => {
            const style = getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || !element.textContent.trim()) return false;
            const lineHeight = Number.parseFloat(style.lineHeight);
            return Number.isFinite(lineHeight) && element.clientHeight > lineHeight * 1.85 && style.whiteSpace !== "nowrap";
          })
          .map((element) => element.textContent.trim()),
      }));
      expect(metrics.document, pathname).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.body, pathname).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.wrappedAffordances, pathname).toEqual([]);
    }
    await page.goto("/");
    await page.screenshot({ path: `test-results/responsive-${width}.png`, fullPage: true });
  });
}
