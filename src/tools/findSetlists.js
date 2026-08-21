import * as z from 'zod'
import { daysBetween, yearOf } from '../services/dates.js'
import { summariseSetlist } from '../services/setlistParser.js'
import { describeError, errorResult, textResult } from './toolResult.js'

const TOOL_NAME = 'find_setlists'

const FIND_SETLISTS_INPUT = z.object({
  artist: z.string().min(1)
    .describe('Artist or band name as it appears on the ticket, e.g. "The Cure". Resolved through MusicBrainz, so minor misspellings usually still work.'),
  artistMbid: z.string().optional()
    .describe('A MusicBrainz artist ID already known from a previous call. Supplying it skips the artist lookup and saves a request.'),
  city: z.string().optional()
    .describe('City the gig was in, e.g. "Wellington". Strongly recommended - it is the main way to narrow results.'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('Date of the gig in ISO format yyyy-MM-dd, e.g. "1992-08-13". The search covers the surrounding year and ranks by closeness to this date, so an approximate date still works.'),
  year: z.number().int().min(1900).max(2100).optional()
    .describe('Year of the gig. Use instead of date when the exact day is not remembered. Ignored when date is given.'),
  countryCode: z.string().length(2).optional()
    .describe('ISO 3166-1 alpha-2 country code, e.g. "NZ". Use to disambiguate city names that exist in several countries.'),
  page: z.number().int().min(1).max(20).default(1)
    .describe('Result page. Only needed when a search reports more results than it returned.')
})

const ARTIST_SHAPE = z.object({
  name: z.string(),
  mbid: z.string(),
  disambiguation: z.string().nullable(),
  alternatives: z.array(z.object({
    name: z.string(),
    mbid: z.string(),
    disambiguation: z.string().nullable(),
    score: z.number().nullable()
  }))
}).nullable()

const FIND_SETLISTS_OUTPUT = z.object({
  artist: ARTIST_SHAPE,
  query: z.object({
    artist: z.string(),
    city: z.string().nullable(),
    date: z.string().nullable(),
    year: z.number().nullable(),
    broadened: z.boolean()
  }),
  total: z.number().int(),
  page: z.number().int(),
  count: z.number().int(),
  setlists: z.array(z.object({
    id: z.string(),
    eventDate: z.string().nullable(),
    artistName: z.string(),
    venue: z.string(),
    city: z.string(),
    state: z.string().nullable(),
    country: z.string(),
    countryCode: z.string().nullable(),
    tour: z.string().nullable(),
    songCount: z.number().int(),
    exactDateMatch: z.boolean(),
    daysFromRequestedDate: z.number().int().nullable(),
    url: z.string().nullable()
  })),
  note: z.string().nullable()
})

const CONFIG = {
  title: 'Find setlists',
  description: [
    'Find setlist.fm setlists for a gig, given an artist and optionally the city and date.',
    'Use this first when someone asks what songs were played at a concert they went to.',
    'Searching covers the year around the given date and ranks results by how close they are to it,',
    'so an approximate or misremembered date is fine.',
    'Returns a compact list - call get_setlist with an id from the results to get the actual songs.',
    'This calls a rate-limited public API, so a search takes a few seconds.'
  ].join(' '),
  inputSchema: FIND_SETLISTS_INPUT,
  outputSchema: FIND_SETLISTS_OUTPUT,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true }
}

/**
 * Builds the find_setlists tool.
 *
 * @param {Object} deps
 * @param {Object} deps.musicBrainz - MusicBrainz client.
 * @param {Object} deps.setlistFm - Setlist.fm client.
 * @param {Object} deps.logger - Logger.
 * @returns {Object} A { name, config, handler } triple for registerTool.
 */
function buildFindSetlistsTool ({ musicBrainz, setlistFm, logger }) {
  /**
   * @param {Object} args - Validated tool arguments.
   * @returns {Promise<Object>} An MCP tool result.
   */
  async function handler (args) {
    const { artist, artistMbid, city, date, countryCode, page = 1 } = args
    // A date implies its year; searching the year rather than the exact day is what
    // makes a misremembered date recoverable without extra requests.
    const year = date ? yearOf(date) : (args.year ?? null)

    try {
      const resolved = artistMbid
        ? { name: artist, mbid: artistMbid, disambiguation: null, alternatives: [] }
        : await musicBrainz.searchArtist(artist)

      if (!resolved) {
        return textResult(
          `No artist found on MusicBrainz matching "${artist}". Check the spelling, or try the name as it appears on the ticket.`,
          emptyPayload(args, year, null)
        )
      }

      let broadened = false
      let response = await setlistFm.searchSetlists({
        artistMbid: resolved.mbid,
        cityName: city,
        countryCode,
        year: year ?? undefined,
        page
      })

      // setlist.fm city names and human memory disagree often enough - suburb versus
      // city, "Brooklyn" versus "New York" - to be worth one retry without the city.
      if (isEmpty(response) && city) {
        logger?.info(`${TOOL_NAME}: no matches for city "${city}", retrying without it`)
        broadened = true
        response = await setlistFm.searchSetlists({
          artistMbid: resolved.mbid,
          countryCode,
          year: year ?? undefined,
          page
        })
      }

      const setlists = rank(response.setlist ?? [], date, broadened ? city : null)
      const payload = {
        artist: {
          name: resolved.name,
          mbid: resolved.mbid,
          disambiguation: resolved.disambiguation ?? null,
          alternatives: resolved.alternatives ?? []
        },
        query: {
          artist,
          city: city ?? null,
          date: date ?? null,
          year: year ?? null,
          broadened
        },
        total: response.total ?? setlists.length,
        page: response.page ?? page,
        count: setlists.length,
        setlists,
        note: noteFor({ setlists, response, date, city, broadened, resolved })
      }

      return textResult(summaryText(payload), payload)
    } catch (error) {
      logger?.error(`${TOOL_NAME} failed: ${error.message}`)
      return errorResult(describeError(error))
    }
  }

  return { name: TOOL_NAME, config: CONFIG, handler }
}

