import assert from "node:assert/strict";
import { runStep, withTestServer } from "./verify-runtime.mjs";

let stopped = 0;
const fakeServer = { baseUrl: "http://127.0.0.1:12345", stop: async () => { stopped++; } };
await assert.rejects(
  withTestServer(async () => fakeServer, async () => { throw new Error("smoke failed"); }),
  /smoke failed/,
);
assert.equal(stopped, 1, "a failed server-backed check must still stop its server");

let stdout = "";
const result = await runStep({
  file: process.execPath,
  args: ["-e", "process.stdout.write('started'); setInterval(() => {}, 1000)"],
  cwd: process.cwd(),
  env: process.env,
  timeoutMs: 50,
  maxOutputBytes: 4096,
  onStdout: (chunk) => { stdout += chunk; },
});
assert.equal(result.ok, false, "the verifier runner must return a timeout failure");
assert.match(result.error, /timed out|timeout/i);
assert.equal(stdout, "started", "live stdout should continue through the runner callback");
console.log("test-verify-runtime OK — server cleanup runs after failure; timed commands settle through the process-tree runner");
