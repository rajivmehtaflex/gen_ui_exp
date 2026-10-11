# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the Vite/React client. `src/App.tsx` mounts OpenUI’s chat shell; `src/library/chat-library.ts` defines the shared component library and model prompt guidance.
- `src/library/diagrams/` holds diagram schemas, React renderers, and pure layout helpers. Keep layout math separate from React where practical.
- `server/` contains the Express chat endpoint and canned OpenUI recipes. `generated/chat-library.spec.json` is derived from the client library and consumed by the server.
- `scripts/` contains spec generation, recipe/example validators, layout and library checks, and live smoke utilities. `RUNBOOK.md` documents local operation; `PLAN-STAGE1-DIAGRAMS.md` records the diagram work.

## Architecture Contract

The browser renderer and server prompt must use the same component library. After changing `src/library/`, run `npm run gen:spec`; commit the refreshed generated spec with the source. Never hand-edit the generated JSON. Keep recipe examples and canned recipes valid against the current schema.

## Build, Test, and Development Commands

- `npm install` installs dependencies; `npm run dev` starts Express and Vite together (Vite serves port 5173 and proxies `/api` to port 8787).
- `npm run build` runs TypeScript checks and creates the production bundle; `npm run preview` serves that bundle locally.
- `npm run gen:spec` refreshes the server library spec; `npm run check:spec` detects stale output.
- `npm run check:recipe` and `npm run check:examples` validate canned recipes and prompt examples.
- `npm run test:library` checks component signatures and parser contracts; `npm run test:layout` checks diagram layout behavior. Run `node scripts/test-error-visibility.mjs` for server error handling.

## Coding Style & Naming

Use strict TypeScript, ESM imports, two-space indentation, double quotes, and semicolons, matching nearby files. Name React components and OpenUI components in `PascalCase`, functions and variables in `camelCase`, and environment variables in `UPPER_SNAKE_CASE`. There is no configured formatter or linter script; keep changes consistent with adjacent code.

## Testing Guidelines

Checks are standalone Node/tsx scripts rather than a test framework. Run the checks relevant to changed code, plus `npm run build` for client or type changes. For library or prompt edits, regenerate the spec and run both schema validators.

## Commits, Pull Requests, and Configuration

Recent history uses short Conventional Commit-style subjects such as `feat(diagrams): ...`, `test(live): ...`, and `docs: ...`. PRs should explain user-visible behavior, list checks run, link related issues when applicable, and include screenshots for visual changes. Copy `.env.example` to `.env`; keep provider keys server-side and never commit `.env`. This demo has no authentication or persistent chat storage.
