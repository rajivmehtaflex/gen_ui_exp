// Pure Zod schemas for the diagram child components (no React, no .ref —
// the .ref wiring happens where the DefinedComponents are created).
// Zod key order = positional argument order in OpenUI Lang: required and
// distinctive props first, optional last.
import { z } from "zod/v4";

/** Apply an authoring bound to an OpenUI child-reference array. */
export function boundedReferenceArray<T extends z.core.SomeType>(reference: T, maxItems: number) {
  return z.array(reference).max(maxItems);
}

// ── Flow family ──
export const FlowNodeKind = z.enum(["process", "start", "end", "decision", "input", "store"]);

export const FlowNodeSchema = z.object({
  id: z.string(), // 1: unique slug, referenced by FlowEdge from/to
  label: z.string(), // 2: 1-3 words
  kind: FlowNodeKind.optional(), // 3: accent color, default "process"
});
export const FlowEdgeSchema = z.object({
  from: z.string(), // 1: FlowNode id
  to: z.string(), // 2: FlowNode id
  label: z.string().optional(), // 3: short label on the arrow
});

export type FlowNodeData = z.infer<typeof FlowNodeSchema>;
export type FlowEdgeData = z.infer<typeof FlowEdgeSchema>;

// ── Sequence family ──
export const MessageKind = z.enum(["sync", "async", "return"]);

export const ParticipantSchema = z.object({
  id: z.string(), // 1: unique slug, referenced by Message from/to
  label: z.string(), // 2: actor/system name
});
export const MessageSchema = z.object({
  from: z.string(), // 1: Participant id
  to: z.string(), // 2: Participant id
  label: z.string(), // 3: what is sent (short phrase)
  kind: MessageKind.optional(), // 4: default "sync"
});

export type ParticipantData = z.infer<typeof ParticipantSchema>;
export type MessageData = z.infer<typeof MessageSchema>;

// ── Explainer family ──
export const ExplainerStepSchema = z.object({
  title: z.string(), // 1: required
  body: z.string().optional(), // 2: markdown prose
  code: z.string().optional(), // 3: plain source, monospace block
  note: z.string().optional(), // 4: one-line tip/caveat
});

export type ExplainerStepData = z.infer<typeof ExplainerStepSchema>;
