// Canned recipes (OpenUI Lang), streamed when no OPENROUTER_API_KEY is set.
// All are validated by scripts/validate-recipe.mjs before the server ever
// uses them. root comes first (frame before children), forward references,
// built-ins + our diagram components only, positional args, null for skipped
// middle optionals (house pattern from the built-in prompt examples).
export const cannedRecipe = `root = Card([header, intro, how, followups])
header = CardHeader("Hello from GenUI", "Your first AI-generated interface")
intro = TextContent("This card was not hand-coded. Lines of OpenUI Lang streamed from the server and your browser cooked them into live UI.", "default")
how = Steps([s1, s2, s3])
s1 = StepsItem("You sent a message", "The client posted it to /api/chat in OpenAI message format.")
s2 = StepsItem("The server briefed the model", "generateSystemPrompt attached the component menu (or, with no API key set, this canned recipe is served instead).")
s3 = StepsItem("The recipe streamed back", "Each line arrived, was parsed, and rendered as it landed - no spinner required.")
followups = FollowUpBlock([f1, f2, f3])
f1 = FollowUpItem("Set an OpenRouter key and ask me anything")
f2 = FollowUpItem("Why does root come first?")
f3 = FollowUpItem("What is the briefing pack?")`;

export const flowRecipe = `root = Card([header, intro, flow, followups])
header = CardHeader("How our deploy works", "push to main -> production")
intro = TextContent("Four stages gate every release.", "default")
flow = FlowDiagram([n1, n2, n3, n4, n5], [e1, e2, e3, e4, e5], "TB")
n1 = FlowNode("push", "Push to main", "start")
n2 = FlowNode("ci", "CI tests")
n3 = FlowNode("review", "Review OK?", "decision")
n4 = FlowNode("staging", "Staging")
n5 = FlowNode("prod", "Production", "end")
e1 = FlowEdge("push", "ci", "on merge")
e2 = FlowEdge("ci", "review", "green")
e3 = FlowEdge("review", "staging", "yes")
e4 = FlowEdge("review", "ci", "fix requested")
e5 = FlowEdge("staging", "prod", "promote")
followups = FollowUpBlock([f1, f2])
f1 = FollowUpItem("Explain the review gate step by step")
f2 = FollowUpItem("Show the checkout lifecycle as a sequence diagram")`;

export const sequenceRecipe = `root = Card([header, seq, followups])
header = CardHeader("Checkout request lifecycle", "browser -> api -> data -> provider")
seq = SequenceDiagram([p1, p2, p3, p4], [m1, m2, m3, m4, m5, m6])
p1 = Participant("browser", "Browser")
p2 = Participant("api", "Checkout API")
p3 = Participant("db", "Postgres")
p4 = Participant("psp", "Payment provider")
m1 = Message("browser", "api", "POST /checkout", "sync")
m2 = Message("api", "psp", "Authorize $42.00", "async")
m3 = Message("psp", "api", "Approved", "return")
m4 = Message("api", "db", "INSERT order", "sync")
m5 = Message("db", "api", "row id", "return")
m6 = Message("api", "browser", "201 order id", "return")
followups = FollowUpBlock([f1, f2])
f1 = FollowUpItem("Add a payment failure path")
f2 = FollowUpItem("Show the deploy pipeline as a flow diagram")`;

export const explainerRecipe = `root = Card([header, intro, ex, tip])
header = CardHeader("How HTTP caching works", "in four moves")
intro = TextContent("The browser and the server negotiate freshness on every request.", "default")
ex = StepExplainer([s1, s2, s3, s4])
s1 = ExplainerStep("Request", "The browser checks its local cache for a fresh copy first.", null, "Fresh means the resource has not outlived its max-age.")
s2 = ExplainerStep("Revalidate", "If stale, the browser asks the server with an If-None-Match header.", "GET /logo.png HTTP/1.1\\nIf-None-Match: \\"abc123\\"")
s3 = ExplainerStep("Server decision", "An unchanged resource answers 304 with no body; a changed one answers 200 with the new bytes.", null, "304s are nearly free - no payload.")
s4 = ExplainerStep("Reuse", "The browser stores the new response under its Cache-Control policy and serves it until it goes stale.")
tip = TextContent("Ask for this flow as a diagram next.", "small")`;

// Keyword router for canned mode — mirrors what a live model would answer.
export function pickCannedRecipe(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  if (/sequence|lifecycle|timeline/.test(text)) return sequenceRecipe;
  if (/flow|workflow|architecture|dataflow|pipeline|diagram/.test(text)) return flowRecipe;
  if (/step.by.step|explainer|how does .+ work|how do .+ work/.test(text)) return explainerRecipe;
  return cannedRecipe;
}
