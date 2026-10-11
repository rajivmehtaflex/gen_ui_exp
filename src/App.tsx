// The dining room, in one component: full chat shell (sidebar, composer,
// welcome screen) rendering every assistant recipe with the SAME library the
// server's briefing pack was generated from. That "same library on both ends"
// invariant is the one contract the whole app stands on.
//
// Pipe 2 (storage) is deliberately omitted — threads live in memory, which is
// fine for hello-world. Swap in restStorage()/useOpenuiCloudStorage() later
// without touching anything else.
import { AgentInterface } from "@openuidev/react-ui";
import { appChatLibrary } from "./library/chat-library";
import { llm } from "./llm";

export default function App() {
  return (
    <div style={{ height: "100vh" }}>
      <AgentInterface llm={llm} componentLibrary={appChatLibrary} />
    </div>
  );
}
