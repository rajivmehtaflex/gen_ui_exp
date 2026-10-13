// Verify the vendored diagramify subset and reproduce generated assets without
// writing into the shipped vendor tree. Run with: node scripts/check-vendor.mjs
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_VENDOR_ROOT = path.join(REPO_ROOT, "server", "vendor", "diagramify");
const PIN = Object.freeze({
  repository: "https://github.com/rajivmehtaflex/diagramify",
  revision: "748549b5b6e5687cd6c111dfa130d4ac7714b600",
  tree: "0e40abe39cbc72fcb52ffc1ba34b8dec96f234b5",
  packageVersion: "2.16.0-dev.0",
  archiveSha256: "800de93b2010db347f40a319d5fd24d617cbb441100f4b16c5dcc71531c2abe1",
  archiveBytes: 17_305_594,
});
const EXCLUDED_FROM_MANIFEST = new Set(["VENDOR.md", "vendor-manifest.json"]);
const GENERATORS = [
  "scripts/generate-validators.mjs",
  "scripts/generate-brand-marks.mjs",
];
const GENERATED = [
  "renderers/shared/generated-validators.mjs",
  "renderers/shared/generated-brand-marks.mjs",
];
const PATCH_TEMPLATE = Object.freeze({
  path: "assets/template.html",
  upstreamSha256: "15d9e25f6577ecd572ea73a103cdccdbc32a956cd08542a00957d524c3d220a5",
  currentSha256: "e7800bc50b1b5196355ca1e33ef881eb7620002906b5bc83767624cb50b172d1",
});

function sha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function json(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is missing or invalid JSON: ${error.message}`);
    return null;
  }
}

function listFiles(root, relative = "") {
  const files = [];
  for (const item of readdirSync(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${item.name}` : item.name;
    if (item.name === "node_modules") continue;
    if (item.isDirectory()) files.push(...listFiles(root, child));
    else if (item.isFile() && !EXCLUDED_FROM_MANIFEST.has(child)) files.push(child);
    else if (item.isSymbolicLink()) throw new Error(`symbolic links are not allowed in the vendor subset: ${child}`);
  }
  return files.sort();
}

function safeManifestPath(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !path.posix.isAbsolute(value)
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function verifyMetadata(vendorRoot, manifest, errors) {
  if (!manifest || manifest.schemaVersion !== 1) {
    errors.push("vendor-manifest.json must use schemaVersion 1");
    return;
  }
  const upstream = manifest.upstream;
  if (!upstream || upstream.repository !== PIN.repository || upstream.revision !== PIN.revision
    || upstream.tree !== PIN.tree || upstream.packageVersion !== PIN.packageVersion) {
    errors.push("vendor source identity differs from the verified pinned upstream revision");
  }
  if (upstream?.sourceArchive?.sha256 !== PIN.archiveSha256
    || upstream?.sourceArchive?.bytes !== PIN.archiveBytes) {
    errors.push("vendor source archive digest or byte count differs from the verified source artifact");
  }

  const vendorPackage = json(path.join(vendorRoot, "package.json"), "vendor package.json", errors);
  if (vendorPackage?.version !== PIN.packageVersion) {
    errors.push(`vendor package version must be ${PIN.packageVersion}`);
  }
  const rootPackage = json(path.join(REPO_ROOT, "package.json"), "root package.json", errors);
  const dependencies = manifest.generatorDependencies;
  const vendorLock = json(path.join(vendorRoot, "package-lock.json"), "vendor package-lock.json", errors);
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (rootPackage?.devDependencies?.[name] !== version) {
      errors.push(`root devDependency ${name} must be pinned to ${version} for vendor reproduction`);
    }
    const installedPath = path.join(REPO_ROOT, "node_modules", name, "package.json");
    const installed = existsSync(installedPath) ? json(installedPath, `${name} installation`, errors) : null;
    if (installed?.version !== version) {
      errors.push(`generator dependency ${name}@${version} is not installed; run npm ci`);
    }
    if (vendorLock?.packages?.[`node_modules/${name}`]?.version !== version) {
      errors.push(`vendor package-lock.json does not pin ${name}@${version}`);
    }
  }
}

