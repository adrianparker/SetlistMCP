import * as z from 'zod'
import { mapArtist } from '../services/entityParser.js'
import { ARTIST_OUTPUT } from './getArtist.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'find_artists'

const FIND_ARTISTS_INPUT = z.object({
  artistName: z.string().optional()
    .describe('Artist name to search for, e.g. "The Cure". Give this or artistMbid.'),
  artistMbid: z.string().optional()
    .describe('A known MusicBrainz artist id to look up directly.'),
  sort: z.enum(['sortName', 'relevance']).optional()
    .describe('Result order: "sortName" (default) or "relevance".'),
  page: z.number().int().min(1).max(20).default(1)
    .describe('Result page.')
}).refine(args => args.artistName || args.artistMbid, {
  message: 'Provide artistName or artistMbid'
})

const FIND_ARTISTS_OUTPUT = z.object({
  total: z.number().int(),
  page: z.number().int(),
  itemsPerPage: z.number().int(),
  artists: z.array(ARTIST_OUTPUT)
})

const CONFIG = {
  title: 'Find artists',
  description: [
    'Search setlist.fm\'s own artist directory by name or MusicBrainz id.',
    'Distinct from find_setlists\' artist resolution (which goes through MusicBrainz): use this',
    'to browse setlist.fm\'s directory directly, or to disambiguate between same-named artists',
    'before calling get_artist_setlists.'
  ].join(' '),
  inputSchema: FIND_ARTISTS_INPUT,
  outputSchema: FIND_ARTISTS_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the find_artists tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildFindArtistsTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ artistName, artistMbid, sort, page = 1 }) {
    try {
      const response = await setlistFm.searchArtists({ artistName, artistMbid, sort, page })
      const artists = (response.artist ?? []).map(mapArtist)
      const payload = { total: response.total ?? artists.length, page: response.page ?? page, itemsPerPage: response.itemsPerPage ?? artists.length, artists }
      const summary = artists.length === 0
        ? `No artists found matching "${artistName ?? artistMbid}".`
        : `${payload.total} artist${payload.total === 1 ? '' : 's'} found:\n${artists.map(a => `${a.name}${a.disambiguation ? ` (${a.disambiguation})` : ''} - ${a.mbid}`).join('\n')}`
      return textResult(summary, payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

export { buildFindArtistsTool, FIND_ARTISTS_INPUT, FIND_ARTISTS_OUTPUT, TOOL_NAME }
