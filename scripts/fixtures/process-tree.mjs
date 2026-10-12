import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "grandchild") {
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "flood") {
  process.stdout.write("x".repeat(2 * 1024 * 1024));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "flood-stderr") {
  process.stderr.write("x".repeat(2 * 1024 * 1024));
  setInterval(() => {}, 1000);
} else if (process.argv[2] === "checker" || process.argv[2] === "parent") {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "grandchild"], {
    stdio: "ignore",
  });
  process.stdout.write(`${process.pid}:${child.pid}\n`);
  setInterval(() => {}, 1000);
} else {
  process.stdout.write("done\n");
}
