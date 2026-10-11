// The canned hello-world recipe (OpenUI Lang), streamed when no OPENROUTER_API_KEY
// is configured. Built-ins only, root Card — the same contract a live model must
// follow. Validated by scripts/validate-recipe.mjs before the server ever uses it.
//
// Note: root comes first (the frame renders before children exist), children are
// forward references, every component is from openuiChatLibrary, positional args only.
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
