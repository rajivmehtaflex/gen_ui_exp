// Gate for promptOptions.examples: every example must parse with 0 errors
// against the CURRENT library (an invalid example would regress reliability),
// the set must be reasonably sized, and every component the library's Diagrams
// group advertises must be INSTANTIATED by some clean parsed example — a group
// name sitting next to an example proves nothing.
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";
import { parsedComponentNames, verifyExampleCoverage } from "./diagram-smoke-contract.mjs";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const parser = createParser(spec.library.schema, spec.library.root);

const diagramGroup = (spec.library.componentGroups ?? []).find((group) => group?.name === "Diagrams");
if (!diagramGroup) {
  console.error("example-gate failure: the library has no \"Diagrams\" component group to cover");
  process.exit(1);
}

const examples = spec.promptOptions?.examples ?? [];
const parsed = examples.map((ex, i) => {
  const lines = ex.split("\n");
  const body = /^Example\b/i.test(lines[0]) ? lines.slice(1).join("\n") : ex;
  const result = parser.parse(body);
  const errors = result.meta?.errors ?? [];
  if (errors.length > 0) {
    console.log(`example ${i + 1}: INVALID — ${errors.length} error(s)`);
  } else {
    console.log(`example ${i + 1}: clean (${parsedComponentNames(result.root).length} components)`);
  }
  return { errors, components: parsedComponentNames(result.root) };
});

const verdict = verifyExampleCoverage({
  examples: parsed,
  requiredComponents: diagramGroup.components,
});

if (!verdict.ok) {
  console.error(`${verdict.errors.length} example-gate failure(s)`);
  for (const error of verdict.errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(
  `${examples.length}/${examples.length} examples parse clean; ` +
  `${diagramGroup.components.length} Diagrams group components all instantiated`,
);
