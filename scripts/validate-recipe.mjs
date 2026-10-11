// The gate for the canned recipe: parse it against the REAL library schema
// and require zero errors before the server is allowed to stream it.
// This is the same check any model output would face (createParser + meta.errors).
import { readFileSync } from "node:fs";
import { createParser } from "@openuidev/lang-core";
import { cannedRecipe } from "../server/canned-recipe.mjs";

const spec = JSON.parse(
  readFileSync(new URL("../generated/chat-library.spec.json", import.meta.url), "utf8"),
);

const parser = createParser(spec.library.schema, spec.library.root);
const result = parser.parse(cannedRecipe);
const errors = result.meta?.errors ?? [];

if (errors.length > 0) {
  console.error(`canned recipe INVALID — ${errors.length} error(s):`);
  for (const e of errors) console.error(" -", JSON.stringify(e));
  process.exit(1);
}

console.log(`canned recipe parses clean (0 errors) against root "${spec.library.root}"`);
