import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
import { artifactRegistry, executeDiagramTool } from "../server/diagram-tool.mjs";
import { startArtifactBrowserHarness } from "./browser-harness.mjs";

const harness = await startArtifactBrowserHarness();
const browser = await chromium.launch({ headless: true });
let failures = 0;

async function check(name, fn, pathname = "/__artifact_panel") {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(`${harness.baseUrl}${pathname}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction((path) => path === "/__artifact_panel"
      ? window.artifactHarnessReady === true
      : window.artifactHostReady === true, pathname, { timeout: 5000 });
    await fn(page);
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL  ${name}\n      ${error.stack || error}`);
  } finally { await page.close(); }
}

async function render(page, props) {
  await page.evaluate((value) => window.setArtifactProps(value), props);
}

await check("artifact_missing_on_reopen", async (page) => {
  await render(page, { status: "ready", diagramId: "expired-id", title: "Expired", type: "architecture" });
  await page.getByRole("alert").getByText(/no longer available/i).waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
});

await check("building_to_ready_and_failed", async (page) => {
  const id = "browser-ready";
  artifactRegistry.set(id, { title: "Ready", type: "architecture", html: "<!doctype html><title>Ready diagram</title>", hash: "test" });
  try {
    await render(page, { status: "building", title: "Ready" });
    await page.getByRole("status").getByText(/building/i).waitFor();
    await render(page, { status: "ready", diagramId: id, title: "Ready", type: "architecture" });
    const frame = page.frameLocator("iframe");
    await frame.locator("title").waitFor({ state: "attached" });
    assert.equal(await page.locator("iframe").getAttribute("sandbox"), "allow-scripts allow-downloads");
    await render(page, { status: "building", title: "Other" });
    await render(page, { status: "failed", title: "Other", error: "invalid layout" });
    await page.getByRole("alert").getByText(/invalid layout/).waitFor();
    assert.equal(await page.locator("iframe").count(), 0);
  } finally { artifactRegistry.delete(id); }
});

await check("retry_after_fetch_failure", async (page) => {
  const id = "browser-retry";
  artifactRegistry.set(id, { title: "Retry", type: "architecture", html: "<!doctype html><title>Retry diagram</title>", hash: "test" });
  let failedOnce = false;
  await page.route(`**/api/artifacts/${id}`, async (route) => {
    if (!failedOnce) { failedOnce = true; await route.abort("failed"); }
    else await route.continue();
  });
  try {
    await render(page, { status: "ready", diagramId: id, title: "Retry", type: "architecture" });
    await page.getByRole("button", { name: "Retry" }).click();
    await page.frameLocator("iframe").locator("title").waitFor({ state: "attached" });
  } finally { artifactRegistry.delete(id); }
});

