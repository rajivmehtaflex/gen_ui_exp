# PLAN — Stage 1: Custom Diagram Components (Flow · Sequence · Explainer)

*Customization phase for gen_ui_exp, shaped by the user's `diagramify` skill. Merged plan: inline design + architect-agent findings (all APIs verified against installed packages: react-ui 0.16.3, react-headless 0.16.3, lang-core 0.3.2, zod 3.25.76, Node 24).*

## Context

Phase #1 (self-hosted GenUI hello-world) is built, reviewed, and live on the user's OpenRouter key. `openuiChatLibrary` has 9 *data* charts but **zero node-and-edge diagram vocabulary** — "diagram the request flow" cannot be answered today. Stage 1 buys that vocabulary as **custom components inline in chat**. Stage 2 (diagramify-style explorable HTML artifacts) is a separate later plan.

**Locked decisions:** inline-in-chat first (user chose staged hybrid) · component set Flow + Sequence + Explainer (user choice) · built on gen_ui_exp · TDD discipline (RED watched → GREEN) · installed packages win · no browser in sandbox → structure-level verification only, no visual claims.

**Empirically verified (do not re-derive):**
- `openuiChatLibrary.components` = public runtime record with **84 built-ins**; spreading into `createLibrary({ root: "Card", components: [...built-ins, ...ours] })` parses `root = Card([d]) / d = Dummy(...)` with **0 errors** — the built-in `Card` children union does NOT need redefining (parser resolves names against the catalog). Negative control: unknown component still errors `unknown-component`; wrong arg count errors `excess-args`.
- `toSpec()` signature = Zod key order; optional props get `?`. `generateSystemPrompt({library: spec, promptOptions})` includes new components automatically.
- All 5 existing `openuiChatPromptOptions.examples` parse clean today (drop the `Example N —` headline line before parsing). Baseline system prompt: **53,688 bytes** (library-only 26,387).
- react-ui also exports `openuiChatComponentGroups`, `openuiChatExamples`, `openuiChatAdditionalRules` (re-use instead of blind-spreading).
- House pattern (react-ui source, Steps): child components are data — `component: () => null`; parent maps `props.items` (`SubComponentOf[]`, tolerate `partial`); schemas in a separate pure module.
- `@dagrejs/dagre@3.1.1`: named exports `Graph, layout`; `new Graph({multigraph:true})`, `setGraph({rankdir, nodesep, ranksep, marginx, marginy, ranker:"network-simplex"})`, `setDefaultEdgeLabel(()=>({}))`, `setNode(id,{width,height})`, `setEdge(v,w,{width,height,labelpos:"c",labeloffset:0},name)`, `layout(g)`; `g.node(id)` center coords; `g.edge(v,w,name).points`; `g.graph().width/height`. Bundled types; single dep graphlib.
- Chat geometry: thread column ≤880px desktop, <400px mobile → SVG `width="100%"` + `viewBox` + `minWidth:520` inside `overflowX:auto` wrapper.
- Design tokens available: `--openui-foreground, -sunk, -elevated, -border-default, -border-accent(-emphasis), -border-info|-success|-alert(-emphasis), -info-background, -text-neutral-primary|secondary|tertiary, -text-accent-primary, -font-body, -font-code, -radius-s|m`.
- `zod/v4` subpath works; tsx 4.23.15; `react/jsx-runtime` imports fine under Node ESM.

## Component APIs (order = positional arg order)

```
FlowDiagram(nodes: FlowNode[], edges: FlowEdge[], direction?: "TB" | "LR")
FlowNode(id: string, label: string, kind?: "process" | "start" | "end" | "decision" | "input" | "store")
FlowEdge(from: string, to: string, label?: string)
SequenceDiagram(participants: Participant[], messages: Message[])
Participant(id: string, label: string)
Message(from: string, to: string, label: string, kind?: "sync" | "async" | "return")
StepExplainer(steps: ExplainerStep[])
ExplainerStep(title: string, body?: string, code?: string, note?: string)
```

Model-facing descriptions (crisp, when-to-choose): FlowDiagram = "Directed diagram for workflows, architectures, dataflows and lifecycles — auto-laid-out SVG. direction: TB (default) or LR (pipelines)." · FlowNode ids are short unique slugs FlowEdge from/to reference; kind colors the node · FlowEdge optional 1–3-word arrow label; both endpoints must exist · SequenceDiagram = "Timeline of messages between participants — lanes L→R, messages top→bottom, in chronological order" · Message kind: sync (solid, default), async (open head), return (dashed reply) · StepExplainer = "Concept walkthrough (how does X work); use Steps for task/UI instructions instead" · ExplainerStep props are plain strings (body markdown, code monospace block, note one-line tip).

## File layout (new +, modified ~)

