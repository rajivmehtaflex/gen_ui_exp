// FlowDiagram family: FlowNode + FlowEdge are data carriers (render null);
// FlowDiagram lays the graph out with dagre and draws one inline SVG.
import { useId, useMemo } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { FlowEdgeSchema, FlowNodeSchema, type FlowEdgeData, type FlowNodeData } from "./schemas";
import { layoutFlow, pointsToPath, wrapLabel } from "./flow-layout";
import { dedupeById } from "./dedupe";

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
  const { kept: uniqueNodes, duplicates } = useMemo(() => dedupeById(nodes), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const laid = useMemo(() => layoutFlow(uniqueNodes, edges, direction ?? "TB"), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const markerId = `fd-arrow-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <div className="gx-diagram" style={{ overflowX: "auto" }}>
      <svg
        role="img"
        aria-label="Flow diagram"
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
      {laid.dropped.length > 0 || duplicates > 0 ? (
        <div
          style={{
            fontSize: 12,
            color: TEXT2,
            padding: "4px 2px 0",
          }}
        >
          {[
            duplicates > 0
              ? `${duplicates} duplicate node id${duplicates > 1 ? "s" : ""} skipped`
              : null,
            laid.dropped.length > 0
              ? `${laid.dropped.length} connection${laid.dropped.length > 1 ? "s" : ""} skipped (unknown node ${laid.dropped.map((d) => `"${d.from}"→"${d.to}"`).join(", ")})`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
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
    nodes: z.array(FlowNode.ref),
    edges: z.array(FlowEdge.ref),
    direction: z.enum(["TB", "LR"]).optional(),
  }),
  component: ({ props }) => (
    <FlowDiagramView
      nodes={(props.nodes ?? [])
        .filter((el) => el.props?.id && el.props?.label)
        .map((el) => el.props as FlowNodeData)}
      edges={(props.edges ?? [])
        .filter((el) => el.props?.from && el.props?.to)
        .map((el) => el.props as FlowEdgeData)}
      direction={props.direction}
    />
  ),
});
