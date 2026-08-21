# setlist-mcp

An MCP server exposing setlist.fm search to Claude, for looking up setlists from gigs
Adrian has been to.

This file is the standing context for Claude Code sessions in this repo — keep it
current as the project evolves instead of letting it drift out of sync.

## The rule that breaks everything if forgotten

**stdout is the JSON-RPC channel.** This server speaks MCP over stdio, and the host
parses every line of stdout as a protocol message. One stray line — from your code or
from a dependency — breaks the connection, and the symptom is an unhelpful
`SyntaxError` from the host quoting the offending character.

So:

- **Never `console.log` in `src/`.** Use the injected logger, or `console.error`.
- The winston console transport is configured with `stderrLevels` covering every
  level (see `src/logger.js`), driven by `consoleToStderr` in `src/config/*.json`.
  Don't remove that.
- `dotenv.config()` must keep `quiet: true` — dotenv prints an "injected env" banner
  to stdout otherwise. This is verified: it writes 76 bytes to stdout, 0 to stderr.
- Paths resolve against `import.meta.dirname`, never the cwd. An MCP client spawns
  the server from its own working directory.

## Stack

- Node.js 22+ (ESM, `"type": "module"`), no bundler or TS build step
- `@modelcontextprotocol/server` v2 (pinned to 2.0.0) + zod v4 for schemas
- Mocha + Chai + Sinon for tests, c8 for coverage
- ESLint (`neostandard`) — **no semicolons**
- npm (not yarn/pnpm)

## Architecture

```
src/index.js          entry point: dotenv, serveStdio, signals
src/server.js         createDependencies() + createServer()
src/tools/            one module per tool, plus shared result helpers
src/services/         API clients and the primitives they sit on
```

`createDependencies()` is called **once, outside** the `serveStdio` factory.
`serveStdio` invokes its factory per connection, so building rate limiters inside it
would reset them on every client reconnect and double the outbound request rate.

Tools are factory functions returning `{ name, config, handler }`. That keeps each
handler a plain async function with injected dependencies, so tests drive it directly
with stubbed clients and `server.js` stays pure wiring.

## Conventions

- Source in `src/`, tests in `test/` mirroring it, named `<file>.test.js`
- Service classes take a **logger as their first constructor argument**; everything
  else arrives in an options object
- Named exports only, no default exports
- JSDoc on exported functions and non-obvious private ones
- Errors are typed (`src/services/errors.js`) so the tool layer can map them to
  model-facing text without matching on message strings
- Tool handlers return `isError` results rather than throwing — a thrown error gives
  the model nothing to act on
- "Nothing found" is a **successful empty result**, not an error. Otherwise the model
  reads a legitimate miss as a broken tool and retries
- API keys are validated lazily, inside the request path — never in a constructor, or
  the server can't start to tell you the key is missing

## Rate limiting

The `RateLimiter` serialises requests through a promise chain and spaces them by a
minimum interval. Two details are load-bearing:

- Re-chaining on a **settled** promise, so a rejected task can't wedge the queue
- Tracking **next allowed at** rather than last started at, so `penalise()` backs off
  the whole queue after a 429 rather than only the request that received it

`now` and `sleep` are constructor-injected. Tests assert on the *decision* to wait by
inspecting `sleep`'s arguments — never add a test that actually sleeps.

## Testing

- `sinon.stub(global, 'fetch')` in `beforeEach`, `.restore()` in `afterEach`
- Inline object-literal response fakes; no fixtures directory, no nock
- Async errors via try/catch + `expect.fail('Should have thrown an error')`
- `test/setup.js` installs a `global.fetch` that throws, so no test can reach the real
  APIs by accident
- `test/server.test.js` drives the real server over `InMemoryTransport` — it's the
  only test covering zod→JSON Schema conversion and `outputSchema` validation of
  `structuredContent`. Tool tests also `parse()` their structured output against the
  declared schema, which is what catches schema/shaping drift

## Date handling

setlist.fm speaks `dd-MM-yyyy`; everything else here speaks ISO `yyyy-MM-dd`.
Conversion happens only at the client boundary. A model reading `13-08-1992` as
ISO-ish gets the date silently wrong, so nothing in that format escapes the client.

All date arithmetic goes through `Date.UTC` — from NZ, a local-time parse is a
guaranteed off-by-one.

## Gotchas found the hard way

- MusicBrainz JSON uses **`sort-name`**, hyphenated, not `sortName`
- MusicBrainz omits `disambiguation` entirely when unset, rather than nulling it
- MusicBrainz signals throttling with **503**, not 429
- setlist.fm returns **404 when a search matches nothing**, not an empty collection.
  A 404 from `/setlist/{id}` is a real not-found and still throws
- setlist.fm's JSON is XML-derived: a set with one song arrives as a bare object where
  a set with two arrives as an array. `setlistParser.js` handles both — don't
  "simplify" that away

## Commands

- `npm start` — run the server on stdio (usually you want a client to do this)
- `npm test` / `npm run test:watch` — run tests
- `npm run coverage` — tests with c8 coverage
- `npm run lint` — lint
- `npx @modelcontextprotocol/inspector node src/index.js` — drive the tools by hand
