import * as z from 'zod'
import { summariseSetlist } from '../services/setlistParser.js'
import { SETLIST_SUMMARY } from './getArtistSetlists.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_venue_setlists'

const GET_VENUE_SETLISTS_INPUT = z.object({
  venueId: z.string().min(1)
    .describe('Setlist.fm venue id, as returned by find_venues.'),
  page: z.number().int().min(1).max(20).default(1)
    .describe('Result page. setlist.fm returns 20 setlists per page, newest first.')
})

const GET_VENUE_SETLISTS_OUTPUT = z.object({
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  setlists: z.array(SETLIST_SUMMARY)
})

const CONFIG = {
  title: 'Get venue setlists',
  description: 'List every setlist.fm setlist recorded at a venue, newest first, one page at a time.',
  inputSchema: GET_VENUE_SETLISTS_INPUT,
  outputSchema: GET_VENUE_SETLISTS_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_venue_setlists tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetVenueSetlistsTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ venueId, page = 1 }) {
    try {
      const response = await setlistFm.getVenueSetlists(venueId, { page })
      const setlists = (response.setlist ?? []).map(summariseSetlist)
      const payload = { total: response.total ?? setlists.length, page: response.page ?? page, itemsPerPage: response.itemsPerPage ?? setlists.length, setlists }
      const summary = setlists.length === 0
        ? `No setlists found for venue ${venueId}.`
        : `${payload.total} setlist${payload.total === 1 ? '' : 's'}, page ${payload.page}:\n${setlists.map(s => `${s.eventDate}  ${s.artistName} - id ${s.id}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed for venueId ${venueId}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetVenueSetlistsTool, GET_VENUE_SETLISTS_INPUT, GET_VENUE_SETLISTS_OUTPUT, TOOL_NAME }
