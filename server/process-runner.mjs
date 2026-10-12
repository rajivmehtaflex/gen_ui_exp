import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

async function waitForGroupExit(pid) {
  for (;;) {
    try { process.kill(-pid, 0); }
    catch (error) {
      if (error.code === "ESRCH") return;
      throw error;
    }
    await delay(20);
  }
}

// Run a command as a job: its descendants must end before callers remove any
// files that the command may still be using.
export function runProcessTree({ file, args = [], cwd, signal, timeoutMs = 15_000,
  maxOutputBytes = 1024 * 1024, env, onStdout, platform = process.platform }) {
  if (signal?.aborted) {
    return Promise.resolve({ ok: false, stdout: "", stderr: "", error: "process aborted" });
  }

  return new Promise((resolve) => {
    let child;
    let reason;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdoutChunks = [];
    const stderrChunks = [];
    let timer;
    let forceSettleTimer;
    let termination = Promise.resolve();
    let finished = false;

    const output = () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    });
    const cleanup = () => {
      clearTimeout(timer);
      clearTimeout(forceSettleTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = async (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      try { await termination; }
      catch (error) { result = { ok: false, error: `${reason}: group termination failed: ${error.message}` }; }
      resolve({ ...output(), ...result });
    };
    const terminate = (why) => {
      if (reason || !child?.pid) return;
      reason = why;
      if (platform === "win32") {
        termination = new Promise((done) => {
          let killer;
          let doneOnce = false;
          const finish = (error) => {
            if (doneOnce) return;
            doneOnce = true;
            if (error) {
              reason = `${why}: taskkill failed: ${error.message}`;
              try {
                if (process.platform === "win32") child.kill("SIGKILL");
                else process.kill(-child.pid, "SIGKILL");
              } catch { /* Report the taskkill failure even if fallback kill fails. */ }
              // A failed tree killer must not leave the request pending forever.
              forceSettleTimer = setTimeout(() => settle({ ok: false, error: reason }), 1000);
            }
            done();
          };
          try {
            killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"],
              { stdio: "ignore", windowsHide: true });
            killer.once("error", finish);
            killer.once("close", (code) => finish(code === 0 ? null : new Error(`exit code ${code}`)));
          } catch (error) { finish(error); }
        });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
          termination = waitForGroupExit(child.pid);
        }
        catch (error) { if (error.code !== "ESRCH") reason = `${why}: ${error.message}`; }
      }
    };
    const onAbort = () => terminate("process aborted");

    try {
      child = spawn(file, args, {
        cwd, env, stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32", windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, stdout: "", stderr: "", error: `failed to spawn process: ${error.message}` });
      return;
    }

    const collect = (chunk, chunks, stream) => {
      const previous = stream === "stdout" ? stdoutBytes : stderrBytes;
      const remaining = Math.max(0, maxOutputBytes - previous);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      if (stream === "stdout") stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (previous + chunk.length > maxOutputBytes) {
        terminate(`${stream} output exceeded ${maxOutputBytes} bytes`);
      }
      if (stream === "stdout" && onStdout) onStdout(chunk.toString("utf8"));
    };
    child.stdout.on("data", (chunk) => collect(chunk, stdoutChunks, "stdout"));
    child.stderr.on("data", (chunk) => collect(chunk, stderrChunks, "stderr"));
    child.once("error", (error) => {
      reason ||= `failed to spawn process: ${error.message}`;
      settle({ ok: false, error: reason });
    });
    child.once("close", (code) => {
      settle(reason ? { ok: false, error: reason } : code === 0
        ? { ok: true } : { ok: false, error: `process exited with code ${code}` });
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    if (Number.isFinite(timeoutMs) && timeoutMs >= 0) {
      timer = setTimeout(() => terminate(`process timed out after ${timeoutMs}ms`), timeoutMs);
    }
  });
}
