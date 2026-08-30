import * as z from 'zod'
import { mapCountry } from '../services/entityParser.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'list_countries'

const LIST_COUNTRIES_INPUT = z.object({})

const LIST_COUNTRIES_OUTPUT = z.object({
  total: z.number().int(),
  countries: z.array(z.object({
    code: z.string().nullable(),
    name: z.string()
  }))
})

const CONFIG = {
  title: 'List countries',
  description: 'List every country setlist.fm supports, with its ISO country code - useful for looking up the countryCode a search wants.',
  inputSchema: LIST_COUNTRIES_INPUT,
  outputSchema: LIST_COUNTRIES_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the list_countries tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildListCountriesTool ({ setlistFm, logger }) {
  /**
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler () {
    try {
      const response = await setlistFm.searchCountries()
      const countries = (response.country ?? []).map(mapCountry)
      const payload = { total: countries.length, countries }
      const summary = `${countries.length} countries: ${countries.map(c => `${c.name} (${c.code})`).join(', ')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildListCountriesTool, LIST_COUNTRIES_INPUT, LIST_COUNTRIES_OUTPUT, TOOL_NAME }
