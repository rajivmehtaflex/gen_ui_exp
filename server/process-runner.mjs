import { spawn } from "node:child_process";

// Run a command as a job: its descendants must end before callers remove any
// files that the command may still be using.
export function runProcessTree({ file, args = [], cwd, signal, timeoutMs = 15_000,
  maxOutputBytes = 1024 * 1024, env, onStdout }) {
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
    let termination = Promise.resolve();
    let finished = false;

    const output = () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const settle = async (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      await termination;
      resolve({ ...output(), ...result });
    };
    const terminate = (why) => {
      if (reason || !child?.pid) return;
      reason = why;
      if (process.platform === "win32") {
        termination = new Promise((done) => {
          const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"],
            { stdio: "ignore", windowsHide: true });
          killer.once("error", done);
          killer.once("close", done);
        });
      } else {
        try { process.kill(-child.pid, "SIGKILL"); }
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
