# setlist-mcp

An MCP server that lets Claude find setlist.fm setlists for gigs you've been to.

Ask "I saw The Cure in Wellington in August 1992 — what did they play?" and Claude
resolves the artist, searches setlist.fm, and reads back the songs in order.

## Features

- **`find_setlists`** — search by artist, city and date. Returns a compact list of
  matching gigs with their setlist IDs, venues and song counts.
- **`get_setlist`** — fetch one setlist in full: every song in order, grouped into
  sets and encores, with cover and guest-appearance notes.
- **Forgiving about dates.** Searching covers the year around the date you give and
  ranks results by how close they are, so a misremembered day still finds the gig.
- **Forgiving about artist names.** Names resolve through MusicBrainz, so minor
  misspellings usually still work. Ambiguous names come back with alternatives.
- **Careful with rate limits.** Requests are serialised and spaced out, 429s are
  retried with backoff, and responses are cached. Searches take a few seconds by
  design.

## Installation

```
git clone git@github.com:adrianparker/setlist-mcp.git
cd setlist-mcp
npm install
cp .env.example .env
```

Then edit `.env` and set `SETLISTFM_API_KEY`. Request a key at
[setlist.fm's API settings](https://www.setlist.fm/settings/api) — it's free, and
requires a setlist.fm account.

Setting `MUSICBRAINZ_CONTACT` to your email address is good manners: MusicBrainz
asks that clients identify a contact in their User-Agent, and throttles
anonymous-looking clients harder.

## Registering with Claude Code

```
claude mcp add setlist-mcp --scope user -- node /full/path/to/setlist-mcp/src/index.js
```

Or add it to a project's `.mcp.json`:

```json
{
  "mcpServers": {
    "setlist-mcp": {
      "command": "node",
      "args": ["/full/path/to/setlist-mcp/src/index.js"]
    }
  }
}
```

No secrets go in the client config — the server reads `.env` from its own directory,
so it works whatever directory the client launches it from.

Restart Claude Code, then check it connected with `/mcp`.

## Usage

Once registered, just ask in plain English:

> I saw Villainy in Tauranga in March 2026, what was the setlist?

Claude will call `find_setlists`, pick the matching gig, then call `get_setlist`.

To check the server directly without a client:

```
npx @modelcontextprotocol/inspector node src/index.js
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SETLISTFM_API_KEY` | — | **Required.** Your setlist.fm API key. |
| `MUSICBRAINZ_CONTACT` | repo URL | Contact detail sent to MusicBrainz in the User-Agent. |
| `NODE_ENV` | `app` | Which `src/config/<env>.json` the logger loads. |
| `SETLISTFM_MIN_INTERVAL_MS` | `1100` | Minimum gap between setlist.fm requests. |
| `SETLISTFM_DAILY_LIMIT` | `1300` | Per-process request budget for setlist.fm. |
| `MUSICBRAINZ_MIN_INTERVAL_MS` | `1100` | Minimum gap between MusicBrainz requests. |
| `HTTP_TIMEOUT_MS` | `10000` | Per-request timeout. |

## Rate limiting

setlist.fm doesn't publish its rate limits. Community reports put the standard tier
at roughly 2 requests per second and 1440 per day, so the defaults here — one request
every 1.1 seconds — sit comfortably inside the slower end of that. Requests are
serialised through a queue, so concurrent tool calls wait their turn rather than
bursting. A 429 backs off the whole queue, honouring `Retry-After` when the server
sends one.

**The daily limit is not a real daily quota.** It's held in memory, so it resets
whenever the MCP client restarts the server. Treat it as a circuit breaker against a
runaway loop, not as compliance. The minimum interval is what actually protects your
key: at 1.1s per request, reaching 1440 requests would take 26 minutes of continuous
querying.

Responses are cached in memory — artists for 24 hours, searches for 1 hour, setlist
detail for 6 hours — so repeated questions about the same gig cost nothing.

## Development

### Run tests

```
npm test
npm run test:watch
```

No test touches the real APIs: `test/setup.js` installs a `global.fetch` that throws,
and tests stub it explicitly.

### Coverage

```
npm run coverage
```

### Lint

```
npm run lint
```

## A note on setlist.fm

The setlist.fm API is free for non-commercial use only — see their
[API terms](https://www.setlist.fm/help/api-terms). Both tools return the setlist.fm
URL for every result so it can be linked back to.

Setlist data is contributed by setlist.fm's users. Gigs may be missing, incomplete,
or have the wrong date.

## License

MIT
