// Shared diagram menu and intent routing for canned and live chat.
export const DIAGRAM_TYPES = Object.freeze([
  "architecture",
  "workflow",
  "sequence",
  "dataflow",
  "lifecycle",
  "explainer-steps",
]);

export function diagramModeForPrompt(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  const namedDiagram = /\b(?:diagrams?|architectures?|data[ -]?flows?|sequences?|workflows?|lifecycles?|flowcharts?|pipelines?|explainer(?:[ -]?steps)?)\b/.test(text);
  const explicitFlow = /\b(?:inline|interactive|explorable|diagramify)\s+(?:\w+\s+){0,2}flows?\b/.test(text);
  const diagramIntent = namedDiagram || explicitFlow;
  if (!diagramIntent) return "auto";
  if (/\binline\b/.test(text)) return "inline";
  if (/\b(?:interactive|explorable|artifacts?|diagramify)\b/.test(text)) return "interactive";
  return "auto";
}
