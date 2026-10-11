// SequenceDiagram family: Participant + Message are data carriers (render null);
// SequenceDiagram hand-lays lanes and message arrows into one inline SVG.
import { useId, useMemo } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import { MessageSchema, ParticipantSchema, type MessageData, type ParticipantData } from "./schemas";
import { layoutSequence } from "./sequence-layout";
import { dedupeById } from "./dedupe";

export const Participant = defineComponent({
  name: "Participant",
  description:
    "One lane (column) in a SequenceDiagram. id is a short unique slug that Message from/to reference; label names the actor or system (2-3 words).",
  props: ParticipantSchema,
  component: () => null,
});

export const Message = defineComponent({
  name: "Message",
  description:
    'One arrow in a SequenceDiagram from participant id to participant id; define messages in time order. label is what is sent. kind: sync (solid arrow, default), async (open arrow), return (dashed reply).',
  props: MessageSchema,
  component: () => null,
});

const TEXT = "var(--openui-text-neutral-primary, #1f2328)";
const TEXT2 = "var(--openui-text-neutral-secondary, #57606a)";
const STROKE = "var(--openui-border-default, #d0d7de)";
const SURFACE = "var(--openui-foreground, #ffffff)";
const SUNK = "var(--openui-sunk, #f6f8fa)";
const FONT = "var(--openui-font-body, system-ui, sans-serif)";

function SequenceDiagramView({
  participants,
  messages,
}: {
  participants: ParticipantData[];
  messages: MessageData[];
}) {
  const key = JSON.stringify([participants, messages]);
  const { kept: uniqueParticipants, duplicates } = useMemo(() => dedupeById(participants), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const laid = useMemo(() => layoutSequence(uniqueParticipants, messages), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const mFilled = `sq-filled-${uid}`;
  const mOpen = `sq-open-${uid}`;

  return (
    <div className="gx-diagram" style={{ overflowX: "auto" }}>
      <svg
        role="img"
        aria-label="Sequence diagram"
        viewBox={`0 0 ${laid.width} ${laid.height}`}
        width="100%"
        style={{ minWidth: 520 }}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <marker id={mFilled} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE} />
          </marker>
          <marker id={mOpen} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10" fill="none" stroke={STROKE} strokeWidth={1.5} />
          </marker>
        </defs>

        {/* lifelines first (under everything) */}
        {laid.lifelines.map((l) => (
          <line
            key={l.x}
            x1={l.x}
            y1={l.y1}
            x2={l.x}
            y2={l.y2}
            stroke={STROKE}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}

        {/* participant header cards */}
        {laid.lanes.map((l) => (
          <g key={l.id}>
            <rect
              x={l.x - 62}
              y={12}
              width={124}
              height={34}
              rx={8}
              fill={SUNK}
              stroke={STROKE}
              strokeWidth={1.5}
            />
            <text x={l.x} y={29 + 5} textAnchor="middle" fontSize={12.5} fill={TEXT} fontFamily={FONT}>
              {l.label.length > 18 ? l.label.slice(0, 17) + "…" : l.label}
            </text>
          </g>
        ))}

        {/* messages */}
        {laid.arrows.map((a, i) => {
          const dash = a.kind === "return" ? "6 4" : undefined;
          const marker = a.kind === "sync" ? mFilled : mOpen;
          if (a.selfLoop) {
            const d = `M ${a.x1} ${a.y} h 30 a 6 6 0 0 1 6 6 v 10 a 6 6 0 0 1 -6 6 h -22`;
            return (
              <g key={i}>
                <path d={d} fill="none" stroke={STROKE} strokeWidth={1.5} strokeDasharray={dash} markerEnd={`url(#${marker})`} />
                <text
                  x={a.labelX + 44}
                  y={a.y + 12}
                  textAnchor="start"
                  fontSize={11.5}
                  fill={TEXT2}
                  stroke={SURFACE}
                  strokeWidth={3}
                  paintOrder="stroke"
                  fontFamily={FONT}
                >
                  {a.label}
                </text>
              </g>
            );
          }
          return (
            <g key={i}>
              <line
                x1={a.x1}
                y1={a.y}
                x2={a.x2}
                y2={a.y}
                stroke={STROKE}
                strokeWidth={1.5}
                strokeDasharray={dash}
                markerEnd={`url(#${marker})`}
              />
              <text
                x={a.labelX}
                y={a.labelY}
                textAnchor="middle"
                fontSize={11.5}
                fill={TEXT2}
                stroke={SURFACE}
                strokeWidth={3}
                paintOrder="stroke"
                fontFamily={FONT}
              >
                {a.label}
              </text>
            </g>
          );
        })}
      </svg>
      {laid.dropped.length > 0 || duplicates > 0 ? (
        <div style={{ fontSize: 12, color: TEXT2, padding: "4px 2px 0" }}>
          {[
            duplicates > 0
              ? `${duplicates} duplicate participant id${duplicates > 1 ? "s" : ""} skipped`
              : null,
            laid.dropped.length > 0
              ? `${laid.dropped.length} message${laid.dropped.length > 1 ? "s" : ""} skipped (unknown participant)`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

export const SequenceDiagram = defineComponent({
  name: "SequenceDiagram",
  description:
    "Timeline of messages passed between participants over time - lanes left-to-right, messages top-to-bottom. Use Participant references for lanes and Message references for arrows, in chronological order.",
  props: z.object({
    participants: z.array(Participant.ref),
    messages: z.array(Message.ref),
  }),
  component: ({ props }) => (
    <SequenceDiagramView
      participants={(props.participants ?? [])
        .filter((el) => el.props?.id && el.props?.label)
        .map((el) => el.props as ParticipantData)}
      messages={(props.messages ?? [])
        .filter((el) => el.props?.from && el.props?.to)
        .map((el) => el.props as MessageData)}
    />
  ),
});
