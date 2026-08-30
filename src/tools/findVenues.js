import * as z from 'zod'
import { mapVenue } from '../services/entityParser.js'
import { VENUE_OUTPUT } from './getVenue.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'find_venues'

const FIND_VENUES_INPUT = z.object({
  name: z.string().optional().describe('Venue name, e.g. "Town Hall".'),
  cityName: z.string().optional().describe('City the venue is in.'),
  cityId: z.string().optional().describe('City geoId, from find_cities.'),
  country: z.string().optional().describe('Country name.'),
  state: z.string().optional().describe('State name.'),
  stateCode: z.string().optional().describe('State code.'),
  page: z.number().int().min(1).max(20).default(1).describe('Result page.')
})

const FIND_VENUES_OUTPUT = z.object({
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  venues: z.array(VENUE_OUTPUT)
})

const CONFIG = {
  title: 'Find venues',
  description: [
    'Search setlist.fm\'s venue directory by name and/or location.',
    'Use the returned id with get_venue_setlists to see what has been played there.'
  ].join(' '),
  inputSchema: FIND_VENUES_INPUT,
  outputSchema: FIND_VENUES_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the find_venues tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildFindVenuesTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ name, cityName, cityId, country, state, stateCode, page = 1 }) {
    try {
      const response = await setlistFm.searchVenues({ name, cityName, cityId, country, state, stateCode, page })
      const venues = (response.venue ?? []).map(mapVenue)
      const payload = { total: response.total ?? venues.length, page: response.page ?? page, itemsPerPage: response.itemsPerPage ?? venues.length, venues }
      const summary = venues.length === 0
        ? 'No venues found matching that search.'
        : `${payload.total} venue${payload.total === 1 ? '' : 's'} found:\n${venues.map(v => `${v.name}${v.city ? `, ${v.city.name}` : ''} - ${v.id}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildFindVenuesTool, FIND_VENUES_INPUT, FIND_VENUES_OUTPUT, TOOL_NAME }
