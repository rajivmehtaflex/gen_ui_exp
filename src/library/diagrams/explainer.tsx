// StepExplainer family: ExplainerStep is a data carrier (renders null);
// StepExplainer renders an ordered concept walkthrough as plain HTML.
import { defineComponent } from "@openuidev/react-lang";
import { MarkDownRenderer } from "@openuidev/react-ui";
import { z } from "zod/v4";
import { ExplainerStepSchema, type ExplainerStepData } from "./schemas";

export const ExplainerStep = defineComponent({
  name: "ExplainerStep",
  description:
    "One step in a StepExplainer: title, optional body (markdown prose), optional code (plain source rendered as a monospace block), optional note (one-line tip or caveat). All props are plain strings.",
  props: ExplainerStepSchema,
  component: () => null,
});

function StepExplainerView({ steps }: { steps: ExplainerStepData[] }) {
  return (
    <div className="gx-steps">
      {steps.map((s, i) =>
        s?.title ? (
          <div
            key={i}
            style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0" }}
          >
            <div
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
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--openui-text-neutral-primary, #1f2328)" }}>
                {s.title}
              </div>
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
          </div>
        ) : null,
      )}
    </div>
  );
}

export const StepExplainer = defineComponent({
  name: "StepExplainer",
  description:
    'Ordered concept walkthrough - explains how something works, one ExplainerStep at a time. Use it for "how does X work" explanations; use Steps for sequential task/UI instructions instead.',
  props: z.object({
    steps: z.array(ExplainerStep.ref),
  }),
  component: ({ props }) => (
    <StepExplainerView
      steps={(props.steps ?? [])
        .filter((el) => el.props?.title)
        .map((el) => el.props as ExplainerStepData)}
    />
  ),
});