/**
 * @param {Object} response - A setlist.fm search envelope.
 * @returns {boolean} True if it carried no setlists.
 * @private
 */
function isEmpty (response) {
  return !response?.setlist || response.setlist.length === 0
}

/**
 * Summarises and orders setlists: exact date matches first, then by distance from the
 * requested date. Falls back to reverse chronological when no date was given.
 *
 * @param {Array<Object>} rawSetlists - Setlists from the API.
 * @param {string|null} date - The requested ISO date, if any.
 * @param {string|null} cityFilter - City to filter on when the search was broadened.
 * @returns {Array<Object>} Ranked summary rows.
 * @private
 */
function rank (rawSetlists, date, cityFilter) {
  let rows = rawSetlists.map(setlist => {
    const summary = summariseSetlist(setlist)
    const offset = date && summary.eventDate ? daysBetween(date, summary.eventDate) : null
    return { ...summary, exactDateMatch: offset === 0, daysFromRequestedDate: offset }
  })

  if (cityFilter) {
    const needle = cityFilter.toLowerCase()
    const matching = rows.filter(row => row.city.toLowerCase().includes(needle))
    // Only narrow if the filter actually matched something, so broadening never
    // turns a usable result set into an empty one.
    if (matching.length > 0) {
      rows = matching
    }
  }

  return rows.sort((a, b) => {
    if (a.daysFromRequestedDate !== null && b.daysFromRequestedDate !== null) {
      return Math.abs(a.daysFromRequestedDate) - Math.abs(b.daysFromRequestedDate)
    }
    return String(b.eventDate ?? '').localeCompare(String(a.eventDate ?? ''))
  })
}

/**
 * @param {Object} context - Everything needed to decide whether a note is warranted.
 * @returns {string|null} A note, or null when nothing needs saying.
 * @private
 */
function noteFor ({ setlists, response, date, city, broadened, resolved }) {
  const notes = []

  if (setlists.length === 0) {
    notes.push(`No setlists found for ${resolved.name}${city ? ` in ${city}` : ''}. They may not have a setlist on setlist.fm for this gig.`)
  }
  if (broadened && setlists.length > 0) {
    notes.push(`No setlists matched the city "${city}", so the search was widened to every city that year.`)
  }
  if (date && setlists.length > 0 && !setlists[0].exactDateMatch) {
    notes.push(`No setlist falls exactly on ${date}; the closest matches are listed first.`)
  }
  if ((response.total ?? 0) > setlists.length) {
    notes.push(`${response.total} setlists matched in total; request a later page to see more.`)
  }
  if (resolved.alternatives?.length > 0) {
    const names = resolved.alternatives.map(alt => `${alt.name}${alt.disambiguation ? ` (${alt.disambiguation})` : ''}`).join(', ')
    notes.push(`MusicBrainz also matched: ${names}. If these results look wrong, retry with artistMbid set to one of those.`)
  }

  return notes.length > 0 ? notes.join(' ') : null
}

/**
 * @param {Object} payload - The structured response.
 * @returns {string} A compact human-readable rendering.
 * @private
 */
function summaryText (payload) {
  const { artist, setlists, query, note } = payload

  if (setlists.length === 0) {
    return [`No setlists found for ${artist?.name ?? query.artist}.`, note].filter(Boolean).join(' ')
  }

  const scope = [query.city, query.year].filter(Boolean).join(', ')
  const lines = setlists.map((setlist, index) => {
    const when = describeOffset(setlist)
    return `${index + 1}. ${setlist.eventDate}  ${setlist.venue}, ${setlist.city}, ${setlist.country} - ${setlist.songCount} songs - id ${setlist.id}${when}`
  })

  return [
    `${artist.name} - ${setlists.length} setlist${setlists.length === 1 ? '' : 's'} found${scope ? ` (${scope})` : ''}`,
    '',
    ...lines,
    '',
    note,
    'Call get_setlist with an id for the full song list.'
  ].filter(line => line !== null && line !== undefined).join('\n')
}

/**
 * @param {Object} setlist - A ranked summary row.
 * @returns {string} A parenthetical describing its distance from the requested date.
 * @private
 */
function describeOffset (setlist) {
  if (setlist.exactDateMatch) {
    return '  [exact date match]'
  }
  if (setlist.daysFromRequestedDate === null) {
    return ''
  }
  const days = Math.abs(setlist.daysFromRequestedDate)
  const direction = setlist.daysFromRequestedDate > 0 ? 'after' : 'before'
  return `  [${days} day${days === 1 ? '' : 's'} ${direction}]`
}

/**
 * @param {Object} args - The tool arguments.
 * @param {number|null} year - The resolved year.
 * @param {Object|null} artist - The resolved artist, if any.
 * @returns {Object} An empty but schema-valid payload.
 * @private
 */
function emptyPayload (args, year, artist) {
  return {
    artist,
    query: {
      artist: args.artist,
      city: args.city ?? null,
      date: args.date ?? null,
      year: year ?? null,
      broadened: false
    },
    total: 0,
    page: args.page ?? 1,
    count: 0,
    setlists: [],
    note: null
  }
}

export { buildFindSetlistsTool, FIND_SETLISTS_INPUT, FIND_SETLISTS_OUTPUT, TOOL_NAME }
