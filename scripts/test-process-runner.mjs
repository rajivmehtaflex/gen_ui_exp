import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { getEventListeners } from "node:events";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const { runProcessTree } = await import("../server/process-runner.mjs");
const fixture = fileURLToPath(new URL("./fixtures/process-tree.mjs", import.meta.url));
const cases = [];
function check(name, fn) { cases.push({ name, fn }); }
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; }
}
async function waitDead(pid) {
  for (let i = 0; i < 40 && alive(pid); i++) await delay(25);
  assert.equal(alive(pid), false, `PID ${pid} survived`);
}
function pids(stdout) {
  const match = stdout.match(/(\d+):(\d+)/);
  assert.ok(match, `missing process PIDs: ${stdout}`);
  return match.slice(1).map(Number);
}

check("abort_kills_descendants", async () => {
  const controller = new AbortController();
  const before = getEventListeners(controller.signal, "abort").length;
  const result = await runProcessTree({ file: process.execPath, args: [fixture, "parent"],
    signal: controller.signal, timeoutMs: 2000, onStdout: (text) => {
      if (/\d+:\d+/.test(text)) controller.abort();
    } });
  assert.equal(result.ok, false);
  assert.match(result.error, /abort/i);
  for (const pid of pids(result.stdout)) await waitDead(pid);
  assert.equal(getEventListeners(controller.signal, "abort").length, before);
});

check("timeout_kills_descendants_while_checker_runs", async () => {
  const result = await runProcessTree({ file: process.execPath, args: [fixture, "checker"], timeoutMs: 500 });
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/i);
  for (const pid of pids(result.stdout)) await waitDead(pid);
});

check("already_aborted_no_spawn", async () => {
  const controller = new AbortController(); controller.abort();
  const result = await runProcessTree({ file: "/definitely/missing/binary", args: [], signal: controller.signal });
  assert.equal(result.ok, false);
  assert.match(result.error, /abort/i);
});

check("spawn_error_settles_once", async () => {
  const result = await Promise.race([
    runProcessTree({ file: "/definitely/missing/binary", args: [], timeoutMs: 100 }),
    delay(1000).then(() => { throw new Error("spawn error did not settle"); }),
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /spawn|ENOENT|run/i);
});

check("output_limit_kills_descendants", async () => {
  const result = await runProcessTree({ file: process.execPath, args: [fixture, "flood"],
    timeoutMs: 2000, maxOutputBytes: 1024 });
  assert.equal(result.ok, false);
  assert.match(result.error, /output/i);
  assert.ok(Buffer.byteLength(result.stdout) <= 1024);
});

check("stderr_output_limit_is_bounded", async () => {
  const result = await runProcessTree({ file: process.execPath, args: [fixture, "flood-stderr"],
    timeoutMs: 2000, maxOutputBytes: 1024 });
  assert.equal(result.ok, false);
  assert.match(result.error, /stderr output/i);
  assert.ok(Buffer.byteLength(result.stderr) <= 1024);
});

check("abort_during_validation_cleans_vendor_staging", async () => {
  const { executeDiagramTool } = await import("../server/diagram-tool.mjs");
  const spec = JSON.parse(readFileSync(new URL("../server/examples/diagrams/architecture.json", import.meta.url), "utf8"));
  const before = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("diagramify-validate-")));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 300);
  let jobDir;
  try {
    const result = await executeDiagramTool(JSON.stringify({ title: "Abort", type: "architecture", spec }),
      controller.signal, { cleanupTempDir: (dir, options) => { jobDir = dir; rmSync(dir, options); } });
    assert.equal(result.ok, false);
    assert.match(result.error, /abort/i);
    assert.equal(existsSync(jobDir), false);
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith("diagramify-validate-") && !before.has(name));
    assert.deepEqual(after, [], `vendor staging escaped the job root: ${after.join(", ")}`);
  } finally { clearTimeout(timer); }
});

check("cleanup_failure_preserves_result", async () => {
  const { executeDiagramTool } = await import("../server/diagram-tool.mjs");
  const spec = JSON.parse(readFileSync(new URL("../server/examples/diagrams/architecture.json", import.meta.url), "utf8"));
  const result = await executeDiagramTool(JSON.stringify({ title: "Cleanup", type: "architecture", spec }), null,
    { cleanupTempDir: (dir, options) => {
      rmSync(dir, options);
      throw new Error("injected cleanup failure");
    } });
  assert.equal(result.ok, true, JSON.stringify(result));
});

let failures = 0;
for (const { name, fn } of cases) {
  try { await fn(); console.log(`PASS  ${name}`); }
  catch (error) { failures++; console.error(`FAIL  ${name}: ${error.stack}`); }
}
process.exitCode = failures ? 1 : 0;
