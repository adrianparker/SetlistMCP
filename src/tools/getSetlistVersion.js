import * as z from 'zod'
import { detailSetlist } from '../services/setlistParser.js'
import { SETLIST_ID_PATTERN } from '../services/setlistFmClient.js'
import { GET_SETLIST_OUTPUT } from './getSetlist.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_setlist_version'

const GET_SETLIST_VERSION_INPUT = z.object({
  versionId: z.string().regex(SETLIST_ID_PATTERN)
    .describe('Setlist.fm setlist version id - a specific historical edit of a setlist, as shown in that setlist\'s edit history on setlist.fm.')
})

const CONFIG = {
  title: 'Get setlist version',
  description: [
    'Get one specific historical edit of a setlist by its version id, exactly like get_setlist',
    'but for a past version rather than the current one. Setlists get corrected over time,',
    'so this is useful when comparing what changed.'
  ].join(' '),
  inputSchema: GET_SETLIST_VERSION_INPUT,
  outputSchema: GET_SETLIST_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_setlist_version tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetSetlistVersionTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ versionId }) {
    try {
      const setlist = await setlistFm.getSetlistVersion(versionId)
      const payload = detailSetlist(setlist)
      return textResult(`${payload.artist.name} - ${payload.eventDate} (version ${versionId})`, payload)
    } catch (error) {
      if (error?.name === 'HttpError' && error.status === 404) {
        return errorResult(`No setlist version on setlist.fm with id "${versionId}".`)
      }
      logger?.error(`${TOOL_NAME} failed for versionId ${versionId}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetSetlistVersionTool, GET_SETLIST_VERSION_INPUT, TOOL_NAME }
