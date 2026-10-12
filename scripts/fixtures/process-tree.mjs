import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (process.argv[2] === "grandchild") {
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "flood") {
  process.stdout.write("x".repeat(2 * 1024 * 1024));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "flood-stderr") {
  process.stderr.write("x".repeat(2 * 1024 * 1024));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "checker") {
  const checker = fileURLToPath(new URL("../../server/vendor/diagramify/scripts/check-render-output.mjs", import.meta.url));
  const preload = fileURLToPath(new URL("./stall-checker.mjs", import.meta.url));
  const child = spawn(process.execPath, [checker, fileURLToPath(import.meta.url)], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${preload}`.trim() },
  });
  child.stderr.on("data", (chunk) => process.stdout.write(chunk));
  process.stdout.write(`${process.pid}:${child.pid}:${path.basename(checker)}\n`);
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "parent") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "grandchild"], {
    stdio: "ignore",
  });
  process.stdout.write(`${process.pid}:${child.pid}\n`);
  setInterval(() => {}, 1000);
} else {
  process.stdout.write("done\n");
}
