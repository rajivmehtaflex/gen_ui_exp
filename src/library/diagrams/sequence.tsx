// SequenceDiagram family: Participant + Message are data carriers (render null);
// SequenceDiagram hand-lays lanes and message arrows into one inline SVG.
import { useId, useMemo } from "react";
import { defineComponent } from "@openuidev/react-lang";
import { z } from "zod/v4";
import {
  boundedReferenceArray,
  MessageSchema,
  ParticipantSchema,
  type MessageData,
  type ParticipantData,
} from "./schemas";
import { layoutSequence } from "./sequence-layout";
import { dedupeById } from "./dedupe";
import {
  MAX_SEQUENCE_MESSAGES,
  MAX_SEQUENCE_PARTICIPANTS,
  normalizeSequence,
} from "./limits";

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
  const duplicateCandidates = participants.filter(
    (participant) =>
      participant &&
      typeof participant.id === "string" &&
      participant.id.trim() &&
      typeof participant.label === "string" &&
      participant.label.trim(),
  );
  const { duplicates } = useMemo(() => dedupeById(duplicateCandidates), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const normalized = useMemo(() => normalizeSequence(participants, messages), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const laid = useMemo(() => layoutSequence(normalized.participants, normalized.messages), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const mFilled = `sq-filled-${uid}`;
  const mOpen = `sq-open-${uid}`;
  const titleId = `sq-title-${uid}`;
  const descriptionId = `sq-description-${uid}`;
  const retainedIds = new Set(normalized.participants.map((participant) => participant.id));
  const consideredMessages = messages
    .filter(
      (message) =>
        message &&
        typeof message.from === "string" &&
        message.from.trim() &&
        typeof message.to === "string" &&
        message.to.trim() &&
        typeof message.label === "string",
    )
    .slice(0, MAX_SEQUENCE_MESSAGES);
  const danglingMessages = consideredMessages.filter(
    (message) => !retainedIds.has(message.from) || !retainedIds.has(message.to),
  );
  const additionalOmittedMessages = Math.max(0, normalized.omittedMessages - danglingMessages.length);
  const participantDescription = laid.lanes.map((lane) => `${lane.label} (${lane.id})`).join("; ") || "none";
  const messageDescription =
    laid.arrows.map((arrow) => `${arrow.from} to ${arrow.to}: ${arrow.fullLabel}`).join("; ") || "none";
  const warnings = [
    normalized.omittedParticipants > 0
      ? `${normalized.omittedParticipants} participant${normalized.omittedParticipants === 1 ? "" : "s"} omitted${duplicates ? ` (${duplicates} duplicate id${duplicates === 1 ? "" : "s"})` : " (incomplete or over limit)"}`
      : null,
    danglingMessages.length > 0
      ? `${danglingMessages.length} message${danglingMessages.length === 1 ? "" : "s"} skipped (unknown participant)`
      : null,
    additionalOmittedMessages > 0
      ? `${additionalOmittedMessages} message${additionalOmittedMessages === 1 ? "" : "s"} omitted (incomplete or over limit)`
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
          maxWidth: Math.round(laid.width * 1.5),
          minWidth: laid.width,
          display: "block",
          margin: "0 auto",
        }}
        preserveAspectRatio="xMidYMid meet"
      >
        <title id={titleId}>Sequence diagram</title>
        <desc id={descriptionId}>
          Participants: {participantDescription}. Messages in order: {messageDescription}.
        </desc>
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
            <title>{l.label}</title>
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
          return (
            <g key={`${a.from}->${a.to}-${i}`}>
              <title>{`${a.from} to ${a.to}: ${a.fullLabel}`}</title>
              <path
                d={a.path}
                fill="none"
                stroke={STROKE}
                strokeWidth={1.5}
                strokeDasharray={dash}
                markerEnd={`url(#${marker})`}
              />
              <text
                x={a.labelX}
                y={a.labelY}
                textAnchor={a.selfLoop ? "start" : "middle"}
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
      {warnings.length > 0 ? (
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: TEXT2, padding: "4px 2px 0" }}>
          {warnings.join(" · ")}
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
    participants: boundedReferenceArray(Participant.ref, MAX_SEQUENCE_PARTICIPANTS),
    messages: boundedReferenceArray(Message.ref, MAX_SEQUENCE_MESSAGES),
  }),
  component: ({ props }) => {
    const participantRefs = Array.isArray(props.participants) ? props.participants : [];
    const messageRefs = Array.isArray(props.messages) ? props.messages : [];
    return (
      <SequenceDiagramView
        participants={participantRefs.map((el) => (el?.props ?? {}) as ParticipantData)}
        messages={messageRefs.map((el) => (el?.props ?? {}) as MessageData)}
      />
    );
  },
});
