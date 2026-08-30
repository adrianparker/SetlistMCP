import * as z from 'zod'
import { summariseSetlist } from '../services/setlistParser.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_artist_setlists'

const GET_ARTIST_SETLISTS_INPUT = z.object({
  artistMbid: z.string().min(1)
    .describe('MusicBrainz artist id, as returned by find_setlists or find_artists.'),
  page: z.number().int().min(1).max(20).default(1)
    .describe('Result page. setlist.fm returns 20 setlists per page, newest first.')
})

const SETLIST_SUMMARY = z.object({
  id: z.string(),
  eventDate: z.string().nullable(),
  artistName: z.string(),
  venue: z.string(),
  city: z.string(),
  state: z.string().nullable(),
  country: z.string(),
  countryCode: z.string().nullable(),
  tour: z.string().nullable(),
  songCount: z.number().int(),
  url: z.string().nullable()
})

const GET_ARTIST_SETLISTS_OUTPUT = z.object({
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  setlists: z.array(SETLIST_SUMMARY)
})

const CONFIG = {
  title: 'Get artist setlists',
  description: [
    'List every setlist.fm setlist for an artist, newest first, one page at a time.',
    'Prefer find_setlists when looking for a specific gig - it can narrow by city and date.',
    'Use this to browse an artist\'s history, or when find_setlists reports more results than fit on one page.'
  ].join(' '),
  inputSchema: GET_ARTIST_SETLISTS_INPUT,
  outputSchema: GET_ARTIST_SETLISTS_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_artist_setlists tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetArtistSetlistsTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ artistMbid, page = 1 }) {
    try {
      const response = await setlistFm.getArtistSetlists(artistMbid, { page })
      const setlists = (response.setlist ?? []).map(summariseSetlist)
      const payload = { total: response.total ?? setlists.length, page: response.page ?? page, itemsPerPage: response.itemsPerPage ?? setlists.length, setlists }
      const summary = setlists.length === 0
        ? `No setlists found for artist ${artistMbid}.`
        : `${payload.total} setlist${payload.total === 1 ? '' : 's'}, page ${payload.page}:\n${setlists.map(s => `${s.eventDate}  ${s.venue}, ${s.city} - id ${s.id}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed for mbid ${artistMbid}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetArtistSetlistsTool, GET_ARTIST_SETLISTS_INPUT, GET_ARTIST_SETLISTS_OUTPUT, SETLIST_SUMMARY, TOOL_NAME }
