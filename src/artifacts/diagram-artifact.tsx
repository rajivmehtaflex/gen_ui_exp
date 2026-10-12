import { defineArtifactRenderer, partialJSONParse } from "@openuidev/react-headless";

export interface DiagramArtifactProps {
  diagramId?: string;
  title?: string;
  type?: string;
}

function parseJsonSafe(val: unknown) {
  if (!val) return null;
  if (typeof val === "object") return val;
  if (typeof val === "string") {
    try {
      return JSON.parse(val);
    } catch {
      return null;
    }
  }
  return null;
}

export const diagramArtifactRenderer = defineArtifactRenderer<DiagramArtifactProps>({
  type: "diagram-html",
  toolName: "create_diagram",
  parser: ({ args, response }) => {
    // 1. If response is present (completed tool call or stored reload):
    const res = parseJsonSafe(response) as { ok?: boolean; diagramId?: string; title?: string; type?: string } | null;
    if (res?.ok && res.diagramId) {
      const title = res.title || "Interactive Diagram";
      return {
        props: {
          diagramId: res.diagramId,
          title,
          type: res.type || "architecture",
        },
        meta: {
          id: res.diagramId,
          version: 1,
          heading: title,
        },
      };
    }

    // 2. If args is present during streaming:
    if (typeof args === "string" && args.trim().length > 0) {
      try {
        const partial = (partialJSONParse(args) || {}) as Record<string, any>;
        const title = typeof partial.title === "string" && partial.title.trim().length > 0 ? partial.title : null;
        if (title) {
          return {
            props: {
              title,
              type: typeof partial.type === "string" ? partial.type : undefined,
            },
            meta: null,
          };
        }
      } catch {
        return null;
      }
    }

    return null;
  },
  preview: (props, controls) => {
    const title = props.title || "Interactive Diagram";
    return (
      <button
        type="button"
        onClick={controls.open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: "8px 14px",
          borderRadius: "8px",
          border: "1px solid #e2e8f0",
          backgroundColor: "#ffffff",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 500,
          color: "#0f172a",
          boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
        }}
      >
        <span>📊</span>
        <span>{title}</span>
        {controls.isStreaming ? (
          <span style={{ fontSize: "11px", color: "#64748b" }}>(building...)</span>
        ) : (
          <span style={{ fontSize: "11px", color: "#2563eb" }}>↗ Open</span>
        )}
      </button>
    );
  },
  actual: (props) => {
    if (!props.diagramId) {
      return (
        <div style={{ padding: "24px", color: "#64748b", fontFamily: "sans-serif" }}>
          Building diagram...
        </div>
      );
    }
    return (
      <iframe
        src={`/api/artifacts/${props.diagramId}`}
        sandbox="allow-scripts"
        title={props.title || "Diagram Artifact"}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          backgroundColor: "#ffffff",
        }}
      />
    );
  },
});