function verifyInventory(vendorRoot, manifest, errors) {
  const entries = manifest?.files;
  if (!Array.isArray(entries)) {
    errors.push("vendor-manifest.json must contain a files array");
    return;
  }
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry || !safeManifestPath(entry.path)) {
      errors.push(`manifest contains an unsafe file path: ${JSON.stringify(entry?.path ?? null)}`);
      continue;
    }
    if (byPath.has(entry.path)) errors.push(`manifest lists ${entry.path} more than once`);
    byPath.set(entry.path, entry);
  }

  let actual;
  try {
    actual = listFiles(vendorRoot);
  } catch (error) {
    errors.push(error.message);
    return;
  }
  for (const file of actual) if (!byPath.has(file)) errors.push(`unrecorded vendor file: ${file}`);
  for (const file of byPath.keys()) {
    if (!actual.includes(file)) errors.push(`manifest file is missing from vendor subset: ${file}`);
  }
  for (const [relative, entry] of byPath) {
    const filePath = path.join(vendorRoot, relative);
    if (entry.status !== "local") {
      const expectedUpstreamPath = relative === "LICENSE" ? "LICENSE" : `diagramify/${relative}`;
      if (entry.upstreamPath !== expectedUpstreamPath) {
        errors.push(
          `upstream path mismatch for ${relative}: expected ${expectedUpstreamPath}, got ${JSON.stringify(entry.upstreamPath)}`,
        );
      }
    }
    if (!existsSync(filePath)) continue;
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) {
      errors.push(`manifest entry ${relative} has no lowercase SHA-256`);
      continue;
    }
    const actualHash = sha256(filePath);
    if (actualHash !== entry.sha256) errors.push(`SHA-256 mismatch for ${relative}: expected ${entry.sha256}, got ${actualHash}`);
    if (!["pristine", "patched", "local"].includes(entry.status)) {
      errors.push(`manifest entry ${relative} has unsupported status ${JSON.stringify(entry.status)}`);
    }
    if (entry.status !== "local" && typeof entry.upstreamPath !== "string") {
      errors.push(`upstream file ${relative} has no upstreamPath`);
    }
  }

  for (const required of ["LICENSE", "PATCHES.md", "package-lock.json", ...GENERATORS, ...GENERATED]) {
    if (!byPath.has(required)) errors.push(`manifest does not cover required vendor file ${required}`);
  }
  const license = byPath.get("LICENSE");
  if (license?.status !== "pristine" || license.upstreamPath !== "LICENSE") {
    errors.push("vendor LICENSE must remain the pristine upstream root LICENSE");
  }
  const template = byPath.get(PATCH_TEMPLATE.path);
  if (template?.status !== "patched" || template.upstreamSha256 !== PATCH_TEMPLATE.upstreamSha256
    || template.sha256 !== PATCH_TEMPLATE.currentSha256 || template.patchRecord !== "PATCHES.md") {
    errors.push("assets/template.html must record the verified T5 patch base and PATCHES.md inventory");
  }
  const patches = manifest?.patches;
  if (!Array.isArray(patches) || patches.length !== 1 || patches[0]?.path !== PATCH_TEMPLATE.path) {
    errors.push("manifest patch inventory must list only the documented assets/template.html patch");
  }
  const subset = manifest?.subset;
  const upstreamEntries = entries.filter((entry) => entry?.status === "pristine" || entry?.status === "patched");
  const pristineCount = upstreamEntries.filter((entry) => entry.status === "pristine").length;
  const patchedCount = upstreamEntries.filter((entry) => entry.status === "patched").length;
  const localCount = entries.filter((entry) => entry?.status === "local").length;
  if (subset?.upstreamFileCount !== 174 || subset?.includedUpstreamFiles !== upstreamEntries.length
    || subset?.excludedUpstreamFiles !== 174 - upstreamEntries.length
    || subset?.pristineUpstreamFiles !== pristineCount || subset?.patchedUpstreamFiles !== patchedCount
    || subset?.localFiles !== localCount || upstreamEntries.length !== 66 || pristineCount !== 65
    || patchedCount !== 1 || localCount !== 1) {
    errors.push("manifest subset counts do not reconcile with the pinned 174-file upstream package");
  }
}

