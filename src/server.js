import { readFileSync } from 'node:fs'
import path from 'node:path'
import { McpServer } from '@modelcontextprotocol/server'
import { createLogger, redirectConsoleLoggingToStderr } from './logger.js'
import { MusicBrainzClient } from './services/musicBrainzClient.js'
import { SetlistFmClient } from './services/setlistFmClient.js'
import { RateLimiter } from './services/rateLimiter.js'
import { TtlCache } from './services/cache.js'
import { buildFindSetlistsTool } from './tools/findSetlists.js'
import { buildGetSetlistTool } from './tools/getSetlist.js'
import { buildGetArtistTool } from './tools/getArtist.js'
import { buildFindArtistsTool } from './tools/findArtists.js'
import { buildGetArtistSetlistsTool } from './tools/getArtistSetlists.js'
import { buildGetVenueTool } from './tools/getVenue.js'
import { buildGetVenueSetlistsTool } from './tools/getVenueSetlists.js'
import { buildFindVenuesTool } from './tools/findVenues.js'
import { buildGetCityTool } from './tools/getCity.js'
import { buildFindCitiesTool } from './tools/findCities.js'
import { buildListCountriesTool } from './tools/listCountries.js'
import { buildGetSetlistVersionTool } from './tools/getSetlistVersion.js'
import { buildGetUserSetlistsTool } from './tools/getUserSetlists.js'

const SERVER_NAME = 'setlist-mcp'
const HOUR_MS = 3600000

// Deliberately conservative. setlist.fm publishes no rate limits, and community
// reports put the standard tier at roughly 2 requests/second and 1440/day. Slow is
// fine here; getting the key throttled is not.
const DEFAULTS = {
  setlistFmMinIntervalMs: 1100,
  setlistFmDailyLimit: 1300,
  musicBrainzMinIntervalMs: 1100,
  timeoutMs: 10000,
  maxAttempts: 4
}

/**
 * Reads this server's version from package.json rather than repeating it here.
 * Resolved against this file, since an MCP client spawns the server from anywhere.
 *
 * @returns {string} The package version.
 */
function readVersion () {
  const packagePath = path.resolve(import.meta.dirname, '..', 'package.json')
  return JSON.parse(readFileSync(packagePath, 'utf8')).version
}

/**
 * Builds everything the tools need.
 *
 * Call this ONCE, outside the serveStdio factory. serveStdio invokes its factory per
 * connection, so building rate limiters in there would reset them on every client
 * reconnect and quietly double the outbound request rate - the exact failure the
 * limiter exists to prevent.
 *
 * @param {Object} [env=process.env] - Environment to read configuration from.
 * @returns {Promise<Object>} Dependencies for createServer.
 */
async function createDependencies (env = process.env) {
  const version = readVersion()
  const logger = redirectConsoleLoggingToStderr(await createLogger(env.NODE_ENV))

  const setlistFmLimiter = new RateLimiter({
    name: 'setlist.fm',
    logger,
    minIntervalMs: numberFrom(env.SETLISTFM_MIN_INTERVAL_MS, DEFAULTS.setlistFmMinIntervalMs),
    dailyLimit: numberFrom(env.SETLISTFM_DAILY_LIMIT, DEFAULTS.setlistFmDailyLimit)
  })
  const musicBrainzLimiter = new RateLimiter({
    name: 'musicbrainz',
    logger,
    minIntervalMs: numberFrom(env.MUSICBRAINZ_MIN_INTERVAL_MS, DEFAULTS.musicBrainzMinIntervalMs),
    // MusicBrainz publishes no daily cap, only a per-second one.
    dailyLimit: null
  })

  const timeoutMs = numberFrom(env.HTTP_TIMEOUT_MS, DEFAULTS.timeoutMs)
  const maxAttempts = numberFrom(env.HTTP_MAX_ATTEMPTS, DEFAULTS.maxAttempts)

  const musicBrainz = new MusicBrainzClient(logger, {
    limiter: musicBrainzLimiter,
    cache: new TtlCache({ ttlMs: 24 * HOUR_MS }),
    contact: env.MUSICBRAINZ_CONTACT,
    version,
    timeoutMs,
    maxAttempts
  })

  const setlistFm = new SetlistFmClient(logger, {
    limiter: setlistFmLimiter,
    searchCache: new TtlCache({ ttlMs: HOUR_MS }),
    detailCache: new TtlCache({ ttlMs: 6 * HOUR_MS }),
    // The country list is effectively static, so it's worth caching far longer than
    // anything else here.
    countriesCache: new TtlCache({ ttlMs: 7 * 24 * HOUR_MS }),
    apiKey: env.SETLISTFM_API_KEY,
    timeoutMs,
    maxAttempts
  })

  if (!env.SETLISTFM_API_KEY) {
    logger.warn('SETLISTFM_API_KEY is not set. The server will start and list its tools, but every search will fail until a key is configured in .env.')
  }

  return { logger, version, musicBrainz, setlistFm, limiters: { setlistFmLimiter, musicBrainzLimiter } }
}

/**
 * Builds an McpServer with both tools registered.
 *
 * @param {Object} deps - The result of createDependencies.
 * @returns {McpServer} A server ready to connect to a transport.
 */
function createServer (deps) {
  const server = new McpServer({ name: SERVER_NAME, version: deps.version })

  const tools = [
    buildFindSetlistsTool(deps),
    buildGetSetlistTool(deps),
    buildGetArtistTool(deps),
    buildFindArtistsTool(deps),
    buildGetArtistSetlistsTool(deps),
    buildGetVenueTool(deps),
    buildGetVenueSetlistsTool(deps),
    buildFindVenuesTool(deps),
    buildGetCityTool(deps),
    buildFindCitiesTool(deps),
    buildListCountriesTool(deps),
    buildGetSetlistVersionTool(deps),
    buildGetUserSetlistsTool(deps)
  ]
  tools.forEach(tool => server.registerTool(tool.name, tool.config, tool.handler))

  return server
}

/**
 * @param {string|undefined} value - Raw environment value.
 * @param {number} fallback - Value to use when unset or unparseable.
 * @returns {number} The parsed number, or the fallback.
 * @private
 */
function numberFrom (value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback
}

export { createDependencies, createServer, readVersion, SERVER_NAME }
