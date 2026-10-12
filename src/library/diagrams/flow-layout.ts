// Pure flow-diagram layout math (no React) — Node-testable.
// Ruling R0: duplicate ids THROW (authoring bug); edges with unknown endpoints
// and unsupported self-edges are DROPPED and reported in `dropped[]`.
import { Graph, layout } from "@dagrejs/dagre";

export interface FlowNodeInput {
  id: string;
  label: string;
  kind?: string;
}
export interface FlowEdgeInput {
  from: string;
  to: string;
  label?: string;
}
export interface FlowPoint {
  x: number;
  y: number;
}
export interface FlowNodeBox {
  id: string;
  label: string;
  kind?: string;
  x: number; // center
  y: number; // center
  width: number;
  height: number;
}
export interface FlowEdgeRoute {
  from: string;
  to: string;
  label?: string;
  points: FlowPoint[];
  labelX: number;
  labelY: number;
}
export interface FlowLayout {
  nodes: FlowNodeBox[];
  edges: FlowEdgeRoute[];
  width: number;
  height: number;
  dropped: { from: string; to: string }[];
}

const NODE_W = 168;
const LINE_H = 16;
const BASE_H = 28;
const LABEL_CHAR = 6.2;

/** Wrap a node label to at most 2 lines; hard-split overlong words; ellipsis tail. */
export function wrapLabel(label: string, maxChars = 24): string[] {
  const text = (label ?? "").trim();
  if (!text) return [""];
  if (text.length <= maxChars) return [text];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  const push = () => {
    if (cur) {
      lines.push(cur);
      cur = "";
    }
  };
  for (const w of words) {
    if (!cur) {
      cur = w;
      continue;
    }
    if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      push();
      cur = w;
    }
  }
  push();

  // hard-split any single word longer than maxChars
  const split: string[] = [];
  for (const line of lines) {
    if (line.length <= maxChars) {
      split.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += maxChars) split.push(line.slice(i, i + maxChars));
  }
  if (split.length <= 2) return split;
  const second = split
    .slice(1)
    .join("")
    .slice(0, maxChars - 1);
  return [split[0], second + "…"];
}

/** Straight polyline path through the layout points. */
export function pointsToPath(points: FlowPoint[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

export function layoutFlow(
  nodes: FlowNodeInput[],
  edges: FlowEdgeInput[],
  direction: "TB" | "LR" = "TB",
): FlowLayout {
  const seen = new Set<string>();
  for (const n of nodes) {
    if (seen.has(n.id)) throw new Error(`Duplicate FlowNode id: "${n.id}"`);
    seen.add(n.id);
  }

  const dropped: { from: string; to: string }[] = [];
  const valid = edges.filter((e) => {
    const ok = e.from !== e.to && seen.has(e.from) && seen.has(e.to);
    if (!ok) dropped.push({ from: e.from, to: e.to });
    return ok;
  });

  if (nodes.length === 0) {
    return { nodes: [], edges: [], width: 2, height: 2, dropped };
  }

  const g = new Graph({ multigraph: true });
  g.setGraph({
    rankdir: direction,
    nodesep: 36,
    ranksep: 64,
    marginx: 12,
    marginy: 12,
    ranker: "network-simplex",
  });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const lines = wrapLabel(n.label);
    g.setNode(n.id, { width: NODE_W, height: Math.max(44, BASE_H + lines.length * LINE_H) });
  }
  valid.forEach((e, i) => {
    const label = (e.label ?? "").trim();
    g.setEdge(
      e.from,
      e.to,
      { label, width: label.length * LABEL_CHAR + 10, height: 16, labelpos: "c", labeloffset: 0 },
      String(i),
    );
  });

  layout(g);

  const outNodes: FlowNodeBox[] = nodes.map((n) => {
    const rec = g.node(n.id);
    return { id: n.id, label: n.label, kind: n.kind, x: rec.x, y: rec.y, width: rec.width, height: rec.height };
  });
  const outEdges: FlowEdgeRoute[] = valid.map((e, i) => {
    const rec = g.edge(e.from, e.to, String(i));
    const pts = (rec.points ?? []) as FlowPoint[];
    const midX = pts.length ? (pts[0].x + pts[pts.length - 1].x) / 2 : 0;
    const midY = pts.length ? (pts[0].y + pts[pts.length - 1].y) / 2 : 0;
    return {
      from: e.from,
      to: e.to,
      label: (e.label ?? "").trim() || undefined,
      points: pts,
      labelX: Number.isFinite(rec.x) ? rec.x : midX,
      labelY: Number.isFinite(rec.y) ? rec.y : midY,
    };
  });

  const graph = g.graph();
  const width = Number.isFinite(graph?.width) && graph.width > 0 ? graph.width : 2;
  const height = Number.isFinite(graph?.height) && graph.height > 0 ? graph.height : 2;
  return { nodes: outNodes, edges: outEdges, width, height, dropped };
}
