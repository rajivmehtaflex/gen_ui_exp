import assert from "node:assert/strict";
import { isCannedInteractivePrompt, pickCannedRecipe } from "../server/canned-recipe.mjs";

// Regression: a request naming an interactive alternative must still honor inline.
assert.equal(
  isCannedInteractivePrompt("Show an inline architecture diagram, even if an interactive version exists"),
  false,
  "routing_preserves_inline: explicit inline takes precedence in canned mode",
);

const { diagramModeForPrompt, DIAGRAM_TYPES } = await import("../server/diagram-policy.mjs");
assert.deepEqual(DIAGRAM_TYPES, ["architecture", "workflow", "sequence", "dataflow", "lifecycle", "explainer-steps"]);
const cases = [
  ["Show an inline architecture diagram", "inline"],
  ["Draw an inline sequence diagram", "inline"],
  ["Draw an inline flow", "inline"],
  ["Explain caching with an inline step explainer", "inline"],
  ["INLINE workflow diagram with interactive details", "inline"],
  ["Show an interactive architecture diagram", "interactive"],
  ["Show an interactive workflow diagram with inline labels", "interactive"],
  ["Create an interactive architecture diagram with inline code examples", "interactive"],
  ["Make the architecture diagram interactive", "interactive"],
  ["I want an interactive architecture diagram", "interactive"],
  ["Create an explorable sequence diagram", "interactive"],
  ["Show an explorable flow", "interactive"],
  ["Make a diagramify dataflow", "interactive"],
  ["Create a workflow artifact", "interactive"],
  ["Sketch the architecture", "auto"],
  ["Show a sequence diagram", "auto"],
  ["Explain HTTP caching", "auto"],
  ["Help me write an interactive story", "auto"],
  ["Tell me an interactive story about cash flow", "auto"],
  ["Write an interactive article about software architecture", "auto"],
  ["Make an explorable pipeline tutorial", "auto"],
  ["Write an interactive article about architecture diagrams", "auto"],
  ["Write an article with an interactive architecture diagram", "interactive"],
  ["Write an interactive article with an architecture diagram", "auto"],
  ["What is an interactive architecture?", "auto"],
  ["What is a workflow artifact?", "auto"],
  ["Explain how inline architecture diagrams work", "auto"],
  ["What is an archaeological artifact?", "auto"],
  ["Use inline code in an interactive story", "auto"],
  ["", "auto"],
];
for (const [prompt, expected] of cases) {
  assert.equal(diagramModeForPrompt(prompt), expected, `routing_preserves_inline: ${prompt}`);
  assert.equal(isCannedInteractivePrompt(prompt), expected === "interactive", `canned routing: ${prompt}`);
  if (expected === "inline") assert.match(pickCannedRecipe(prompt), /(?:FlowDiagram|SequenceDiagram|StepExplainer)\(/);
}
console.log(`routing_preserves_inline: ${cases.length} routing cases pass in shared and canned policy`);
