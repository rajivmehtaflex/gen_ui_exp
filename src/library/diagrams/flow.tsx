// FlowDiagram family: FlowNode + FlowEdge are data carriers (render null);
// FlowDiagram lays the graph out with dagre and draws one inline SVG.
import { useId, useMemo } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import {
  boundedReferenceArray,
  FlowEdgeSchema,
  FlowNodeSchema,
  type FlowEdgeData,
  type FlowNodeData,
} from "./schemas";
import { layoutFlow, pointsToPath, wrapLabel } from "./flow-layout";
import { dedupeById } from "./dedupe";
import { MAX_FLOW_EDGES, MAX_FLOW_NODES, normalizeFlow } from "./limits";

export const FlowNode = defineComponent({
  name: "FlowNode",
  description:
    "One node in a FlowDiagram. id is a short unique slug that FlowEdge from/to reference; label is 1-3 words; optional kind colors the node: process (default), start, end, decision, input, store.",
  props: FlowNodeSchema,
  component: () => null,
});

export const FlowEdge = defineComponent({
  name: "FlowEdge",
  description:
    'One directed arrow in a FlowDiagram, from node id to node id. Optional short label on the arrow (e.g. "yes", "OK 200"). Both endpoints must be ids of FlowNodes in the same FlowDiagram.',
  props: FlowEdgeSchema,
  component: () => null,
});

const KIND_COLOR: Record<string, string> = {
  process: "var(--openui-border-accent, #58a6ff)",
  start: "var(--openui-border-success-emphasis, #2ea043)",
  end: "var(--openui-border-danger-emphasis, #f85149)",
  decision: "var(--openui-border-alert-emphasis, #d29922)",
  input: "var(--openui-border-info-emphasis, #539bf5)",
  store: "var(--openui-text-accent-tertiary, #a371f7)",
};
const TEXT = "var(--openui-text-neutral-primary, #1f2328)";
const TEXT2 = "var(--openui-text-neutral-secondary, #57606a)";
const STROKE = "var(--openui-border-default, #d0d7de)";
const SURFACE = "var(--openui-foreground, #ffffff)";
const FONT = "var(--openui-font-body, system-ui, sans-serif)";

