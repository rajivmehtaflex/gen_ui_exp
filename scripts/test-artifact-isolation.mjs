import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { artifactRegistry, executeDiagramTool } from "../server/diagram-tool.mjs";
import { startArtifactBrowserHarness } from "./browser-harness.mjs";

const titlePayload = `Chapter "'<img src=x onerror=window.__tocTitleMarker=1>`;
const numberPayload = `§"<img>`;
const spec = JSON.parse(readFileSync(new URL("../server/vendor/diagramify/examples/explainer-kv-cache.json", import.meta.url), "utf8"));
const workflowSpec = JSON.parse(readFileSync(new URL("../server/examples/diagrams/workflow.json", import.meta.url), "utf8"));
spec.sections[1].title = titlePayload;
spec.sections[1].number = numberPayload;
let harness;
let browser;
let failures = 0;
let artifactId;
let workflowArtifactId;

async function check(name, fn) {
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(10000);
  try { await fn(page); console.log(`PASS  ${name}`); }
  catch (error) { failures++; console.error(`FAIL  ${name}\n      ${error.stack || error}`); }
  finally { await page.close(); }
}

try {
  harness = await startArtifactBrowserHarness();
  browser = await chromium.launch({ headless: true });
  const result = await executeDiagramTool(JSON.stringify({ title: "Hostile TOC", type: "explainer-steps", spec }));
  assert.equal(result.ok, true, JSON.stringify(result));
  artifactId = result.diagramId;
  const artifact = artifactRegistry.get(artifactId);
  assert.ok(artifact?.html);
  const url = `${harness.baseUrl}/api/artifacts/${artifactId}`;
  const workflowResult = await executeDiagramTool(JSON.stringify({ title: "Guided story", type: "workflow", spec: workflowSpec }));
  assert.equal(workflowResult.ok, true, JSON.stringify(workflowResult));
  workflowArtifactId = workflowResult.diagramId;
  const workflowUrl = `${harness.baseUrl}/api/artifacts/${workflowArtifactId}`;

  await check("toc_title_stays_text", async (page) => {
    await page.goto(url);
    const toc = page.locator("#explainer-toc-list");
    await toc.locator(".explainer-toc-item").first().waitFor();
    assert.equal(await toc.locator(".toc-title").nth(1).textContent(), titlePayload);
    assert.equal(await toc.locator(".toc-badge").nth(1).textContent(), numberPayload);
    assert.equal(await toc.locator("img").count(), 0);
    assert.equal(await page.evaluate(() => window.__tocTitleMarker), undefined);
    const secondItem = toc.locator(".explainer-toc-item").nth(1);
    const secondLink = secondItem.locator(".explainer-toc-link");
    const sectionId = await secondItem.getAttribute("data-section-id");
    const safeHash = `#${encodeURIComponent(sectionId)}`;
    assert.equal(await secondLink.getAttribute("href"), safeHash);
    await secondLink.click();
    await page.waitForFunction((hash) => window.location.hash === hash, safeHash);
  });

  await check("direct_navigation_has_opaque_origin", async (page) => {
    const response = await page.goto(url);
    const policy = response.headers()["content-security-policy"] || "";
    for (const directive of ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'",
      "img-src data: blob:", "connect-src 'none'", "object-src 'none'", "base-uri 'none'",
      "form-action 'none'", "sandbox allow-scripts allow-downloads"]) {
      assert.ok(policy.includes(directive), `missing CSP directive ${directive}: ${policy}`);
    }
    assert.equal(await page.evaluate(() => self.origin), "null");
    await page.locator("#explainer-toc-list .explainer-toc-item").first().waitFor();
  });

  await check("pan_zoom_theme_and_explainer_widgets_work", async (page) => {
    await page.goto(url);
    const svg = page.locator(".diagram-container > svg");
    const initialTransform = await svg.getAttribute("style");
    await page.locator('[data-view="in"]').click();
    await page.waitForFunction((initial) => document.querySelector(".diagram-container > svg")?.getAttribute("style") !== initial, initialTransform);
    assert.match(await svg.getAttribute("style"), /scale\(1\.25\)/);
    await page.locator('[data-view="reset"]').click();

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await page.locator("#btn-theme").click();
    assert.notEqual(await page.locator("html").getAttribute("data-theme"), initialTheme);

    const initialStep = await page.locator('[data-widget="explainer-simulator"] [data-sim-step]').textContent();
    await page.locator('[data-widget="explainer-simulator"] [data-sim-play]').click();
    await page.waitForFunction((value) => document.querySelector('[data-widget="explainer-simulator"] [data-sim-step]')?.textContent !== value, initialStep);
    assert.notEqual(await page.locator('[data-widget="explainer-simulator"] [data-sim-with-cache]').textContent(), "7");

    const initialContext = await page.locator('[data-widget="cache-calculator"] [data-calc-context-val]').textContent();
    const initialCacheSize = await page.locator('[data-widget="cache-calculator"] [data-calc-kv-res]').textContent();
    await page.locator('[data-widget="cache-calculator"] [data-calc-context-val]').click();
    assert.notEqual(await page.locator('[data-widget="cache-calculator"] [data-calc-context-val]').textContent(), initialContext);
    assert.notEqual(await page.locator('[data-widget="cache-calculator"] [data-calc-kv-res]').textContent(), initialCacheSize);
  });

  await check("guided_story_navigation_and_playback_work", async (page) => {
    await page.goto(workflowUrl);
    await page.waitForSelector("#guided-views:not([hidden])");
    const storyChapters = page.locator("#guided-view-chapters [data-guided-view-id]");
    assert.equal(await storyChapters.count(), 3);
    await storyChapters.filter({ hasText: "Policy and recovery" }).click();
    await page.waitForFunction(() => document.querySelector('[data-guided-view-id="safety-gate"]')?.getAttribute("aria-current") === "step");
    const play = page.locator("#guided-view-play");
    await play.click();
    assert.equal(await play.getAttribute("aria-pressed"), "true");
    await play.click();
    assert.equal(await play.getAttribute("aria-pressed"), "false");
  });

  await check("embedded_parent_access_and_navigation_blocked", async (page) => {
    await page.goto(`${harness.baseUrl}/__artifact_panel`);
    await page.waitForFunction(() => window.artifactHarnessReady === true);
    await page.evaluate((id) => window.setArtifactProps({ status: "ready", diagramId: id, title: "Isolation", type: "explainer-steps" }), artifactId);
    const frame = page.frameLocator("iframe");
    await frame.locator("#explainer-toc-list .explainer-toc-item").first().waitFor();
    const child = page.frames().find((candidate) => candidate.url() === url);
    assert.ok(child);
    assert.equal(await child.evaluate(() => self.origin), "null");
    assert.equal(await child.evaluate(() => {
      try { return Boolean(parent.document.body); } catch { return false; }
    }), false);
    const before = page.url();
    await child.evaluate(() => { try { top.location.href = "https://example.invalid/escape"; } catch {} });
    await page.waitForTimeout(100);
    assert.equal(page.url(), before);
  });
} finally {
  if (artifactId) artifactRegistry.delete(artifactId);
  if (workflowArtifactId) artifactRegistry.delete(workflowArtifactId);
  if (browser) await browser.close();
  if (harness) await harness.close();
}
process.exitCode = failures ? 1 : 0;