```
src/library/
├── chat-library.ts            +  appChatLibrary + appChatPromptOptions + diagramGroup (no JSX → .ts)
└── diagrams/
    ├── schemas.ts             +  all 8 Zod schemas (pure zod/v4)
    ├── flow-layout.ts         +  dagre wrapper + wrapLabel/pointsToPath (pure, Node-testable)
    ├── sequence-layout.ts     +  hand-laid lane/arrow math (pure)
    ├── flow.tsx  sequence.tsx  explainer.tsx    +  the 3 families (SVG / SVG / HTML renderers)
src/App.tsx                    ~  componentLibrary={appChatLibrary}
scripts/
├── gen-spec.ts                +  REPLACES gen-spec.mjs (tsx runner; --check staleness gate)
├── validate-recipe.mjs        ~  validates ALL exported canned recipes
├── validate-examples.mjs      +  every promptOptions.example parses with 0 errors
├── test-library.mjs           +  contract test: root, 92 components, 8 exact signatures, group
├── test-diagram-layout.mjs    +  layout math unit tests (pure)
└── live-smoke.mjs             ~  optional runs arg (default 1); summary "clean N/M"
server/canned-recipe.mjs       ~  + flow/sequence/explainer recipes + pickCannedRecipe(prompt)
server/chat.mjs                ~  canned branch uses pickCannedRecipe (live path untouched)
package.json                   ~  deps @dagrejs/dagre ^3.1.1, devDep tsx ^4.23.15; new scripts
```

## Library extension (single source of truth)

`chat-library.ts`:
```ts
export const appChatLibrary = createLibrary({
  id: "gen-ui-exp-chat@1",
  root: "Card",
  componentGroups: [...openuiChatComponentGroups,
    { name: "Diagrams", components: [/* 8 names */], notes: [/* see below */] }],
  components: [...Object.values(openuiChatLibrary.components),
    FlowDiagram, FlowNode, FlowEdge, SequenceDiagram, Participant, Message, StepExplainer, ExplainerStep],
});
export const appChatPromptOptions = {
  ...openuiChatPromptOptions,
  examples: [...openuiChatExamples, flowExample, sequenceExample, explainerExample],
  additionalRules: [...openuiChatAdditionalRules, ...diagramRules],
};
```
Do NOT redefine `Card` (verified unnecessary). Renderers tolerate streaming partials: `?? []` arrays, skip children with missing required props, **drop edges/messages with unresolved endpoint ids** (never NaN/throw; small in-card note), finite minimal result for 0–1 items; `useMemo` the layout on serialized props.

## Renderers (sketches)

- **FlowDiagram (SVG):** `layoutFlow` → `<defs>` arrowhead markers; edges as smooth cubic paths through dagre points + label (bg rect + text) at dagre label center; nodes `<g transform>` rounded rect `rx=10` fill `--openui-foreground`, 3px kind-colored accent strip, ≤2-line wrapped label, kind color dot. Kind→token: process `-border-accent`, start `-border-success-emphasis`, end `-border-danger-emphasis`, decision `-border-alert-emphasis`, input `-border-info-emphasis`, store `-text-accent-tertiary`. Deterministic node box: width 168, `height = 24 + lines*16` (min 44); edge label box `w = len*6.2+10, h = 16`.
- **SequenceDiagram (SVG):** participant cards (fill `-sunk`, stroke `-border-default`), dashed lifelines, arrows per kind (solid+filled head / solid+open V / dashed+open V), label above line centered between lanes; self-message = small right-loop arc. No activation bars (Stage 1).
- **StepExplainer (HTML):** numbered badges on accent rail; `body` via built-in `MarkDownRenderer`; `code` in `<pre>` (12px `-font-code`, bg `-sunk`, border `-border-default`); `note` = callout with 3px info left border.
- **Layout math:** dagre `rankdir TB|LR, nodesep 36, ranksep 64, marginx/y 12, multigraph` (parallel edges); `layoutSequence`: `laneX(i)=90+i*150`, `rowY(i)=70+(i+1)*54`; throws on duplicate ids; callers drop unknown refs defensively.

## Spec pipeline (TSX → spec)

- `npm i -D tsx`; `gen:spec` → `tsx scripts/gen-spec.ts` imports `appChatLibrary` + `appChatPromptOptions`; output contract unchanged (`library: {...toSpec(), schema: toJSONSchema()}, promptOptions`) → server untouched. `--check` flag: rebuild in memory, byte-compare to committed file, exit 1 if stale (makes stale-spec commits impossible).
- T1 spike gates this choice: `npx tsx -e "import { openuiChatLibrary } from '@openuidev/react-ui'; console.log(Object.keys(openuiChatLibrary.components).length)"` → `84`. If it fails, STOP and report (fallback: schema/renderer split — not expected).
- Regeneration loop (RUNBOOK): edit `src/library/` → `npm run gen:spec` → server `--watch` restarts on the JSON change → Vite HMR updates client.

## Canned mode (demo value, keyless)

`canned-recipe.mjs` exports original + `flowRecipe` (6 nodes, decision branch) + `sequenceRecipe` (4 participants, 6 messages incl. a return) + `explainerRecipe` (4 steps with body+code+note) + `pickCannedRecipe(prompt)`: `/sequence|lifecycle|timeline/`→sequence; `/flow|workflow|architecture|dataflow|pipeline|diagram/`→flow; `/step.by.step|explainer|how does .+ work/`→explainer; default hello. `chat.mjs` canned branch picks by last user message. Live path untouched.