function FlowDiagramView({
  nodes,
  edges,
  direction,
}: {
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  direction?: "TB" | "LR";
}) {
  const key = JSON.stringify([nodes, edges, direction]);
  const duplicateCandidates = nodes.filter((node) => node && typeof node.id === "string" && node.id.trim() && typeof node.label === "string" && node.label.trim());
  const { duplicates } = useMemo(() => dedupeById(duplicateCandidates), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalized = useMemo(() => normalizeFlow(nodes, edges), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const laid = useMemo(() => layoutFlow(normalized.nodes, normalized.edges, direction ?? "TB"), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const markerId = `fd-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const titleId = `${markerId}-title`;
  const descriptionId = `${markerId}-description`;
  const retainedIds = new Set(normalized.nodes.map((node) => node.id));
  const consideredEdges = edges
    .filter((edge) => edge && typeof edge.from === "string" && edge.from.trim() && typeof edge.to === "string" && edge.to.trim())
    .slice(0, MAX_FLOW_EDGES);
  const danglingEdges = consideredEdges.filter(
    (edge) => edge.from !== edge.to && (!retainedIds.has(edge.from) || !retainedIds.has(edge.to)),
  );
  const additionalOmittedEdges = Math.max(0, normalized.omittedEdges - normalized.selfEdges - danglingEdges.length);
  const nodeDescription = laid.nodes.map((node) => `${node.label} (${node.id})`).join("; ") || "none";
  const edgeDescription =
    laid.edges.map((edge) => `${edge.from} to ${edge.to}${edge.label ? `: ${edge.label}` : ""}`).join("; ") || "none";
  const warnings = [
    normalized.omittedNodes > 0
      ? `${normalized.omittedNodes} node${normalized.omittedNodes === 1 ? "" : "s"} omitted${duplicates ? ` (${duplicates} duplicate id${duplicates === 1 ? "" : "s"})` : " (incomplete or over limit)"}`
      : null,
    normalized.selfEdges > 0
      ? `${normalized.selfEdges} self-edge${normalized.selfEdges === 1 ? "" : "s"} skipped`
      : null,
    danglingEdges.length > 0
      ? `${danglingEdges.length} connection${danglingEdges.length === 1 ? "" : "s"} skipped (unknown node ${danglingEdges.map((edge) => `"${edge.from}"→"${edge.to}"`).join(", ")})`
      : null,
    additionalOmittedEdges > 0
      ? `${additionalOmittedEdges} connection${additionalOmittedEdges === 1 ? "" : "s"} omitted (incomplete or over limit)`
      : null,
  ].filter(Boolean);

  return (
    <div className="gx-diagram" style={{ overflowX: "auto" }}>
      <svg
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        viewBox={`0 0 ${laid.width} ${laid.height}`}
        width="100%"
        style={{
          // Cap upscaling: a narrow layout stretched to the card width renders
          // giant boxes and text. Natural size centered, at most 1.5x.
          maxWidth: Math.round(laid.width * 1.5),
          minWidth: laid.width,
          display: "block",
          margin: "0 auto",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>Flow diagram</title>
        <desc id={descriptionId}>
          Nodes: {nodeDescription}. Connections: {edgeDescription}.
        </desc>
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
          </marker>
        </defs>

        {laid.edges.map((e, i) => (
          <g key={`${e.from}->${e.to}-${i}`}>
            <title>{`${e.from} to ${e.to}${e.label ? `: ${e.label}` : ""}`}</title>
            <path
              d={pointsToPath(e.points)}
              fill="none"
              stroke={STROKE}
              strokeWidth={1.5}
              markerEnd={`url(#${markerId})`}
            />
            {e.label ? (
              <text
                x={e.labelX}
                y={e.labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={11.5}
                fontWeight={500}
                fill={TEXT2}
                stroke={SURFACE}
                strokeWidth={3}
                paintOrder="stroke"
                fontFamily={FONT}
              >
                {e.label}
              </text>
            ) : null}
          </g>
        ))}

        {laid.nodes.map((n) => {
          const color = KIND_COLOR[n.kind ?? "process"] ?? KIND_COLOR.process;
          const lines = wrapLabel(n.label ?? "");
          // The group is translated to the box TOP-LEFT: text y is LOCAL —
          // center the line block within the box height. (Using n.y here — the
          // global center — displaced labels outside their boxes.)
          const startY = n.height / 2 - ((lines.length - 1) * 16) / 2 + 4;
          return (
            <g key={n.id} transform={`translate(${n.x - n.width / 2}, ${n.y - n.height / 2})`}>
              <title>{n.label}</title>
              <rect width={n.width} height={n.height} rx={10} fill={SURFACE} stroke={color} strokeWidth={1.5} />
              <rect x={1} y={6} width={4} height={n.height - 12} rx={2} fill={color} />
              {lines.map((line, li) => (
                <text
                  key={li}
                  x={n.width / 2 + 2}
                  y={startY + li * 16}
                  textAnchor="middle"
                  fontSize={12.5}
                  fill={TEXT}
                  fontFamily={FONT}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </svg>
      {warnings.length > 0 ? (
        <div
          role="status"
          aria-live="polite"
          style={{
            fontSize: 12,
            color: TEXT2,
            padding: "4px 2px 0",
          }}
        >
          {warnings.join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

export const FlowDiagram = defineComponent({
  name: "FlowDiagram",
  description:
    'Directed diagram for workflows, architectures, dataflows and lifecycles - laid out automatically as a clean SVG. Use FlowNode references for nodes and FlowEdge references for arrows. direction: "TB" (top-to-bottom, default) or "LR" (left-to-right pipelines).',
  props: z.object({
    nodes: boundedReferenceArray(FlowNode.ref, MAX_FLOW_NODES),
    edges: boundedReferenceArray(FlowEdge.ref, MAX_FLOW_EDGES),
    direction: z.enum(["TB", "LR"]).optional(),
  }),
  component: ({ props }) => {
    const nodeRefs = Array.isArray(props.nodes) ? props.nodes : [];
    const edgeRefs = Array.isArray(props.edges) ? props.edges : [];
    return (
      <FlowDiagramView
        nodes={nodeRefs.map((el) => (el?.props ?? {}) as FlowNodeData)}
        edges={edgeRefs.map((el) => (el?.props ?? {}) as FlowEdgeData)}
        direction={props.direction}
      />
    );
  },
});
