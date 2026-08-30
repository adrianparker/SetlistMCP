import * as z from 'zod'
import { mapCity } from '../services/entityParser.js'
import { CITY_OUTPUT } from './getVenue.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'find_cities'

const FIND_CITIES_INPUT = z.object({
  name: z.string().optional().describe('City name.'),
  country: z.string().optional().describe('Country name.'),
  state: z.string().optional().describe('State name.'),
  stateCode: z.string().optional().describe('State code.'),
  page: z.number().int().min(1).max(20).default(1).describe('Result page.')
})

const FIND_CITIES_OUTPUT = z.object({
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  cities: z.array(CITY_OUTPUT)
})

const CONFIG = {
  title: 'Find cities',
  description: [
    'Search setlist.fm\'s city directory by name and/or location - useful for disambiguating',
    'a city name that exists in several countries before using its geoId elsewhere.'
  ].join(' '),
  inputSchema: FIND_CITIES_INPUT,
  outputSchema: FIND_CITIES_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the find_cities tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildFindCitiesTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ name, country, state, stateCode, page = 1 }) {
    try {
      const response = await setlistFm.searchCities({ name, country, state, stateCode, page })
      const cities = (response.cities ?? []).map(mapCity)
      const payload = { total: response.total ?? cities.length, page: response.page ?? page, itemsPerPage: response.itemsPerPage ?? cities.length, cities }
      const summary = cities.length === 0
        ? 'No cities found matching that search.'
        : `${payload.total} cit${payload.total === 1 ? 'y' : 'ies'} found:\n${cities.map(c => `${c.name}, ${c.state ? `${c.state}, ` : ''}${c.country} - ${c.id}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildFindCitiesTool, FIND_CITIES_INPUT, FIND_CITIES_OUTPUT, TOOL_NAME }
