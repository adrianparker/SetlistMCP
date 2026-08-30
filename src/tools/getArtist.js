import * as z from 'zod'
import { mapArtist } from '../services/entityParser.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_artist'

const GET_ARTIST_INPUT = z.object({
  artistMbid: z.string().min(1)
    .describe('MusicBrainz artist id, as returned by find_setlists or find_artists.')
})

const ARTIST_OUTPUT = z.object({
  mbid: z.string().nullable(),
  name: z.string(),
  sortName: z.string().nullable(),
  disambiguation: z.string().nullable(),
  url: z.string().nullable()
})

const CONFIG = {
  title: 'Get artist',
  description: 'Get setlist.fm\'s record for one artist by MusicBrainz id: name, sort name and any disambiguation note.',
  inputSchema: GET_ARTIST_INPUT,
  outputSchema: ARTIST_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_artist tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetArtistTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ artistMbid }) {
    try {
      const artist = mapArtist(await setlistFm.getArtist(artistMbid))
      const summary = [artist.name, artist.disambiguation ? `(${artist.disambiguation})` : null]
        .filter(Boolean).join(' ')
      return textResult(summary, artist)
    } catch (error) {
      if (error?.name === 'HttpError' && error.status === 404) {
        return errorResult(`No artist on setlist.fm with MusicBrainz id "${artistMbid}".`)
      }
      logger?.error(`${TOOL_NAME} failed for mbid ${artistMbid}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { ARTIST_OUTPUT, buildGetArtistTool, GET_ARTIST_INPUT, TOOL_NAME }
