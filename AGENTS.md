# Repository Guidelines

## Project Structure

- `src/` is the Vite/React client: `src/App.tsx` mounts `AgentInterface`; `src/library/chat-library.ts` composes OpenUI built-ins, eight diagram components, and prompt guidance.
- `src/library/diagrams/` holds component schemas, React renderers, and pure layout helpers. Keep layout logic separate from rendering where practical.
- `server/` contains the Express streaming chat route, canned recipes, and project diagram fixtures in `examples/diagrams/`. `server/vendor/diagramify/` contains the vendored CLI, schemas, renderers, and upstream license.
- `generated/chat-library.spec.json` is derived from the client library and consumed by the server. `scripts/` contains generation and checks; `RUNBOOK.md` covers local operation; `docs/superpowers/{specs,plans}/` holds design notes and plans.

## Architecture Contract

The browser renderer and server prompt must use the same library. After any `src/library/` change, run `npm run gen:spec` and commit the refreshed spec; never hand-edit generated JSON. Keep canned recipes and prompt examples schema-valid. `npm run check:diagram` validates fixtures through the vendored CLI; preserve its license when updating vendor files.

## Build and Development

- Use Node 20+ and `npm install`; copy `.env.example` to `.env` for live model access. `npm run dev` starts Express on port 8787 and Vite on port 5173 (proxying `/api`).
- `npm run build` type-checks and creates the production bundle; `npm run preview` serves it locally.
- `npm run gen:spec` writes the generated library contract; `npm run check:spec` checks that it is current.

## Tests and Validation

This repository uses standalone scripts, not a test framework. `npm run check:recipe`, `npm run check:examples`, and `npm run check:diagram` validate recipes, prompt examples, and seven diagram fixtures; `npm run test:library` and `npm run test:layout` check component contracts and layout. For renderer geometry run `npx tsx scripts/test-diagram-render.mjs`; for server error handling run `node scripts/test-error-visibility.mjs`. Use `npm run build` for client or type changes. `node scripts/live-smoke.mjs [baseUrl] [prompt] [runs]` exercises a running server.

## Style, Commits, and Configuration

Use strict TypeScript, ESM imports, two-space indentation, double quotes, and semicolons. Use `PascalCase` for React/OpenUI components, `camelCase` for functions and variables, and `UPPER_SNAKE_CASE` for environment variables. No formatter or linter is configured.

Recent commits use short Conventional Commit-style subjects such as `feat(vendor): ...`, `fix(diagrams): ...`, `test(live): ...`, and `docs: ...`. PRs should explain behavior, list checks, link issues, and include screenshots for visual changes. Keep provider keys server-side; never commit `.env`. The demo has no authentication or persistent chat storage.

## Codebase Exploration & Analysis

This repository is indexed with CodeGraph (`.codegraph/`). Always use the CodeGraph MCP server (`codegraph_explore`) or the shell CLI (`codegraph explore "<query>"`) as the primary method to study, explore, and analyze the codebase architecture and symbols before falling back to manual file inspections or grep.
