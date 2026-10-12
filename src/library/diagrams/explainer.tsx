// StepExplainer family: ExplainerStep is a data carrier (renders null);
// StepExplainer renders an ordered concept walkthrough as plain HTML.
import { defineComponent } from "@openuidev/react-lang";
import { MarkDownRenderer } from "@openuidev/react-ui";
import { z } from "zod/v4";
import { boundedReferenceArray, ExplainerStepSchema, type ExplainerStepData } from "./schemas";
import { MAX_EXPLAINER_STEPS, normalizeSteps } from "./limits";

export const ExplainerStep = defineComponent({
  name: "ExplainerStep",
  description:
    "One step in a StepExplainer: title, optional body (markdown prose), optional code (plain source rendered as a monospace block), optional note (one-line tip or caveat). All props are plain strings.",
  props: ExplainerStepSchema,
  component: () => null,
});

function StepExplainerView({
  steps,
  omittedSteps,
}: {
  steps: ExplainerStepData[];
  omittedSteps: number;
}) {
  return (
    <div className="gx-steps">
      <ol
        aria-label="Ordered concept walkthrough"
        style={{ listStyle: "none", margin: 0, padding: 0 }}
      >
        {steps.map((s, i) => (
          <li
            key={i}
            style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}
          >
            <div
              aria-hidden="true"
              style={{
                flexShrink: 0,
                width: 28,
                height: 28,
                borderRadius: "var(--openui-radius-s, 8px)",
                background: "var(--openui-sunk, #f6f8fa)",
                color: "var(--openui-text-accent-primary, #0969da)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {i + 1}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "var(--openui-text-neutral-primary, #1f2328)" }}>
                {s.title}
              </h3>
              {s.body ? (
                <div style={{ fontSize: 13.5, color: "var(--openui-text-neutral-secondary, #57606a)" }}>
                  <MarkDownRenderer textMarkdown={s.body} variant="clear" />
                </div>
              ) : null}
              {s.code ? (
                <pre
                  style={{
                    font: "12px var(--openui-font-code, ui-monospace, monospace)",
                    background: "var(--openui-sunk, #f6f8fa)",
                    border: "1px solid var(--openui-border-default, #d0d7de)",
                    borderRadius: "var(--openui-radius-s, 8px)",
                    padding: "8px 10px",
                    overflowX: "auto",
                    margin: "6px 0 0",
                  }}
                >
                  {s.code}
                </pre>
              ) : null}
              {s.note ? (
                <div
                  style={{
                    marginTop: 6,
                    fontSize: 12.5,
                    color: "var(--openui-text-neutral-secondary, #57606a)",
                    borderLeft: "3px solid var(--openui-border-info-emphasis, #539bf5)",
                    background: "var(--openui-info-background, #f0f6ff)",
                    padding: "4px 8px",
                    borderRadius: "0 var(--openui-radius-s, 8px) var(--openui-radius-s, 8px) 0",
                  }}
                >
                  {s.note}
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {omittedSteps > 0 ? (
        <div role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--openui-text-neutral-secondary, #57606a)" }}>
          {omittedSteps} incomplete or over-limit explainer step{omittedSteps === 1 ? "" : "s"} omitted
        </div>
      ) : null}
    </div>
  );
}

export const StepExplainer = defineComponent({
  name: "StepExplainer",
  description:
    'Ordered concept walkthrough - explains how something works, one ExplainerStep at a time. Use it for "how does X work" explanations; use Steps for sequential task/UI instructions instead.',
  props: z.object({
    steps: boundedReferenceArray(ExplainerStep.ref, MAX_EXPLAINER_STEPS),
  }),
  component: ({ props }) => {
    const stepRefs = Array.isArray(props.steps) ? props.steps : [];
    const { steps, omittedSteps } = normalizeSteps(stepRefs.map((el) => el?.props ?? {}));
    return <StepExplainerView steps={steps} omittedSteps={omittedSteps} />;
  },
});
