// Pure sequence-diagram layout math (no React, no graph lib) — Node-testable.
// Lanes left-to-right, messages top-to-bottom. Ruling R0 applies: duplicate
// participant ids THROW; messages with unknown ids are dropped into `dropped[]`.
export interface ParticipantInput {
  id: string;
  label: string;
}
export interface MessageInput {
  from: string;
  to: string;
  label: string;
  kind?: string;
}
export interface SeqLane {
  id: string;
  x: number;
  label: string;
}
export interface SeqBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface SeqArrow {
  from: string;
  to: string;
  fullLabel: string;
  x1: number;
  x2: number;
  y: number;
  path: string;
  bounds: SeqBounds;
  label: string;
  labelX: number;
  labelY: number;
  labelHalfWidth: number;
  truncated: boolean;
  kind: string;
  selfLoop: boolean;
}
export interface SequenceLayout {
  lanes: SeqLane[];
  arrows: SeqArrow[];
  lifelines: { x: number; y1: number; y2: number }[];
  width: number;
  height: number;
  dropped: number[];
}

const PAD = 90;
const LANE_W = 150;
const HEADER_Y = 12;
const HEADER_H = 34;
const FIRST_ROW = 70;
const ROW_H = 54;
const LABEL_CHAR = 6.2;

export function layoutSequence(participants: ParticipantInput[], messages: MessageInput[]): SequenceLayout {
  const seen = new Set<string>();
  for (const p of participants) {
    if (seen.has(p.id)) throw new Error(`Duplicate Participant id: "${p.id}"`);
    seen.add(p.id);
  }
  const index = new Map(participants.map((p, i) => [p.id, i]));
  const laneX = (i: number) => PAD + i * LANE_W;

  const lanes: SeqLane[] = participants.map((p, i) => ({ id: p.id, x: laneX(i), label: p.label }));

  const dropped: number[] = [];
  const arrows: SeqArrow[] = [];
  messages.forEach((m, i) => {
    const fi = index.get(m.from);
    const ti = index.get(m.to);
    if (fi === undefined || ti === undefined) {
      dropped.push(i);
      return;
    }
    const y = FIRST_ROW + (arrows.length + 1) * ROW_H;
    const x1 = laneX(fi);
    const x2 = laneX(ti);
    const full = (m.label ?? "").trim();
    const span = Math.abs(x2 - x1);
    const maxW = Math.max(span - 24, 60);
    let label = full;
    let labelHalfWidth = (full.length * LABEL_CHAR) / 2;
    let truncated = false;
    let labelX = (x1 + x2) / 2;
    let labelY = y - 8;
    let path: string;
    let bounds: SeqBounds;
    const selfLoop = fi === ti;

    if (!selfLoop && labelHalfWidth * 2 > maxW) {
      truncated = true;
      label = full.slice(0, Math.max(4, Math.floor(maxW / LABEL_CHAR) - 1)) + "…";
      labelHalfWidth = (label.length * LABEL_CHAR) / 2;
    }

    if (selfLoop) {
      // Keep the path's shape and the full label's measured extent together so
      // the SVG viewBox includes both on the last participant lane.
      labelX = x1 + 44;
      labelY = y + 12;
      path = `M ${x1} ${y} h 30 a 6 6 0 0 1 6 6 v 10 a 6 6 0 0 1 -6 6 h -22`;
      bounds = {
        left: x1 - 2,
        top: y - 2,
        right: Math.max(x1 + 38, labelX + labelHalfWidth * 2 + 2),
        bottom: y + 24,
      };
    } else {
      path = `M ${x1} ${y} L ${x2} ${y}`;
      bounds = {
        left: Math.min(x1, x2) - 8,
        top: Math.min(y - 8, labelY - 8),
        right: Math.max(x1, x2) + 8,
        bottom: Math.max(y + 4, labelY + 8),
      };
      bounds.left = Math.min(bounds.left, labelX - labelHalfWidth - 2);
      bounds.right = Math.max(bounds.right, labelX + labelHalfWidth + 2);
    }

    arrows.push({
      from: m.from,
      to: m.to,
      fullLabel: full,
      x1,
      x2,
      y,
      path,
      bounds,
      label,
      labelX,
      labelY,
      labelHalfWidth,
      truncated,
      kind: m.kind ?? "sync",
      selfLoop,
    });
  });

  const lastY = arrows.length ? arrows[arrows.length - 1].y : FIRST_ROW;
  const lifelines = lanes.map((l) => ({ x: l.x, y1: HEADER_Y + HEADER_H, y2: lastY + 24 }));
  const rightMost = lanes.length ? laneX(lanes.length - 1) : PAD;
  const rightBounds = arrows.reduce((right, arrow) => Math.max(right, arrow.bounds.right), rightMost);
  const bottomBounds = arrows.reduce((bottom, arrow) => Math.max(bottom, arrow.bounds.bottom), lastY + 24);
  return {
    lanes,
    arrows,
    lifelines,
    width: rightBounds + PAD,
    height: Math.max(lastY + 60, bottomBounds + 8),
    dropped,
  };
}
