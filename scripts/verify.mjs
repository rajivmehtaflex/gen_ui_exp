// Aggregate offline verification: every hermetic check in one sequential run —
// spec/recipe/examples/diagram/library/layout/tool/wire/artifact/input/loop/
// process/store/resource/prompt/routing/smoke-gates/harness/error — then the
// keyless smoke pair and the render gate against a harness-started canned
// server, then the client build. Stops at the first failing check.
//
// Hermetic by construction:
//   - provider env (OPENROUTER_*) is cleared for this process and every child,
//   - the only server started here is keyless canned mode via
//     scripts/test-harness.mjs startTestServer (isolated port, readiness proved
//     to belong to its child),
//   - there is no paid live smoke path in this file.
// Browser checks are NOT part of verify: they need a Playwright Chromium
// install and run through `npm run test:browser` (see .github/workflows/
// verify.yml, which installs Chromium for that job).
//
// Run: npm run verify
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startTestServer } from "./test-harness.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const CHECK_TIMEOUT_MS = 300_000; // every check below already bounds itself far below this

// An inherited key would turn the "keyless" smoke phase into a paid live run,
// so provider config never reaches any child of this process. startTestServer
// enforces the same rule again for the server it spawns.
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase().startsWith("OPENROUTER_")) delete process.env[key];
}

// The plan's aggregate list, in order. Each entry runs through its npm script
// so verify also proves the script entries themselves work.
const npmChecks = [
  ["spec", "check:spec"],
  ["recipe", "check:recipe"],
  ["examples", "check:examples"],
  ["diagram", "check:diagram"],
  ["library", "test:library"],
  ["layout", "test:layout"],
  ["tool", "test:tool"],
  ["wire", "test:wire"],
  ["artifact", "test:artifact"],
  ["input", "test:input"],
  ["loop", "test:loop"],
  ["process", "test:process"],
  ["store", "test:store"],
  ["resource", "test:resource"],
  ["prompt", "test:prompt"],
  ["routing", "test:routing"],
  ["smoke", "test:smoke-gates"],
  ["vendor", "check:vendor"],
  ["harness", "test:harness"],
  ["error", "test:error"],
];

const flowPrompt =
  "Show our order pipeline as a flow diagram: customer places order, payment verified (failure goes back to customer), kitchen prepares, delivered. Label each arrow.";

function runStep(label, command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    });
    const timer = setTimeout(() => {
      console.error(`\nverify: ${label} exceeded ${CHECK_TIMEOUT_MS / 1000}s — killing it`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000);
    }, CHECK_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, detail: error.message });
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, detail: signal ? `killed by ${signal}` : `exit ${code}` });
    });
  });
}

const startedAt = Date.now();
const total = npmChecks.length + 5; // test server start + text smoke + diagram smoke + render gate + build
let step = 0;

async function runAndStopOnFailure(label, detail, command, args) {
  step += 1;
  console.log(`\n=== [${step}/${total}] ${label} (${detail}) ===`);
  const result = await runStep(label, command, args);
  if (!result.ok) {
    console.error(`\nverify FAILED at [${step}/${total}] ${label} — ${result.detail}`);
    process.exit(1);
  }
}

for (const [name, script] of npmChecks) {
  await runAndStopOnFailure(name, `npm run ${script}`, npm, ["run", script]);
}

// Server-backed offline phase: one keyless canned server, three real gates.
step += 1;
console.log(`\n=== [${step}/${total}] starting keyless canned test server (startTestServer) ===`);
let server;
try {
  server = await startTestServer({ mode: "canned" });
} catch (error) {
  console.error(`\nverify FAILED at [${step}/${total}] — test server did not start:\n${error.message}`);
  process.exit(1);
}
try {
  const health = await (await fetch(`${server.baseUrl}/api/health`)).json();
  console.log(`canned server ready at ${server.baseUrl} (mode: ${health.mode}, model: ${JSON.stringify(health.model)})`);
  await runAndStopOnFailure("smoke", "keyless text — scripts/live-smoke.mjs", process.execPath, ["scripts/live-smoke.mjs", server.baseUrl]);
  await runAndStopOnFailure("diagram smoke", "keyless interactive — scripts/live-diagram-smoke.mjs", process.execPath, ["scripts/live-diagram-smoke.mjs", server.baseUrl]);
  await runAndStopOnFailure("render", "keyless flow render gate — scripts/check-render.tsx", tsx, ["scripts/check-render.tsx", flowPrompt, server.baseUrl, "FlowDiagram"]);
} finally {
  await server.stop();
}

await runAndStopOnFailure("build", "npm run build", npm, ["run", "build"]);

console.log(`\nverify OK — ${total}/${total} steps passed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