## PromptOptions content (T7)

- 3 canonical examples (flow: deploy pipeline w/ decision loop; sequence: checkout lifecycle; explainer: HTTP caching) — full text drafted in architect notes, each **parser-validated before adoption** (validate-examples gate).
- 5 additionalRules: nodes-then-edges + unique ids/never self-connect · SequenceDiagram positional + time order + return kind · StepExplainer plain strings, never nest components, Steps for task instructions · LR for pipelines/TB for decision-heavy · keep diagram text short (titles 1–5 words, labels 1–3).
- diagramGroup.notes: id-slug rules, 12 nodes / 6 participants / 12 messages max, StepExplainer-vs-Steps disambiguation, card-width scaling note.
- Expected prompt delta ≈ +4KB (~57–58KB from 53.7KB) — measure and record.

## TDD task breakdown (each: RED watched → GREEN → commit)

1. **T1 deps + spike** — install dagre+tsx; run the 84-print spike; STOP-and-report if it fails.
2. **T2 Flow family** — RED: `test-library.mjs` (root, 84 built-ins present, Flow signatures verbatim, Diagrams group) + flow layout asserts (finite/in-bounds, edges ≥2 points, LR vs TB ordering, determinism (run twice deep-equal), dangling edge dropped w/o NaN, 0/1-node finite) → implement schemas + flow-layout + flow.tsx + register trio → GREEN.
3. **T3 Sequence family** — RED: signatures + layout asserts (lanes strictly increasing, arrow rows increasing in message order, label fits span or truncated flag, self-loop finite, unknown refs dropped, 1-participant finite) → implement + register → GREEN.
4. **T4 Explainer family** — RED: signatures + total count **92** → implement explainer.tsx + register → GREEN.
5. **T5 Spec pipeline + client wiring** — RED: `check:spec` exit 1 (spec stale); gen-spec.ts replaces .mjs; regen → spec has 92 components; **`check:recipe` still 0 errors (regression gate)**; App.tsx → `appChatLibrary`; `npm run build` clean; delete gen-spec.mjs.
6. **T6 Canned recipes + routing** — RED: validator iterates all recipes, fails while diagram recipes missing → implement 3 recipes + pickCannedRecipe → `check:recipe` 4/4; keyless e2e via `OPENROUTER_API_KEY= PORT=8790 node --env-file=.env server/chat.mjs` (empty env var overrides .env → canned) + live-smoke against :8790 for each prompt → 0 errors each.
7. **T7 PromptOptions gates** — RED: `validate-examples.mjs` (≥8 examples, each parses clean, all 8 names covered) → implement examples/rules/notes → regen → GREEN.
8. **T8 Full local battery + RUNBOOK** — build, check:spec, check:recipe, check:examples, test:library, test:layout, test-error-visibility (must still pass), canned SSE smokes; RUNBOOK: scripts table, regen loop, diagram prompts, version-drift paragraph.
9. **T9 Live baseline 3×3** — prompts: "Show a CI/CD pipeline as a flow diagram" · "Diagram the request lifecycle of a checkout API as a sequence diagram" · "Explain how HTTP caching works step by step"; `live-smoke <url> "<prompt>" 3` each → record per-run errors + clean N/3 matrix in RUNBOOK. Tuning rule: only if a **repeating** structural failure appears across runs, change ONE lever (sharpen rule → fix example → simplify schema, in that order) and re-run the same 9. Iterate to 9/9 or report the residual failure mode honestly.

## Verification (end state)

| Gate | Expected |
|---|---|
| `npm run test:library` | 92 components, root Card, 8 signatures verbatim |
| `npm run test:layout` | all asserts pass |
| `npm run check:spec` | up to date |
| `npm run check:recipe` | 4/4 recipes, 0 errors, root Card |
| `npm run check:examples` | 8/8 examples, 0 errors |
| `npm run build` | tsc + vite clean (dagre chunk warning allowed) |
| `node scripts/test-error-visibility.mjs` | 2/2 PASS (unchanged behavior intact) |
| keyless canned smokes | 3 diagram prompts → 0 parse errors each |
| live 3×3 | matrix recorded in RUNBOOK (9/9 target, honest residuals otherwise) |
| git | one commit per task, clean tree |

## Risks / notes

- Likeliest model failures (free tier): positional-order slips (excess-args), inline objects instead of child refs, dangling edge ids (renderer drops — visible in DevTools only), FlowDiagram self-loops (forbidden by rule; dropped defensively). Tuning levers in order: schema simplification → group notes → examples; re-measure the same 3×3 after every change.
- Prompt grows ~7% — acceptable; first trim lever is examples, never schemas.
- No browser in sandbox: layout/parser/build/live-parse verification only; visual confirmation happens on the user's machine — request it, never claim it.
- Version pins: dagre ^3.1.1, tsx ^4.23.15; on any @openuidev/* upgrade re-run test:library (signatures pinned verbatim) + check:spec + check:recipe.

## Out of scope (Stage 2+)

Artifact/HTML export pipeline · theming · auth · persistence · correction loop · zoom/pan, clusters, self-loops, activation bars · animated diagrams · `openui deploy`.
