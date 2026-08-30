/**
 * Flattens the artist/venue/city/country shapes shared across several endpoints
 * (artist detail, artist search, venue detail, venue search, city detail, city
 * search, country search) into the consistent shapes this server's tools return.
 *
 * Kept separate from setlistParser.js, which is specifically about setlists and their
 * songs.
 */

/**
 * @param {Object} artist - An artist object from the setlist.fm API.
 * @returns {Object} A flat artist shape.
 */
function mapArtist (artist) {
  return {
    mbid: artist?.mbid ?? null,
    name: artist?.name ?? 'Unknown artist',
    sortName: artist?.sortName ?? null,
    disambiguation: artist?.disambiguation ?? null,
    url: artist?.url ?? null
  }
}

/**
 * @param {Object} city - A city object from the setlist.fm API.
 * @returns {Object} A flat city shape.
 */
function mapCity (city) {
  return {
    id: city?.id ?? null,
    name: city?.name ?? 'Unknown city',
    state: city?.state ?? null,
    stateCode: city?.stateCode ?? null,
    country: city?.country?.name ?? null,
    countryCode: city?.country?.code ?? null,
    lat: city?.coords?.lat ?? null,
    long: city?.coords?.long ?? null
  }
}

/**
 * @param {Object} venue - A venue object from the setlist.fm API.
 * @returns {Object} A flat venue shape, with its city nested.
 */
function mapVenue (venue) {
  return {
    id: venue?.id ?? null,
    name: venue?.name ?? 'Unknown venue',
    url: venue?.url ?? null,
    city: venue?.city ? mapCity(venue.city) : null
  }
}

/**
 * @param {Object} country - A country object from the setlist.fm API.
 * @returns {Object} A flat country shape.
 */
function mapCountry (country) {
  return {
    code: country?.code ?? null,
    name: country?.name ?? 'Unknown country'
  }
}

export { mapArtist, mapCity, mapCountry, mapVenue }
