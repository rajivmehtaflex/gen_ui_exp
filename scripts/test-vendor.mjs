// Vendor provenance regressions. Run with: node scripts/test-vendor.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(repoRoot, "server", "vendor", "diagramify");
const checker = path.join(repoRoot, "scripts", "check-vendor.mjs");
const generatedFiles = new Set([
  "renderers/shared/generated-validators.mjs",
  "renderers/shared/generated-brand-marks.mjs",
]);
let failures = 0;
let checks = 0;

function runChecker(root = vendorRoot) {
  return spawnSync(process.execPath, [checker, "--vendor-root", root], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 90_000,
  });
}

function outputOf(result) {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
}

function copyVendorFixture() {
  const parent = mkdtempSync(path.join(os.tmpdir(), "diagramify-vendor-test-"));
  const root = path.join(parent, "diagramify");
  cpSync(vendorRoot, root, { recursive: true });
  return { parent, root };
}

function updateManifestHash(root, relativePath) {
  const manifestPath = path.join(root, "vendor-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.files.find((file) => file.path === relativePath);
  assert.ok(entry, `manifest has no entry for ${relativePath}`);
  entry.sha256 = createHash("sha256").update(readFileSync(path.join(root, relativePath))).digest("hex");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function actualVendorFiles(root) {
  const result = [];
  const visit = (directory, prefix = "") => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) visit(path.join(directory, item.name), relative);
      else if (item.isFile() && !["VENDOR.md", "vendor-manifest.json"].includes(relative)) result.push(relative);
    }
  };
  visit(root);
  return result.sort();
}

async function check(name, fn) {
  checks += 1;
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${error.stack ?? error.message}`);
  }
}

await check("vendor_manifest_covers_subset", () => {
  const manifestPath = path.join(vendorRoot, "vendor-manifest.json");
  assert.ok(existsSync(manifestPath), "vendor-manifest.json is missing");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.upstream.revision, "748549b5b6e5687cd6c111dfa130d4ac7714b600");
  assert.equal(manifest.upstream.packageVersion, "2.16.0-dev.0");
  const listed = manifest.files.map((file) => file.path).sort();
  assert.deepEqual(listed, actualVendorFiles(vendorRoot), "every subset file is listed exactly once");
  for (const required of [
    "LICENSE",
    "PATCHES.md",
    "package-lock.json",
    "scripts/generate-validators.mjs",
    "scripts/generate-brand-marks.mjs",
    ...generatedFiles,
  ]) assert.ok(listed.includes(required), `manifest must cover ${required}`);
  assert.ok(manifest.files.some((file) => file.path === "assets/template.html" && file.status === "patched"));
  const result = runChecker();
  assert.equal(result.error, undefined, outputOf(result));
  assert.equal(result.status, 0, outputOf(result));

  const fixture = copyVendorFixture();
  try {
    mkdirSync(path.join(fixture.root, "node_modules", "simple-icons"), { recursive: true });
    writeFileSync(path.join(fixture.root, "node_modules", "simple-icons", "package.json"), '{"version":"16.28.0"}\n');
    const installed = runChecker(fixture.root);
    assert.equal(installed.error, undefined, outputOf(installed));
    assert.equal(installed.status, 0, `vendor-local generator dependencies must stay outside the provenance inventory\n${outputOf(installed)}`);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

await check("schema_change_detects_stale_validator", () => {
  assert.ok(existsSync(checker), "check-vendor.mjs is missing; stale validators cannot be checked");
  assert.ok(existsSync(path.join(vendorRoot, "vendor-manifest.json")), "vendor-manifest.json is missing");
  const fixture = copyVendorFixture();
  try {
    const schemaPath = path.join(fixture.root, "schemas", "architecture.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
    schema.properties.meta.properties.title.minLength = 2;
    writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);
    updateManifestHash(fixture.root, "schemas/architecture.schema.json");
    const result = runChecker(fixture.root);
    assert.notEqual(result.status, 0, "changed schemas must not pass with old generated validators");
    assert.match(outputOf(result), /generated validators are stale/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

await check("upstream_path_mapping_is_enforced", () => {
  const fixture = copyVendorFixture();
  try {
    const manifestPath = path.join(fixture.root, "vendor-manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.files.find((file) => file.path === "schemas/architecture.schema.json").upstreamPath = "diagramify/schemas/workflow.schema.json";
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const result = runChecker(fixture.root);
    assert.notEqual(result.status, 0, "a manifest must not map one vendored file to a different upstream file");
    assert.match(outputOf(result), /upstream path mismatch for schemas\/architecture\.schema\.json/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

await check("brand_inputs_reproduce_catalog", () => {
  assert.ok(existsSync(checker), "check-vendor.mjs is missing; brand outputs cannot be checked");
  assert.ok(existsSync(path.join(vendorRoot, "vendor-manifest.json")), "vendor-manifest.json is missing");
  const baseline = runChecker();
  assert.equal(baseline.error, undefined, outputOf(baseline));
  assert.equal(baseline.status, 0, outputOf(baseline));

  const fixture = copyVendorFixture();
  try {
    const catalogPath = path.join(fixture.root, "brand-marks", "catalog.json");
    const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
    catalog.marks.find((mark) => mark.id === "openai").custom.path += " M0 0";
    writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
    updateManifestHash(fixture.root, "brand-marks/catalog.json");
    const result = runChecker(fixture.root);
    assert.notEqual(result.status, 0, "changed catalog must not pass with old generated brand marks");
    assert.match(outputOf(result), /generated brand marks are stale/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

await check("missing_generator_is_actionable", () => {
  assert.ok(existsSync(checker), "check-vendor.mjs is missing; missing-generator errors cannot be checked");
  assert.ok(existsSync(path.join(vendorRoot, "scripts", "generate-brand-marks.mjs")), "brand generator is missing");
  const fixture = copyVendorFixture();
  try {
    rmSync(path.join(fixture.root, "scripts", "generate-brand-marks.mjs"));
    const result = runChecker(fixture.root);
    assert.notEqual(result.status, 0, "a missing generator must fail the vendor gate");
    assert.match(outputOf(result), /missing generator script.*generate-brand-marks\.mjs/i);
    assert.match(outputOf(result), /pinned upstream revision/i);
  } finally {
    rmSync(fixture.parent, { recursive: true, force: true });
  }
});

if (failures > 0) {
  console.error(`${failures} vendor regression(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${checks}/${checks} vendor provenance and reproducibility checks passed`);
}
