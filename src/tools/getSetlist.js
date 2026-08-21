import * as z from 'zod'
import { detailSetlist } from '../services/setlistParser.js'
import { SETLIST_ID_PATTERN } from '../services/setlistFmClient.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'get_setlist'

const GET_SETLIST_INPUT = z.object({
  id: z.string().regex(SETLIST_ID_PATTERN)
    .describe('Setlist.fm setlist id, as returned in the id field by find_setlists, e.g. "6bd7ee5e".')
})

const GET_SETLIST_OUTPUT = z.object({
  id: z.string(),
  url: z.string().nullable(),
  eventDate: z.string().nullable(),
  lastUpdated: z.string().nullable(),
  artist: z.object({
    name: z.string(),
    mbid: z.string().nullable()
  }),
  venue: z.object({
    name: z.string(),
    city: z.string(),
    state: z.string().nullable(),
    country: z.string(),
    countryCode: z.string().nullable(),
    url: z.string().nullable()
  }),
  tour: z.string().nullable(),
  info: z.string().nullable(),
  songCount: z.number().int(),
  sets: z.array(z.object({
    setNumber: z.number().int(),
    name: z.string().nullable(),
    encore: z.number().int().nullable(),
    songs: z.array(z.object({
      position: z.number().int(),
      name: z.string(),
      tape: z.boolean(),
      cover: z.string().nullable(),
      with: z.string().nullable(),
      info: z.string().nullable()
    }))
  }))
})

const CONFIG = {
  title: 'Get setlist',
  description: [
    'Get the full detail of one setlist.fm setlist by its id, including every song in order,',
    'grouped into main sets and encores, with cover and guest-appearance notes.',
    'Get the id from find_setlists first.'
  ].join(' '),
  inputSchema: GET_SETLIST_INPUT,
  outputSchema: GET_SETLIST_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the get_setlist tool.
 *
 * @param {Object} deps
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildGetSetlistTool ({ setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler ({ id }) {
    try {
      const setlist = await setlistFm.getSetlist(id)
      const payload = detailSetlist(setlist)
      return textResult(summaryText(payload), payload)
    } catch (error) {
      if (error?.name === 'HttpError' && error.status === 404) {
        return errorResult(`No setlist on setlist.fm with id "${id}". Use find_setlists to get a valid id.`)
      }
      logger?.error(`${TOOL_NAME} failed for id ${id}: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

/**
 * Renders a setlist the way it would read on a gig poster: sets in order, encores
 * labelled, with cover and guest notes inline.
 *
 * @param {Object} payload - The detail shape.
 * @returns {string} A human-readable rendering.
 * @private
 */
function summaryText (payload) {
  const { artist, venue, eventDate, tour, sets, songCount, url, info } = payload
  const lines = [
    `${artist.name} - ${eventDate}`,
    `${venue.name}, ${venue.city}, ${venue.country}`,
    tour ? `Tour: ${tour}` : null,
    info || null,
    `${songCount} song${songCount === 1 ? '' : 's'}`,
    ''
  ].filter(line => line !== null)

  if (sets.length === 0) {
    lines.push('No songs have been recorded for this setlist.')
  }

  sets.forEach(set => {
    lines.push(set.encore !== null ? `Encore ${set.encore}` : (set.name || `Set ${set.setNumber}`))
    set.songs.forEach(song => {
      lines.push(`  ${song.position}. ${song.name}${songSuffix(song)}`)
    })
    lines.push('')
  })

  if (url) {
    lines.push(url)
  }

  return lines.join('\n')
}

/**
 * @param {Object} song - A song from the detail shape.
 * @returns {string} Parenthetical annotations, if any.
 * @private
 */
function songSuffix (song) {
  const parts = []
  if (song.tape) {
    parts.push('tape')
  }
  if (song.cover) {
    parts.push(`${song.cover} cover`)
  }
  if (song.with) {
    parts.push(`with ${song.with}`)
  }
  if (song.info) {
    parts.push(song.info)
  }
  return parts.length > 0 ? ` (${parts.join(', ')})` : ''
}

export { buildGetSetlistTool, GET_SETLIST_INPUT, GET_SETLIST_OUTPUT, TOOL_NAME }
