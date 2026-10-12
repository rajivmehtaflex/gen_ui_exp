// Hermetic test-server harness. startTestServer spawns server/chat.mjs on an
// ISOLATED port with provider env cleared, and its readiness proof belongs to
// the child: the health response is only trusted after the listening socket's
// owner PID (read from /proc on Linux) is the child itself, so a decoy server
// that happens to hold the port can never be adopted as if it were ours.
// This file also carries the harness's own behavioral checks; they run when it
// is executed directly and are skipped when another module imports the harness.
// Plain node, no test framework. Run: node scripts/test-harness.mjs
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";

const SERVER_PATH = fileURLToPath(new URL("../server/chat.mjs", import.meta.url));

// Any parent OPENROUTER_* variable is provider configuration and must never
// reach a test child: an inherited key would silently flip canned fixtures
// into paid live mode.
export const PROVIDER_ENV_PREFIX = "OPENROUTER_";

const READINESS_TIMEOUT_MS = 15_000;
const READINESS_POLL_MS = 100;
const OUTPUT_TAIL_BYTES = 8 * 1024;

export function clearProviderEnv(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key.toUpperCase().startsWith(PROVIDER_ENV_PREFIX)) delete env[key];
  }
  return env;
}

// Grab a free port from the kernel, then release it for the child to bind.
// The tiny bind/unbind race is closed by the readiness proof below: a child
// that loses it dies with EADDRINUSE and is reported as exited, never as ready.
export async function allocateIsolatedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

// Keep a bounded tail of a child stream so failures carry their evidence
// without letting a chatty server grow the parent's memory.
function captureStream(stream) {
  let tail = "";
  let bytes = 0;
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    bytes += Buffer.byteLength(chunk, "utf8");
    tail = (tail + chunk).slice(-OUTPUT_TAIL_BYTES);
  });
  return {
    tail: () => tail,
    bytes: () => bytes,
  };
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 'exit' can fire before stdio has been flushed; 'close' fires once the pipes
// are drained, so a failure reported after this call carries complete output.
async function drainUntilClosed(child, timeoutMs = 5000) {
  await Promise.race([
    new Promise((resolve) => child.once("close", resolve)),
    delay(timeoutMs),
  ]);
}

// startTestServer({mode, env}) -> Promise<{baseUrl, child, stop}>
//   mode: "canned" (default, provider env stripped and a key is refused) or
//         "live" (requires OPENROUTER_API_KEY in env — tests provide a fake).
//   env:  extra child environment; it wins over the cleared parent env, except
//         PORT, which always belongs to the harness.
//   port/serverPath/readinessTimeoutMs are internal seams for harness checks.
//
// Readiness is proved to belong to THIS child: health alone is not enough (a
// decoy holding the port answers it too), so after health answers, the LISTEN
// socket's owner PID is read from /proc and must be child.pid. Off Linux the
// proof degrades to post-health liveness, documented at the use site.
export async function startTestServer({
  mode = "canned",
  env: extraEnv = {},
  port,
  serverPath = SERVER_PATH,
  readinessTimeoutMs = READINESS_TIMEOUT_MS,
} = {}) {
  if (mode !== "canned" && mode !== "live") {
    throw new Error(`startTestServer: mode must be "canned" or "live", got ${JSON.stringify(mode)}`);
  }
  const env = { ...clearProviderEnv(), ...extraEnv };
  const key = typeof env.OPENROUTER_API_KEY === "string" ? env.OPENROUTER_API_KEY.trim() : "";
  if (mode === "canned" && key) {
    throw new Error('startTestServer: mode "canned" refuses OPENROUTER_API_KEY — canned fixtures must stay keyless (use mode "live")');
  }
  if (mode === "live" && !key) {
    throw new Error('startTestServer: mode "live" needs OPENROUTER_API_KEY in env');
  }
  const targetPort = port ?? await allocateIsolatedPort();
  env.PORT = String(targetPort); // the harness owns the port; callers cannot move it

  const child = spawn(process.execPath, [serverPath], { env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = captureStream(child.stdout);
  const stderr = captureStream(child.stderr);
  let spawnError = null;
  child.once("error", (error) => { spawnError = error; });

  // Failures carry the drained captured output: the tail is the evidence, and
  // it is bounded so a chatty child cannot grow the parent.
  const describe = (headline) =>
    `${headline}\n  stdout tail: ${JSON.stringify(stdout.tail())}\n  stderr tail: ${JSON.stringify(stderr.tail())}`;
  const exited = () => child.exitCode !== null || child.signalCode !== null;

  let stopPromise = null;
  const stop = () => {
    if (!stopPromise) {
      stopPromise = (async () => {
        if (!exited()) {
          child.kill("SIGTERM");
          await Promise.race([once(child, "exit"), delay(3000)]);
          if (!exited()) {
            child.kill("SIGKILL");
            await Promise.race([once(child, "exit"), delay(2000)]);
          }
        }
        await drainUntilClosed(child);
      })();
    }
    return stopPromise;
  };

  try {
    await waitReady({ port: targetPort, mode, child, exited, describe, readinessTimeoutMs, spawnErrorRef: () => spawnError });
  } catch (error) {
    await stop();
    throw error;
  }

  return { baseUrl: `http://127.0.0.1:${targetPort}`, port: targetPort, child, stop, output: { stdout, stderr } };
}

function assertHealthMatches(health, mode) {
  const actual = JSON.stringify(health);
  if (health?.mode !== mode) {
    throw new Error(
      `test server answers ${JSON.stringify(health?.mode)} mode but ${JSON.stringify(mode)} was requested — ` +
      `provider env leaked or live config is incomplete (health: ${actual})`,
    );
  }
  if (mode === "canned" && health.model !== "") {
    throw new Error(`canned test server reports a model (${actual}) — OPENROUTER_MODEL leaked into the child`);
  }
  if (mode === "live" && !health.model) {
    throw new Error(`live test server reports no model (${actual})`);
  }
}

async function waitReady({ port, mode, child, exited, describe, readinessTimeoutMs, spawnErrorRef }) {
  const deadline = Date.now() + readinessTimeoutMs;
  for (;;) {
    if (spawnErrorRef()) throw new Error(describe(`test server could not be spawned: ${spawnErrorRef().message}`));
    if (exited()) {
      await drainUntilClosed(child); // the exit report must carry the full output
      const detail = child.signalCode ? `signal ${child.signalCode}` : `code ${child.exitCode}`;
      throw new Error(describe(`test server exited before it became healthy (${detail})`));
    }
    let health = null;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) health = await res.json();
    } catch { /* the child is not accepting connections yet */ }
    if (health) {
      assertHealthMatches(health, mode);
      await assertPortBelongsToChild({ port, pid: child.pid, exited, describe });
      if (exited()) throw new Error(describe("test server exited right after answering health"));
      return health;
    }
    if (Date.now() > deadline) {
      throw new Error(describe(`test server did not become healthy within ${readinessTimeoutMs} ms`));
    }
    await delay(READINESS_POLL_MS);
  }
}

