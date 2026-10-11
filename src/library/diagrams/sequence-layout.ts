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
export interface SeqArrow {
  x1: number;
  x2: number;
  y: number;
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
    if (fi !== ti && labelHalfWidth * 2 > maxW) { // self-loops label above the loop — no span limit
      truncated = true;
      label = full.slice(0, Math.max(4, Math.floor(maxW / LABEL_CHAR) - 1)) + "…";
      labelHalfWidth = (label.length * LABEL_CHAR) / 2;
    }
    arrows.push({
      x1,
      x2,
      y,
      label,
      labelX: (x1 + x2) / 2,
      labelY: y - 8,
      labelHalfWidth,
      truncated,
      kind: m.kind ?? "sync",
      selfLoop: fi === ti,
    });
  });

  const lastY = arrows.length ? arrows[arrows.length - 1].y : FIRST_ROW;
  const lifelines = lanes.map((l) => ({ x: l.x, y1: HEADER_Y + HEADER_H, y2: lastY + 24 }));
  const rightMost = lanes.length ? laneX(lanes.length - 1) : PAD;
  return {
    lanes,
    arrows,
    lifelines,
    width: rightMost + PAD,
    height: lastY + 60,
    dropped,
  };
}
