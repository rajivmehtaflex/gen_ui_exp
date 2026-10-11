// The gate for EVERY canned recipe: parse each against the REAL library schema
// and require zero errors before the server is allowed to stream any of them.
// This is the same check any model output would face (createParser + meta.errors).
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";
import * as recipes from "../server/canned-recipe.mjs";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);
const parser = createParser(spec.library.schema, spec.library.root);

const REQUIRED = ["cannedRecipe", "flowRecipe", "sequenceRecipe", "explainerRecipe"];
let failed = 0;
let total = 0;

const check = (name, recipe) => {
  total += 1;
  const result = parser.parse(recipe);
  const errors = result.meta?.errors ?? [];
  if (errors.length > 0) {
    failed += 1;
    console.error(`${name}: INVALID — ${errors.length} error(s)`);
    for (const e of errors) console.error("  -", JSON.stringify(e).slice(0, 240));
  } else {
    console.log(`${name}: clean`);
  }
};

for (const name of REQUIRED) {
  const recipe = recipes[name];
  if (typeof recipe !== "string" || !recipe) {
    failed += 1;
    total += 1;
    console.error(`${name}: MISSING`);
    continue;
  }
  check(name, recipe);
}
// any extra exported string recipes get validated too
for (const [name, recipe] of Object.entries(recipes)) {
  if (REQUIRED.includes(name) || typeof recipe !== "string") continue;
  check(name, recipe);
}

if (failed > 0) {
  console.error(`${failed}/${total} recipes FAILED`);
  process.exit(1);
}
console.log(`${total}/${total} recipes parse clean (0 errors) against root "${spec.library.root}"`);