// LISTEN socket inodes for `port`, from the kernel tables (state 0A = LISTEN).
function readListeningInodes(port) {
  const inodes = [];
  const portHex = port.toString(16);
  for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = readFileSync(table, "utf8");
    } catch {
      continue; // IPv6 table can be absent
    }
    for (const line of text.split("\n").slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 10 || columns[3] !== "0A") continue;
      const localPortHex = columns[1].split(":")[1];
      if (localPortHex && localPortHex.toLowerCase() === portHex) inodes.push(columns[9]);
    }
  }
  return inodes;
}

function socketOwnerPid(inode) {
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${entry}/fd`);
    } catch {
      continue; // vanished or not ours to read
    }
    for (const fd of fds) {
      let link;
      try {
        link = readlinkSync(`/proc/${entry}/fd/${fd}`);
      } catch {
        continue;
      }
      if (link === `socket:[${inode}]`) return Number(entry);
    }
  }
  return null;
}

async function assertPortBelongsToChild({ port, pid, exited, describe }) {
  if (process.platform !== "linux" || !existsSync("/proc/net/tcp")) {
    // No /proc: a child that lost the port bind dies at startup, so require it
    // to still be alive shortly after health answered. Honest, but weaker than
    // the /proc ownership proof; CI and the dev containers run on Linux.
    await delay(400);
    if (exited()) {
      throw new Error(describe("test server died right after answering health — something else holds its port"));
    }
    return;
  }
  let inodes = [];
  for (let attempt = 0; attempt < 5 && inodes.length === 0; attempt++) {
    inodes = readListeningInodes(port);
    if (inodes.length === 0) await delay(50);
  }
  if (inodes.length === 0) {
    throw new Error(describe(`cannot prove readiness: no LISTEN socket found under /proc for port ${port}`));
  }
  const owner = socketOwnerPid(inodes[0]);
  if (owner === null) {
    throw new Error(describe(`cannot prove readiness: no readable process owns the LISTEN socket on port ${port}`));
  }
  if (owner !== pid) {
    throw new Error(describe(`port ${port} is served by PID ${owner}, not this test server (PID ${pid}) — refusing to adopt a foreign server`));
  }
}

function once(emitter, event) {
  return new Promise((resolve) => emitter.once(event, resolve));
}

// ---------------------------------------------------------------------------
// Harness checks (only when this file is the entry point).
// ---------------------------------------------------------------------------
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let failures = 0;
  function check(name, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => console.log(`PASS  ${name}`))
      .catch((e) => {
        failures++;
        console.error(`FAIL  ${name}\n      ${e.message}`);
      });
  }

  // Run fn with a synthetic provider-keyed parent config, then restore the
  // real environment whatever happens.
  async function withParentProviderEnv(fn) {
    const saved = {
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    };
    process.env.OPENROUTER_API_KEY = "sk-or-parent-leak";
    process.env.OPENROUTER_MODEL = "parent/leak-model";
    try {
      return await fn();
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  await check("harness_exports_the_documented_interface", () => {
    assert.equal(typeof startTestServer, "function", "startTestServer must be exported");
    assert.equal(typeof allocateIsolatedPort, "function", "allocateIsolatedPort must be exported");
    assert.equal(typeof clearProviderEnv, "function", "clearProviderEnv must be exported");
    const cleared = clearProviderEnv({
      OPENROUTER_API_KEY: "leak",
      OPENROUTER_MODEL: "leak",
      OPENROUTER_BASE_URL: "http://leak",
      PORT: "1234",
      PATH: "/usr/bin",
    });
    assert.deepEqual(Object.keys(cleared).sort(), ["PATH", "PORT"], "every OPENROUTER_* var must be stripped, nothing else");
  });

  await check("parent_env_does_not_change_mode", async () => {
    await withParentProviderEnv(async () => {
      // A canned child must stay keyless even when the parent is configured
      // for a paid provider — and the harness must refuse a canned request
      // that itself tries to smuggle a key in.
      await assert.rejects(
        startTestServer({ mode: "canned", env: { OPENROUTER_API_KEY: "sk-or-smuggled" } }),
        /canned/i,
        "canned mode must refuse an explicit OPENROUTER_API_KEY",
      );
      const server = await startTestServer({ mode: "canned" });
      try {
        assert.match(server.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/, "baseUrl must point at the isolated port");
        assert.equal(typeof server.stop, "function", "handle must expose stop()");
        assert.ok(Number.isInteger(server.child?.pid), "handle must expose the child process");
        const health = await (await fetch(`${server.baseUrl}/api/health`)).json();
        assert.equal(health.mode, "canned", `parent OPENROUTER_* env leaked into the child: ${JSON.stringify(health)}`);
        assert.equal(health.model, "", "parent OPENROUTER_MODEL leaked into the child");
      } finally {
        await server.stop();
      }
    });
  });

  await check("occupied_port_not_accepted", async () => {
    const port = await allocateIsolatedPort();
    // A decoy that answers /api/health exactly like the real canned child:
    // readiness-by-health-alone would adopt it, so this check fails while the
    // harness can be fooled.
    const { default: http } = await import("node:http");
    const decoyHttp = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ mode: "canned", model: "" }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise((resolve) => decoyHttp.listen(port, "127.0.0.1", resolve));
    try {
      await assert.rejects(
        startTestServer({ mode: "canned", port }),
        (error) => {
          assert.match(
            error.message,
            /exited before it became healthy|served by PID/,
            `expected an occupied-port rejection, got: ${error.message}`,
          );
          return true;
        },
      );
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
      assert.equal(health.mode, "canned", "the decoy must be untouched by the rejected start");
    } finally {
      await new Promise((resolve) => decoyHttp.close(resolve));
    }
  });

  await check("child_exit_is_detected_and_output_is_drained", async () => {
    // Live mode with a key but no model is the server's documented fail-fast
    // startup: the child must be reported as exited, and the captured output
    // (not a generic timeout) must carry its reason.
    await assert.rejects(
      startTestServer({ mode: "live", env: { OPENROUTER_API_KEY: "sk-or-test-invalid" } }),
      (error) => {
        assert.match(error.message, /exited before it became healthy/, `expected an exit report, got: ${error.message}`);
        assert.match(error.message, /OPENROUTER_MODEL is empty/, "drained server output must include the fail-fast reason");
        return true;
      },
    );
  });

  await check("stop_releases_the_port_and_settles_the_child", async () => {
    const server = await startTestServer({ mode: "canned" });
    const { baseUrl, port, child } = server;
    const health = await (await fetch(`${baseUrl}/api/health`)).json();
    assert.equal(health.mode, "canned");
    await server.stop();
    assert.ok(child.exitCode !== null || child.signalCode !== null, "child must be settled after stop()");
    const reborn = createServer();
    await new Promise((resolve, reject) => {
      reborn.once("error", reject);
      reborn.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => reborn.close(resolve));
  });

  process.exit(failures ? 1 : 0);
}
