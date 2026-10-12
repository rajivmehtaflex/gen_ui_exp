import { defineArtifactRenderer, partialJSONParse } from "@openuidev/react-headless";
import { DiagramArtifactView } from "./diagram-artifact-view";

const DIAGRAM_TYPES = new Set(["architecture", "workflow", "sequence", "dataflow", "lifecycle", "explainer-steps"]);

export type DiagramArtifactProps =
  | { status: "building"; title: string; type?: string }
  | { status: "ready"; diagramId: string; title: string; type: string; receipt?: unknown }
  | { status: "failed"; title: string; error: string; diagnostics?: unknown };

function parseJsonSafe(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function previewTitle(args: unknown): string {
  if (typeof args !== "string") return "Interactive Diagram";
  try {
    const partial: unknown = partialJSONParse(args);
    return isRecord(partial) && validText(partial.title) ? partial.title : "Interactive Diagram";
  } catch { return "Interactive Diagram"; }
}

export const diagramArtifactRenderer = defineArtifactRenderer<DiagramArtifactProps>({
  type: "diagram-html",
  toolName: "create_diagram",
  parser: ({ args, response }, { isStreaming }) => {
    if (response !== null && response !== undefined) {
      const result = parseJsonSafe(response);
      const title = previewTitle(args);
      if (isRecord(result) && result.ok === true && validText(result.diagramId) &&
          validText(result.title) && typeof result.type === "string" && DIAGRAM_TYPES.has(result.type)) {
        return {
          props: { status: "ready", diagramId: result.diagramId, title: result.title, type: result.type, receipt: result.receipt },
          meta: { id: result.diagramId, version: 1, heading: result.title },
        };
      }
      const error = isRecord(result) && result.ok === false && validText(result.error)
        ? result.error : "Diagram creation returned an invalid result.";
      return { props: { status: "failed", title, error, diagnostics: isRecord(result) ? result.diagnostics : undefined }, meta: null };
    }
    if (response === null && !isStreaming) {
      return {
        props: {
          status: "failed",
          title: previewTitle(args),
          error: "Diagram creation completed without a result.",
        },
        meta: null,
      };
    }
    if (typeof args === "string" && args.trim().length > 0) {
      try {
        const partial: unknown = partialJSONParse(args);
        if (isRecord(partial) && validText(partial.title)) {
          const type = typeof partial.type === "string" && DIAGRAM_TYPES.has(partial.type) ? partial.type : undefined;
          return { props: { status: "building", title: partial.title, type }, meta: null };
        }
      } catch { return null; }
    }
    return null;
  },
  preview: (props, controls) => {
    const failed = props.status === "failed";
    return (
      <button type="button" onClick={failed ? undefined : controls.open} disabled={failed}
        style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", borderRadius: "8px", border: "1px solid #e2e8f0", backgroundColor: "#ffffff", cursor: failed ? "default" : "pointer", fontSize: "13px", fontWeight: 500, color: failed ? "#b91c1c" : "#0f172a", boxShadow: "0 1px 2px rgba(0,0,0,0.05)" }}>
        <span aria-hidden="true">📊</span><span>{props.title}</span>
        <span style={{ fontSize: "11px" }}>{failed ? props.error : props.status === "building" || controls.isStreaming ? "(building...)" : "↗ Open"}</span>
      </button>
    );
  },
  actual: (props) => <DiagramArtifactView {...props} />,
});
