// THE single source of truth for what the model may generate and what the
// browser renders: the built-in chat library extended with the diagram
// vocabulary. This exact library (serialized) feeds generateSystemPrompt on
// the server AND <AgentInterface componentLibrary={...}> on the client.
import type { ComponentGroup } from "@openuidev/react-lang";
import { createLibrary } from "@openuidev/react-lang";
import {
  openuiChatComponentGroups,
  openuiChatLibrary,
  openuiChatPromptOptions,
} from "@openuidev/react-ui";
import { FlowDiagram, FlowEdge, FlowNode } from "./diagrams/flow";
import { Message, Participant, SequenceDiagram } from "./diagrams/sequence";
import { ExplainerStep, StepExplainer } from "./diagrams/explainer";

export const diagramGroup: ComponentGroup = {
  name: "Diagrams",
  components: [
    "FlowDiagram",
    "FlowNode",
    "FlowEdge",
    "SequenceDiagram",
    "Participant",
    "Message",
    "StepExplainer",
    "ExplainerStep",
  ],
  notes: [
    "- FlowDiagram: define one FlowNode reference per node; ids are short unique slugs (n1, api); every FlowEdge from/to must match a node id; 12 nodes max.",
    "- SequenceDiagram: define Participant references first, then Message references in chronological order; from/to must match participant ids; 6 participants / 12 messages max.",
    "- Use StepExplainer for concept walkthroughs (how X works); use Steps for ordered task instructions.",
    "- Diagrams render inside the chat card - keep labels short; wide diagrams scroll horizontally.",
  ],
};

export const appChatLibrary = createLibrary({
  id: "gen-ui-exp-chat@1",
  root: "Card",
  componentGroups: [...(openuiChatComponentGroups ?? []), diagramGroup],
  components: [
    ...Object.values(openuiChatLibrary.components),
    FlowDiagram,
    FlowNode,
    FlowEdge,
    SequenceDiagram,
    Participant,
    Message,
    StepExplainer,
    ExplainerStep,
  ],
});

// T7 extends this with diagram examples + rules (each parser-validated).
export const appChatPromptOptions = {
  ...openuiChatPromptOptions,
};