await check("encoded_id_and_ready_switch_wait_for_availability", async (page) => {
  const first = "first-ready";
  const second = "encoded ?# ready";
  artifactRegistry.set(first, { title: "First", type: "architecture", html: "<!doctype html><title>First</title>", hash: "test" });
  artifactRegistry.set(second, { title: "Second", type: "architecture", html: "<!doctype html><title>Second</title>", hash: "test" });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let availabilityRequested = false;
  let earlyIframeRequest = false;
  const secondUrl = `${harness.baseUrl}/api/artifacts/encoded%20%3F%23%20ready`;
  page.on("request", (request) => {
    if (request.url() === secondUrl && request.resourceType() === "document") earlyIframeRequest = true;
  });
  await page.route("**/api/artifacts/encoded%20%3F%23%20ready", async (route) => {
    if (route.request().resourceType() === "fetch") {
      availabilityRequested = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await render(page, { status: "ready", diagramId: first, title: "First", type: "architecture" });
    await page.frameLocator("iframe").locator("title").waitFor({ state: "attached" });
    await render(page, { status: "ready", diagramId: second, title: "Second", type: "architecture" });
    await page.waitForRequest((request) => request.url() === secondUrl && request.resourceType() === "fetch");
    await page.waitForTimeout(100);
    assert.equal(availabilityRequested, true, "second artifact availability request should be held");
    assert.equal(earlyIframeRequest, false, "second artifact iframe must not be requested before availability succeeds");
    assert.equal(await page.locator("iframe").count(), 0);
    release();
    await page.frameLocator("iframe").locator("title").waitFor({ state: "attached" });
    assert.match(await page.locator("iframe").getAttribute("src"), /encoded%20%3F%23%20ready$/);
  } finally {
    release();
    artifactRegistry.delete(first);
    artifactRegistry.delete(second);
  }
});

await check("generated_artifact_downloads_from_view_level_harness", async (page) => {
  const spec = JSON.parse(readFileSync(new URL("../server/examples/diagrams/prompt-example.architecture.json", import.meta.url), "utf8"));
  const result = await executeDiagramTool(JSON.stringify({ title: "Download diagram", type: "architecture", spec }));
  assert.equal(result.ok, true, JSON.stringify(result));
  try {
    await render(page, { status: "ready", diagramId: result.diagramId, title: result.title, type: result.type });
    const frame = page.frameLocator("iframe");
    await frame.locator("body").waitFor();
    await page.frame({ url: new RegExp(`/api/artifacts/${result.diagramId}$`) }).waitForFunction(() => Boolean(window.Diagramify?.exportMenu));
    for (const format of ["SVG", "PNG"]) {
      await frame.getByRole("button", { name: "Export diagram" }).click();
      await frame.locator("#export-menu.open").waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        frame.locator(`button[data-format="${format.toLowerCase()}"]`).click(),
      ]).catch(async (error) => {
        const receipt = await frame.locator("html").evaluate((element) => ({
          format: element.getAttribute("data-last-export-format"),
          bytes: element.getAttribute("data-last-export-bytes"),
          error: element.getAttribute("data-last-export-error"),
        }));
        throw new Error(`${error.message}; export receipt: ${JSON.stringify(receipt)}`);
      });
      assert.match(download.suggestedFilename(), new RegExp(`\\.${format.toLowerCase()}$`, "i"));
    }
  } finally { artifactRegistry.delete(result.diagramId); }
});

await check("app_tool_result_open_and_reopen_lifecycle", async (page) => {
  const args = {
    title: "Host lifecycle diagram",
    type: "architecture",
    spec: JSON.parse(readFileSync(new URL("../server/examples/diagrams/prompt-example.architecture.json", import.meta.url), "utf8")),
  };
  const result = await executeDiagramTool(JSON.stringify(args));
  assert.equal(result.ok, true, JSON.stringify(result));
  const id = result.diagramId;
  harness.setHostChatFixture({ args: JSON.stringify(args), result });
  try {
    const input = page.locator("textarea").first();
    await input.waitFor({ state: "visible" });
    await input.fill("Create an interactive architecture diagram");
    await page.getByRole("button", { name: /^(Send|Send message)$/ }).first().click();

    const preview = page.getByRole("button", { name: /Host lifecycle diagram.*Open/ });
    await preview.waitFor({ state: "visible" });
    await preview.click();
    await page.getByRole("region", { name: "Host lifecycle diagram" }).waitFor({ state: "visible" });
    const frame = page.frameLocator("iframe");
    await frame.locator("head > title").waitFor({ state: "attached" });
    for (const format of ["SVG", "PNG"]) {
      await frame.getByRole("button", { name: "Export diagram" }).click({ timeout: 3000 });
      await frame.locator("#export-menu.open").waitFor();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        frame.locator(`button[data-format="${format.toLowerCase()}"]`).click(),
      ]);
      assert.match(download.suggestedFilename(), new RegExp(`\\.${format.toLowerCase()}$`, "i"));
    }

    await page.getByRole("button", { name: "Close detailed-view panel" }).click();
    await page.locator("iframe").waitFor({ state: "detached" });
    artifactRegistry.delete(id);

    await preview.click();
    await page.getByRole("alert").getByText(/no longer available/i).waitFor({ state: "visible" });
    assert.equal(await page.locator("iframe").count(), 0);
  } finally {
    artifactRegistry.delete(id);
    harness.setHostChatFixture(null);
  }
}, "/__artifact_host");

await browser.close();
await harness.close();
process.exitCode = failures ? 1 : 0;
