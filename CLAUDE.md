# setlist-mcp

MCP server for setlist data

This file is the standing context for Claude Code sessions in this repo —
keep it current as the project evolves instead of letting a README/context
file drift out of sync.

## Stack

- Node.js (ESM, `"type": "module"`), no bundler/TS build step for app code
- Mocha + Chai + Sinon for tests
- ESLint (`neostandard`) for linting
- npm (not yarn/pnpm)

## Conventions

- Source lives in `src/`; tests live in `test/`, mirroring `src/` structure,
  named `<file>.test.js`
- Env config via `dotenv` + `.env` (gitignored) / `.env.example` (committed,
  no real values)
- Logging via the `winston` wrapper, if present
- Keep the scaffold minimal — no database/ORM/web framework unless the
  project actually needs one

## Commands

- `npm start` — run the app
- `npm test` / `npm run test:watch` — run tests
- `npm run coverage` — run tests with `c8` coverage measurement
- `npm run lint` — lint
