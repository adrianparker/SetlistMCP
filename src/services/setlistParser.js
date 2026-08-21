import { fromApiDate } from './dates.js'

/**
 * Parses a setlist response into a flat list of songs.
 *
 * Ported from setlist-finder, keeping its defensive array-or-object handling: the
 * setlist.fm JSON is derived from XML, so a set with one song arrives as a bare
 * object where a set with two arrives as an array. Same for sets themselves.
 *
 * Never throws and never returns null - malformed input yields an empty list, so a
 * surprising response degrades to "no songs" rather than failing a tool call.
 *
 * @param {Object} setlistResponse - A setlist object from the setlist.fm API.
 * @returns {Array<Object>} Songs with name, position, set and provenance metadata.
 */
function parseSetlistSongs (setlistResponse) {
  const songs = []

  if (!setlistResponse || !setlistResponse.sets || !setlistResponse.sets.set) {
    return songs
  }

  const artistName = setlistResponse.artist?.name || 'Unknown Artist'
  const setsArray = asArray(setlistResponse.sets.set)

  setsArray.forEach((set, setIndex) => {
    if (!set) {
      return
    }
    const setNumber = setIndex + 1
    const isEncoreSet = set.encore !== undefined && set.encore !== null
    const encoreNumber = set.encore ?? null
    const setName = set.name ?? null

    asArray(set.song).forEach(song => {
      if (!song || !song.name) {
        return
      }
      songs.push({
        position: songs.length + 1,
        songName: song.name,
        artistName,
        setNumber,
        setName,
        isEncoreSet,
        encoreNumber,
        isTape: song.tape === true,
        cover: song.cover?.name ?? null,
        with: song.with?.name ?? null,
        info: song.info ?? null
      })
    })
  })

  return songs
}

/**
 * Reduces a setlist to the compact row find_setlists returns.
 *
 * eventDate is normalised to ISO here, as everywhere else in this server. The API's
 * native dd-MM-yyyy reads as ISO-ish to a model, which gets the date silently wrong.
 *
 * @param {Object} setlist - A setlist object from the setlist.fm API.
 * @returns {Object} A summary row.
 */
function summariseSetlist (setlist) {
  const songs = parseSetlistSongs(setlist)
  const city = setlist.venue?.city

  return {
    id: setlist.id,
    eventDate: fromApiDate(setlist.eventDate) ?? null,
    artistName: setlist.artist?.name ?? 'Unknown artist',
    venue: setlist.venue?.name ?? 'Unknown venue',
    city: city?.name ?? 'Unknown city',
    state: city?.state ?? null,
    country: city?.country?.name ?? 'Unknown country',
    countryCode: city?.country?.code ?? null,
    tour: setlist.tour?.name ?? null,
    // Tape entries are walk-in and interval music, not performances.
    songCount: songs.filter(song => !song.isTape).length,
    url: setlist.url ?? null
  }
}

/**
 * Expands a setlist into the full detail get_setlist returns, with songs grouped
 * back into their sets.
 *
 * @param {Object} setlist - A setlist object from the setlist.fm API.
 * @returns {Object} The full detail shape.
 */
function detailSetlist (setlist) {
  const songs = parseSetlistSongs(setlist)
  const city = setlist.venue?.city

  const sets = asArray(setlist.sets?.set)
    .filter(Boolean)
    .map((set, index) => ({
      setNumber: index + 1,
      name: set.name ?? null,
      encore: set.encore ?? null,
      songs: songs
        .filter(song => song.setNumber === index + 1)
        .map(song => ({
          position: song.position,
          name: song.songName,
          tape: song.isTape,
          cover: song.cover,
          with: song.with,
          info: song.info
        }))
    }))

  return {
    id: setlist.id,
    url: setlist.url ?? null,
    eventDate: fromApiDate(setlist.eventDate) ?? null,
    lastUpdated: setlist.lastUpdated ?? null,
    artist: {
      name: setlist.artist?.name ?? 'Unknown artist',
      mbid: setlist.artist?.mbid ?? null
    },
    venue: {
      name: setlist.venue?.name ?? 'Unknown venue',
      city: city?.name ?? 'Unknown city',
      state: city?.state ?? null,
      country: city?.country?.name ?? 'Unknown country',
      countryCode: city?.country?.code ?? null,
      url: setlist.venue?.url ?? null
    },
    tour: setlist.tour?.name ?? null,
    info: setlist.info ?? null,
    songCount: songs.filter(song => !song.isTape).length,
    sets
  }
}

/**
 * Normalises setlist.fm's array-or-single-object shapes into an array.
 *
 * @param {*} value - An array, a single object, or nothing.
 * @returns {Array} Always an array.
 * @private
 */
function asArray (value) {
  if (value === undefined || value === null) {
    return []
  }
  return Array.isArray(value) ? value : [value]
}

export { detailSetlist, parseSetlistSongs, summariseSetlist }
