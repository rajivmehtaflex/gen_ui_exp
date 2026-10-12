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
  const diagramTarget = "(?:diagrams?|flowcharts?|architectures?|data[ -]?flows?|sequences?|workflows?|lifecycles?|flows?|pipelines?|(?:step[ -]?)?explainer(?:[ -]?steps)?)";
  const family = /\b(?:architectures?|data[ -]?flows?|sequences?|workflows?|lifecycles?|pipelines?|(?:step[ -]?)?explainer(?:[ -]?steps)?)\b/;
  const namedDiagram = /\b(?:diagrams?|flowcharts?)\b/.test(text);
  const outputVerb = /\b(?:draw|sketch|show|create|make|build|generate|render|visualize|map|design)\b/.test(text);
  const inlineTarget = new RegExp(`\\binline\\s+(?:(?:an?|the|interactive|explorable)\\s+)?${diagramTarget}\\b|\\b${diagramTarget}\\s+inline\\b`).test(text);
  const interactiveTarget = new RegExp(`\\b(?:interactive|explorable|diagramify)\\s+(?:(?:an?|the)\\s+)?${diagramTarget}\\b|\\b(?:diagrams?|flowcharts?)\\s+(?:that is\\s+|which is\\s+)?(?:interactive|explorable)\\b`).test(text);
  const artifactTarget = new RegExp(`\\b(?:artifacts?\\s+${diagramTarget}|${diagramTarget}\\s+artifacts?|${diagramTarget}\\s+as\\s+(?:an?\\s+)?(?:interactive\\s+)?artifacts?)\\b`).test(text);
  const bareDiagramRequest = new RegExp(`^\\s*(?:an?\\s+)?(?:inline|interactive|explorable|diagramify)\\s+(?:(?:an?|the)\\s+)?${diagramTarget}\\b`).test(text);
  const asksForOutput = outputVerb || /\b(?:i want|i need|give me|with an? (?:inline|interactive|explorable))\b/.test(text) || bareDiagramRequest;
  const diagramIntent = asksForOutput && (namedDiagram || inlineTarget || interactiveTarget || artifactTarget || family.test(text));
  if (!diagramIntent) return "auto";

  const content = /\b(?:articles?|tutorials?|stories|essays?|guides?|posts?|summaries)\b/.exec(text);
  if (content && /\b(?:write|make|create|draft|compose|show|give|build|generate|tell)\b/.test(text.slice(0, content.index))) {
    const rest = text.slice(content.index + content[0].length);
    if (!/\b(?:with|include|add|containing|featuring|then\s+(?:draw|sketch|create|show|render|generate))\b.{0,90}\b(?:diagrams?|flowcharts?)\b/.test(rest)) return "auto";
  }

  if (inlineTarget) return "inline";
  if (interactiveTarget || artifactTarget) return "interactive";
  return "auto";
}
