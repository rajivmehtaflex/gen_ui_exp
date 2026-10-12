import type {
  ExplainerStepData,
  FlowEdgeData,
  FlowNodeData,
  MessageData,
  ParticipantData,
} from "./schemas";

export const MAX_FLOW_NODES = 12;
export const MAX_FLOW_EDGES = 24;
export const MAX_SEQUENCE_PARTICIPANTS = 6;
export const MAX_SEQUENCE_MESSAGES = 12;
export const MAX_EXPLAINER_STEPS = 12;

type PartialItem<T> = T | Partial<T> | null | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeFlow(
  inputNodes: ReadonlyArray<PartialItem<FlowNodeData>>,
  inputEdges: ReadonlyArray<PartialItem<FlowEdgeData>>,
): {
  nodes: FlowNodeData[];
  edges: FlowEdgeData[];
  omittedNodes: number;
  omittedEdges: number;
  selfEdges: number;
} {
  let omittedNodes = 0;
  const seen = new Set<string>();
  const uniqueNodes: FlowNodeData[] = [];

  for (const candidate of inputNodes) {
    if (!isRecord(candidate) || !hasText(candidate.id) || !hasText(candidate.label)) {
      omittedNodes += 1;
      continue;
    }
    if (seen.has(candidate.id)) {
      omittedNodes += 1;
      continue;
    }
    seen.add(candidate.id);
    uniqueNodes.push({
      id: candidate.id,
      label: candidate.label,
      ...(typeof candidate.kind === "string" ? { kind: candidate.kind as FlowNodeData["kind"] } : {}),
    });
  }

  const nodes = uniqueNodes.slice(0, MAX_FLOW_NODES);
  omittedNodes += uniqueNodes.length - nodes.length;
  const retainedIds = new Set(nodes.map((node) => node.id));

  let omittedEdges = 0;
  let selfEdges = 0;
  const validEdges: FlowEdgeData[] = [];
  for (const candidate of inputEdges) {
    if (!isRecord(candidate) || !hasText(candidate.from) || !hasText(candidate.to)) {
      omittedEdges += 1;
      continue;
    }
    validEdges.push({
      from: candidate.from,
      to: candidate.to,
      ...(typeof candidate.label === "string" ? { label: candidate.label } : {}),
    });
  }

  const cappedEdges = validEdges.slice(0, MAX_FLOW_EDGES);
  omittedEdges += validEdges.length - cappedEdges.length;
  const edges: FlowEdgeData[] = [];
  for (const edge of cappedEdges) {
    if (edge.from === edge.to) {
      selfEdges += 1;
      omittedEdges += 1;
      continue;
    }
    if (!retainedIds.has(edge.from) || !retainedIds.has(edge.to)) {
      omittedEdges += 1;
      continue;
    }
    edges.push(edge);
  }

  return { nodes, edges, omittedNodes, omittedEdges, selfEdges };
}

export function normalizeSequence(
  inputParticipants: ReadonlyArray<PartialItem<ParticipantData>>,
  inputMessages: ReadonlyArray<PartialItem<MessageData>>,
): {
  participants: ParticipantData[];
  messages: MessageData[];
  omittedParticipants: number;
  omittedMessages: number;
} {
  let omittedParticipants = 0;
  const seen = new Set<string>();
  const uniqueParticipants: ParticipantData[] = [];

  for (const candidate of inputParticipants) {
    if (!isRecord(candidate) || !hasText(candidate.id) || !hasText(candidate.label)) {
      omittedParticipants += 1;
      continue;
    }
    if (seen.has(candidate.id)) {
      omittedParticipants += 1;
      continue;
    }
    seen.add(candidate.id);
    uniqueParticipants.push({ id: candidate.id, label: candidate.label });
  }

  const participants = uniqueParticipants.slice(0, MAX_SEQUENCE_PARTICIPANTS);
  omittedParticipants += uniqueParticipants.length - participants.length;
  const retainedIds = new Set(participants.map((participant) => participant.id));

  let omittedMessages = 0;
  const validMessages: MessageData[] = [];
  for (const candidate of inputMessages) {
    if (
      !isRecord(candidate) ||
      !hasText(candidate.from) ||
      !hasText(candidate.to) ||
      typeof candidate.label !== "string"
    ) {
      omittedMessages += 1;
      continue;
    }
    validMessages.push({
      from: candidate.from,
      to: candidate.to,
      label: candidate.label,
      ...(typeof candidate.kind === "string" ? { kind: candidate.kind as MessageData["kind"] } : {}),
    });
  }

  const cappedMessages = validMessages.slice(0, MAX_SEQUENCE_MESSAGES);
  omittedMessages += validMessages.length - cappedMessages.length;
  const messages = cappedMessages.filter((message) => {
    const retained = retainedIds.has(message.from) && retainedIds.has(message.to);
    if (!retained) omittedMessages += 1;
    return retained;
  });

  return { participants, messages, omittedParticipants, omittedMessages };
}

export function normalizeSteps(inputSteps: ReadonlyArray<PartialItem<ExplainerStepData>>): {
  steps: ExplainerStepData[];
  omittedSteps: number;
} {
  const complete: ExplainerStepData[] = [];
  let omittedSteps = 0;
  for (const candidate of inputSteps) {
    if (!isRecord(candidate) || !hasText(candidate.title)) {
      omittedSteps += 1;
      continue;
    }
    complete.push({
      title: candidate.title,
      ...(typeof candidate.body === "string" ? { body: candidate.body } : {}),
      ...(typeof candidate.code === "string" ? { code: candidate.code } : {}),
      ...(typeof candidate.note === "string" ? { note: candidate.note } : {}),
    });
  }

  const steps = complete.slice(0, MAX_EXPLAINER_STEPS);
  omittedSteps += complete.length - steps.length;
  return { steps, omittedSteps };
}