function runGenerator(tempVendorRoot, relativeScript) {
  return spawnSync(process.execPath, [path.join(tempVendorRoot, relativeScript)], {
    cwd: tempVendorRoot,
    encoding: "utf8",
    timeout: 90_000,
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
}

function verifyGeneratedOutputs(vendorRoot, errors) {
  const tempParent = mkdtempSync(path.join(os.tmpdir(), "diagramify-vendor-check-"));
  const tempVendorRoot = path.join(tempParent, "diagramify");
  try {
    cpSync(vendorRoot, tempVendorRoot, {
      recursive: true,
      filter: (source) => !path.resolve(source).split(path.sep).includes("node_modules"),
    });
    const rootNodeModules = path.join(REPO_ROOT, "node_modules");
    const tempNodeModules = path.join(tempVendorRoot, "node_modules");
    const symlinkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(rootNodeModules, tempNodeModules, symlinkType);

    for (const [script, output] of GENERATORS.map((file, index) => [file, GENERATED[index]])) {
      const result = runGenerator(tempVendorRoot, script);
      if (result.error || result.status !== 0) {
        const reason = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
        errors.push(`${script} failed in a temporary vendor tree: ${reason}`);
        continue;
      }
      const generatedPath = path.join(tempVendorRoot, output);
      const checkedPath = path.join(vendorRoot, output);
      if (!existsSync(checkedPath) || !readFileSync(generatedPath).equals(readFileSync(checkedPath))) {
        const description = output.includes("generated-validators") ? "generated validators are stale" : "generated brand marks are stale";
        errors.push(`${description}: ${output} does not match the authentic upstream generator output`);
      }
    }
  } finally {
    rmSync(tempParent, { recursive: true, force: true });
  }
}

export function checkVendor(vendorRoot = DEFAULT_VENDOR_ROOT) {
  const errors = [];
  const root = path.resolve(vendorRoot);
  for (const generator of GENERATORS) {
    if (!existsSync(path.join(root, generator))) {
      errors.push(`missing generator script ${generator}; restore it from pinned upstream revision ${PIN.revision}`);
    }
  }
  if (!existsSync(path.join(root, "LICENSE"))) errors.push("vendor LICENSE is missing");
  if (!existsSync(path.join(root, "PATCHES.md"))) errors.push("vendor patch inventory PATCHES.md is missing");
  if (errors.length > 0) return { ok: false, errors };

  const manifest = json(path.join(root, "vendor-manifest.json"), "vendor-manifest.json", errors);
  verifyMetadata(root, manifest, errors);
  verifyInventory(root, manifest, errors);
  if (errors.length > 0) return { ok: false, errors };

  verifyGeneratedOutputs(root, errors);
  return { ok: errors.length === 0, errors };
}

function main() {
  let vendorRoot = DEFAULT_VENDOR_ROOT;
  for (let index = 2; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--vendor-root" && process.argv[index + 1]) {
      vendorRoot = path.resolve(process.argv[index + 1]);
      index += 1;
    } else {
      console.error(`unknown argument: ${process.argv[index]}`);
      process.exitCode = 2;
      return;
    }
  }
  const result = checkVendor(vendorRoot);
  for (const error of result.errors) console.error(`FAIL  ${error}`);
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log("vendor provenance, file hashes, and generated assets are reproducible");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
