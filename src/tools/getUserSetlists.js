import * as z from 'zod'
import { summariseSetlist } from '../services/setlistParser.js'
import { SETLIST_SUMMARY } from './getArtistSetlists.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_user_setlists'

const GET_USER_SETLISTS_INPUT = z.object({
  userId: z.string().min(1)
    .describe('A setlist.fm userId, as it appears in that user\'s profile URL.'),
  kind: z.enum(['attended', 'edited'])
    .describe('"attended" for gigs the user logged as attended, "edited" for setlists they have edited (returns the current version, not the version they edited).'),
  page: z.number().int().min(1).max(20).default(1)
    .describe('Result page. setlist.fm returns 20 setlists per page, newest first.')
})

const GET_USER_SETLISTS_OUTPUT = z.object({
  userId: z.string(),
  kind: z.enum(['attended', 'edited']),
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  setlists: z.array(SETLIST_SUMMARY)
})

const CONFIG = {
  title: 'Get user setlists',
  description: 'List the gigs a setlist.fm user has logged as attended, or the setlists they\'ve edited, newest first.',
  inputSchema: GET_USER_SETLISTS_INPUT,
  outputSchema: GET_USER_SETLISTS_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_user_setlists tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetUserSetlistsTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ userId, kind, page = 1 }) {
    try {
      const response = kind === 'attended'
        ? await setlistFm.getUserAttended(userId, { page })
        : await setlistFm.getUserEdited(userId, { page })
      const setlists = (response.setlist ?? []).map(summariseSetlist)
      const payload = {
        userId,
        kind,
        total: response.total ?? setlists.length,
        page: response.page ?? page,
        itemsPerPage: response.itemsPerPage ?? setlists.length,
        setlists
      }
      const summary = setlists.length === 0
        ? `No ${kind} setlists found for user ${userId}.`
        : `${payload.total} ${kind} setlist${payload.total === 1 ? '' : 's'} for ${userId}, page ${payload.page}:\n${setlists.map(s => `${s.eventDate}  ${s.artistName} - ${s.venue}, ${s.city} - id ${s.id}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed for userId ${userId}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildGetUserSetlistsTool, GET_USER_SETLISTS_INPUT, GET_USER_SETLISTS_OUTPUT, TOOL_NAME }
