// Serializes the built-in chat library into the JSON contract shared by the
// server (briefing pack) and the recipe validator. This is the "menu" the AI
// is allowed to order from — regenerated whenever the library changes.
// Byte-equivalent to: npx @openuidev/cli generate --spec
import { writeFileSync, mkdirSync } from "node:fs";
import { openuiChatLibrary, openuiChatPromptOptions } from "@openuidev/react-ui";

const spec = {
  library: {
    // toSpec().schema and toJSONSchema() are identical for this library —
    // kept under the canonical name the parser expects.
    ...openuiChatLibrary.toSpec(),
    schema: openuiChatLibrary.toJSONSchema(),
  },
  // House style for the chat prompt (examples + additional rules), consumed
  // by generateSystemPrompt on the server.
  promptOptions: openuiChatPromptOptions,
};

mkdirSync("generated", { recursive: true });
writeFileSync("generated/chat-library.spec.json", JSON.stringify(spec, null, 2) + "\n");

console.log("wrote generated/chat-library.spec.json");
console.log("  root:", spec.library.root);
console.log("  promptOptions keys:", Object.keys(spec.promptOptions));
