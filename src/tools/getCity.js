import * as z from 'zod'
import { mapCity } from '../services/entityParser.js'
import { CITY_OUTPUT } from './getVenue.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_city'

const GET_CITY_INPUT = z.object({
  geoId: z.string().min(1)
    .describe('Setlist.fm city geoId, as returned by find_cities.')
})

const CONFIG = {
  title: 'Get city',
  description: 'Get setlist.fm\'s record for one city by geoId: name, state and country.',
  inputSchema: GET_CITY_INPUT,
  outputSchema: CITY_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_city tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetCityTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ geoId }) {
    try {
      const city = mapCity(await setlistFm.getCity(geoId))
      const summary = [city.name, city.state, city.country].filter(Boolean).join(', ')
      return textResult(summary, city)
    } catch (error) {
      if (error?.name === 'HttpError' && error.status === 404) {
        return errorResult(`No city on setlist.fm with geoId "${geoId}". Use find_cities to get a valid id.`)
      }
      logger?.error(`${TOOL_NAME} failed for geoId ${geoId}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetCityTool, GET_CITY_INPUT, TOOL_NAME }
