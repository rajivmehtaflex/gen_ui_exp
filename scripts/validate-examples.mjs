// Gate for promptOptions.examples: every example must parse with 0 errors
// against the CURRENT library (an invalid example would regress reliability),
// the set must be reasonably sized, and the diagram vocabulary must be covered.
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const parser = createParser(spec.library.schema, spec.library.root);

const examples = spec.promptOptions?.examples ?? [];
let failed = 0;

examples.forEach((ex, i) => {
  const lines = ex.split("\n");
  const body = /^Example\b/i.test(lines[0]) ? lines.slice(1).join("\n") : ex;
  const result = parser.parse(body);
  const errors = result.meta?.errors ?? [];
  if (errors.length > 0) {
    failed += 1;
    console.error(`example ${i + 1}: INVALID — ${errors.length} error(s)`);
    for (const e of errors.slice(0, 5)) console.error("  -", JSON.stringify(e).slice(0, 220));
  } else {
    console.log(`example ${i + 1}: clean`);
  }
});

if (examples.length < 8) {
  failed += 1;
  console.error(`only ${examples.length} example(s) — need >= 8 (built-ins + one per diagram family)`);
}

const haystack =
  examples.join("\n") + "\n" + JSON.stringify(spec.library.componentGroups ?? []);
for (const name of [
  "FlowDiagram", "FlowNode", "FlowEdge",
  "SequenceDiagram", "Participant", "Message",
  "StepExplainer", "ExplainerStep",
]) {
  if (!haystack.includes(name)) {
    failed += 1;
    console.error(`${name}: not covered by any example or group`);
  }
}

if (failed > 0) {
  console.error(`${failed} example-gate failure(s)`);
  process.exit(1);
}
console.log(
  `${examples.length}/${examples.length} examples parse clean; diagram vocabulary covered`,
);
