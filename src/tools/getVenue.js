import * as z from 'zod'
import { mapVenue } from '../services/entityParser.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_venue'

const GET_VENUE_INPUT = z.object({
  venueId: z.string().min(1)
    .describe('Setlist.fm venue id, as returned by find_venues.')
})

const CITY_OUTPUT = z.object({
  id: z.string().nullable(),
  name: z.string(),
  state: z.string().nullable(),
  stateCode: z.string().nullable(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  lat: z.number().nullable(),
  long: z.number().nullable()
})

const VENUE_OUTPUT = z.object({
  id: z.string().nullable(),
  name: z.string(),
  url: z.string().nullable(),
  city: CITY_OUTPUT.nullable()
})

const CONFIG = {
  title: 'Get venue',
  description: 'Get setlist.fm\'s record for one venue by id: name and the city it\'s in.',
  inputSchema: GET_VENUE_INPUT,
  outputSchema: VENUE_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_venue tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetVenueTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ venueId }) {
    try {
      const venue = mapVenue(await setlistFm.getVenue(venueId))
      const summary = `${venue.name}${venue.city ? `, ${venue.city.name}, ${venue.city.country}` : ''}`
      return textResult(summary, venue)
    } catch (error) {
      if (error?.name === 'HttpError' && error.status === 404) {
        return errorResult(`No venue on setlist.fm with id "${venueId}". Use find_venues to get a valid id.`)
      }
      logger?.error(`${TOOL_NAME} failed for venueId ${venueId}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetVenueTool, CITY_OUTPUT, GET_VENUE_INPUT, TOOL_NAME, VENUE_OUTPUT }
