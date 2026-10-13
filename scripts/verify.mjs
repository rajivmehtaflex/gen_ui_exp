// Aggregate offline verification: every hermetic check in one sequential run —
// spec/recipe/examples/diagram/library/layout/tool/wire/artifact/input/loop/
// process/store/resource/prompt/routing/smoke-gates/harness/error/verify-runtime,
// then the keyless smoke pair and render gate against a harness-started canned
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
import { fileURLToPath } from "node:url";
import { startTestServer } from "./test-harness.mjs";
import { runStep as runProcessStep, withTestServer } from "./verify-runtime.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const CHECK_TIMEOUT_MS = 300_000;

// An inherited key would turn the "keyless" smoke phase into a paid live run,
// so provider config never reaches this process or any child.
for (const key of Object.keys(process.env)) {
  if (key.toUpperCase().startsWith("OPENROUTER_")) delete process.env[key];
}

// The aggregate list, in order. Each entry runs through its npm script so
// verify also proves the script entries themselves work.
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
  ["verify-runtime", "test:verify-runtime"],
];

const flowPrompt =
  "Show our order pipeline as a flow diagram: customer places order, payment verified (failure goes back to customer), kitchen prepares, delivered. Label each arrow.";

let step = 0;
let total = npmChecks.length + 5; // server start + three server gates + build

async function runStep(label, command, args) {
  const result = await runProcessStep({
    file: command,
    args,
    cwd: repoRoot,
    env: process.env,
    timeoutMs: CHECK_TIMEOUT_MS,
    onStdout: (chunk) => process.stdout.write(chunk),
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return { ok: result.ok, detail: result.error ?? (result.ok ? "exit 0" : "process failed") };
}

async function runAndStopOnFailure(label, detail, command, args) {
  step += 1;
  console.log(`\n=== [${step}/${total}] ${label} (${detail}) ===`);
  const result = await runStep(label, command, args);
  if (!result.ok) {
    throw new Error(`verify FAILED at [${step}/${total}] ${label} — ${result.detail}`);
  }
}

async function main() {
  const startedAt = Date.now();
  for (const [name, script] of npmChecks) {
    await runAndStopOnFailure(name, `npm run ${script}`, npm, ["run", script]);
  }

  try {
    await withTestServer(
      () => startTestServer({ mode: "canned" }),
      async (server) => {
        step += 1;
        console.log(`\n=== [${step}/${total}] starting keyless canned test server (startTestServer) ===`);
        const health = await (await fetch(`${server.baseUrl}/api/health`)).json();
        console.log(`canned server ready at ${server.baseUrl} (mode: ${health.mode}, model: ${JSON.stringify(health.model)})`);
        await runAndStopOnFailure("smoke", "keyless text — scripts/live-smoke.mjs", process.execPath, ["scripts/live-smoke.mjs", server.baseUrl]);
        await runAndStopOnFailure("diagram smoke", "keyless interactive — scripts/live-diagram-smoke.mjs", process.execPath, ["scripts/live-diagram-smoke.mjs", server.baseUrl]);
        await runAndStopOnFailure("render", "keyless flow render gate — scripts/check-render.tsx", tsx, ["scripts/check-render.tsx", flowPrompt, server.baseUrl, "FlowDiagram"]);
      },
    );
  } catch (error) {
    throw new Error(`keyless server-backed phase failed: ${error.message}`, { cause: error });
  }

  await runAndStopOnFailure("build", "npm run build", npm, ["run", "build"]);
  console.log(`\nverify OK — ${total}/${total} steps passed in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
