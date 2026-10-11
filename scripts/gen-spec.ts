// Generates the serialized library contract + prompt options consumed by the
// server's briefing pack. Replaces the old gen-spec.mjs: the library now lives
// in app TypeScript, so spec generation runs under the tsx runner.
//   tsx scripts/gen-spec.ts          write generated/chat-library.spec.json
//   tsx scripts/gen-spec.ts --check  exit 1 if the committed file is stale
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { appChatLibrary, appChatPromptOptions } from "../src/library/chat-library";

const OUT = new URL("../generated/chat-library.spec.json", import.meta.url);

const spec = {
  library: {
    ...appChatLibrary.toSpec(),
    schema: appChatLibrary.toJSONSchema(),
  },
  promptOptions: appChatPromptOptions,
};
const contents = JSON.stringify(spec, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = readFileSync(OUT, "utf8");
  if (current !== contents) {
    console.error("spec is STALE — run: npm run gen:spec");
    process.exit(1);
  }
  console.log("spec is up to date");
  process.exit(0);
}

mkdirSync(new URL("../generated", import.meta.url), { recursive: true });
writeFileSync(OUT, contents);
console.log("wrote generated/chat-library.spec.json");
console.log("  root:", appChatLibrary.root);
console.log("  components:", Object.keys(appChatLibrary.components).length);
console.log("  spec bytes:", contents.length);
