// THE single source of truth for what the model may generate and what the
// browser renders: the built-in chat library extended with the diagram
// vocabulary. This exact library (serialized) feeds generateSystemPrompt on
// the server AND <AgentInterface componentLibrary={...}> on the client.
import type { ComponentGroup } from "@openuidev/react-lang";
import { createLibrary } from "@openuidev/react-lang";
import {
  openuiChatAdditionalRules,
  openuiChatComponentGroups,
  openuiChatExamples,
  openuiChatLibrary,
  openuiChatPromptOptions,
} from "@openuidev/react-ui";
import { FlowDiagram, FlowEdge, FlowNode } from "./diagrams/flow";
import { Message, Participant, SequenceDiagram } from "./diagrams/sequence";
import { ExplainerStep, StepExplainer } from "./diagrams/explainer";
import {
  MAX_EXPLAINER_STEPS,
  MAX_FLOW_EDGES,
  MAX_FLOW_NODES,
  MAX_SEQUENCE_MESSAGES,
  MAX_SEQUENCE_PARTICIPANTS,
} from "./diagrams/limits";

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
    `- FlowDiagram: define one FlowNode reference per node; ids are short unique slugs (n1, api); every FlowEdge from/to must match a node id; ${MAX_FLOW_NODES} nodes / ${MAX_FLOW_EDGES} edges max; do not connect a node to itself.`,
    `- SequenceDiagram: define Participant references first, then Message references in chronological order; from/to must match participant ids; ${MAX_SEQUENCE_PARTICIPANTS} participants / ${MAX_SEQUENCE_MESSAGES} messages max.`,
    `- Use StepExplainer for concept walkthroughs (how X works) with at most ${MAX_EXPLAINER_STEPS} ordered ExplainerStep references; use Steps for ordered task instructions.`,
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

// One canonical example per diagram family (parser-validated by
// scripts/validate-examples.mjs — an invalid example would regress reliability).
const flowExample = `Example 6 - Flow diagram (workflow / architecture / dataflow ask):

root = Card([header, intro, flow])
header = CardHeader("How our deploy works", "Push to main -> production")
intro = TextContent("Four stages gate every release.")
flow = FlowDiagram([n1, n2, n3, n4, n5], [e1, e2, e3, e4, e5], "TB")
n1 = FlowNode("push", "Push to main", "start")
n2 = FlowNode("ci", "CI tests")
n3 = FlowNode("review", "Review OK?", "decision")
n4 = FlowNode("staging", "Staging")
n5 = FlowNode("prod", "Production", "end")
e1 = FlowEdge("push", "ci", "on merge")
e2 = FlowEdge("ci", "review", "green")
e3 = FlowEdge("review", "staging", "yes")
e4 = FlowEdge("review", "ci", "fix requested")
e5 = FlowEdge("staging", "prod", "promote")`;

const sequenceExample = `Example 7 - Sequence diagram (request-lifecycle / API-interaction ask):

root = Card([header, seq])
header = CardHeader("Checkout request lifecycle", "Browser -> API -> data")
seq = SequenceDiagram([p1, p2, p3, p4], [m1, m2, m3, m4, m5])
p1 = Participant("browser", "Browser")
p2 = Participant("api", "Checkout API")
p3 = Participant("db", "Postgres")
p4 = Participant("psp", "Payment provider")
m1 = Message("browser", "api", "POST /checkout", "sync")
m2 = Message("api", "psp", "Authorize the charge", "async")
m3 = Message("psp", "api", "Approved", "return")
m4 = Message("api", "db", "INSERT order", "sync")
m5 = Message("api", "browser", "201 order id", "return")`;

const explainerExample = `Example 8 - Concept walkthrough (how-does-X-work ask):

root = Card([header, intro, explainer])
header = CardHeader("How HTTP caching works", "In four moves")
intro = TextContent("The browser and the server negotiate freshness on every request.")
explainer = StepExplainer([s1, s2, s3, s4])
s1 = ExplainerStep("Request", "The browser first checks its local cache for a fresh copy.", null, "Fresh means the resource has not outlived its max-age.")
s2 = ExplainerStep("Conditional request", "If stale, the browser revalidates with an If-None-Match header.", "GET /logo.png HTTP/1.1\\nIf-None-Match: \\"abc123\\"")
s3 = ExplainerStep("Server decision", "An unchanged resource answers 304 with no body; a changed one answers 200 with the new bytes.", null, "304s are nearly free - no payload.")
s4 = ExplainerStep("Reuse", "The browser stores the new response with its Cache-Control policy and serves it until it goes stale.")`;

const diagramRules = [
  `FlowDiagram takes nodes first, then edges: FlowDiagram([n1, n2], [e1, e2], "LR"). Use at most ${MAX_FLOW_NODES} unique nodes and ${MAX_FLOW_EDGES} edges. Every FlowEdge from/to must reference a defined node id - never connect a node to itself.`,
  `SequenceDiagram is positional: Message(from, to, label, kind?). Use at most ${MAX_SEQUENCE_PARTICIPANTS} participants and ${MAX_SEQUENCE_MESSAGES} messages. from/to are Participant ids; list messages top-to-bottom in time order; a reply is kind "return".`,
  `StepExplainer(+ExplainerStep) explains how something works step by step with at most ${MAX_EXPLAINER_STEPS} steps; body, code and note are plain strings - never nest components inside an ExplainerStep. Use Steps for task/UI instructions instead.`,
  'Prefer direction "LR" for pipelines and dataflows, "TB" for decision-heavy workflows in FlowDiagram.',
  "Keep diagram text short: node and step titles 1-5 words, edge labels 1-3 words, message labels a short phrase.",
];

export const appChatPromptOptions = {
  ...openuiChatPromptOptions,
  examples: [...openuiChatExamples, flowExample, sequenceExample, explainerExample],
  additionalRules: [...openuiChatAdditionalRules, ...diagramRules],
};
