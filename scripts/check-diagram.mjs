// Gate for the vendored diagramify pipeline: every diagram fixture must pass
// `diagramify validate <type> <spec> --quality showcase --json` with exit 0,
// a passing receipt, and 0 composition errors AND 0 warnings. The vendored CLI
// runs as a subprocess (later stages shell out to it too), so this checks the
// exact integration surface: missing vendor tree, non-zero subprocess exit, or
// a receipt that reports errors/warnings all fail the gate.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const cli = path.join(repoRoot, "server", "vendor", "diagramify", "bin", "diagramify.mjs");
const diagramsDir = path.join(repoRoot, "server", "examples", "diagrams");

// [spec file, diagram type] — the 6 type fixtures plus the prompt example.
const SPECS = [
  ["architecture.json", "architecture"],
  ["workflow.json", "workflow"],
  ["sequence.json", "sequence"],
  ["dataflow.json", "dataflow"],
  ["lifecycle.json", "lifecycle"],
  ["explainer-steps.json", "explainer-steps"],
  ["prompt-example.architecture.json", "architecture"],
];

const failures = [];

if (!existsSync(cli)) {
  console.error(`vendor CLI missing: ${path.relative(repoRoot, cli)}`);
  console.error("Run the vendoring step (copy the diagramify skill folder into server/vendor/diagramify).");
  process.exit(1);
}

for (const [file, type] of SPECS) {
  const specPath = path.join(diagramsDir, file);
  const result = spawnSync(
    process.execPath,
    [cli, "validate", type, specPath, "--quality", "showcase", "--json"],
    { cwd: repoRoot, encoding: "utf8" },
  );

  const problems = [];
  if (result.error) {
    problems.push(`spawn failed: ${result.error.message}`);
  } else if (result.status !== 0) {
    const reason = strip(result.stderr) || receiptError(result.stdout) || "(no diagnostics)";
    problems.push(`exit ${result.status}: ${reason}`);
  } else {
    let receipt;
    try {
      receipt = JSON.parse(result.stdout);
    } catch {
      problems.push(`stdout is not a JSON receipt: ${strip(result.stdout).slice(0, 200)}`);
    }
    if (receipt) {
      if (receipt.ok !== true) problems.push("receipt reports ok=false");
      const summary = receipt.composition?.summary;
      if (!summary) {
        problems.push("receipt has no composition summary");
      } else {
        if (summary.errors > 0) problems.push(`${summary.errors} error(s)`);
        if (summary.warnings > 0) problems.push(`${summary.warnings} warning(s)`);
      }
    }
  }

  if (problems.length > 0) {
    failures.push(`${file}: ${problems.join("; ")}`);
    console.error(`${file}: FAIL — ${problems.join("; ")}`);
  } else {
    console.log(`${file}: clean`);
  }
}

if (failures.length > 0) {
  console.error(`${failures.length}/${SPECS.length} diagram spec(s) failed showcase validation:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`${SPECS.length}/${SPECS.length} specs pass showcase validation`);

function strip(text) {
  return String(text ?? "").trim();
}

// On failure the CLI still prints its JSON receipt on stdout — surface the
// reason instead of a bare exit code.
function receiptError(stdout) {
  try {
    const receipt = JSON.parse(stdout);
    return receipt.error || receipt.diagnostics?.[0]?.message || null;
  } catch {
    return null;
  }
}
