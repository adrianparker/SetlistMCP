import { ConfigurationError, HttpError } from './errors.js'
import { requestJson } from './httpJson.js'
import { toApiDate } from './dates.js'

const DEFAULT_BASE_URL = 'https://api.setlist.fm/rest/1.0'
const SETLIST_ID_PATTERN = /^[0-9a-zA-Z]{4,32}$/
const COUNTRIES_CACHE_KEY = 'search/countries:all'
// The full list is ~42 countries at 20/page - three pages, generously capped so a
// surprising response size can never turn into an unbounded loop.
const MAX_COUNTRY_PAGES = 5

/**
 * Client for the setlist.fm REST API.
 */
class SetlistFmClient {
  /**
   * @param {Object} logger - Logger with debug/info/warn/error.
   * @param {Object} options
   * @param {import('./rateLimiter.js').RateLimiter} options.limiter - Guards the outbound rate.
   * @param {import('./cache.js').TtlCache} [options.searchCache] - Search response cache.
   * @param {import('./cache.js').TtlCache} [options.detailCache] - Detail (artist/venue/city/setlist) cache.
   * @param {import('./cache.js').TtlCache} [options.countriesCache] - Long-lived cache for the (static) country list.
   * @param {string} [options.baseUrl] - API base URL.
   * @param {string} [options.apiKey] - The setlist.fm API key.
   * @param {number} [options.timeoutMs] - Per-request time budget.
   * @param {number} [options.maxAttempts] - Total attempts (including retries) per request.
   */
  constructor (logger, {
    limiter,
    searchCache,
    detailCache,
    countriesCache,
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    timeoutMs = 10000,
    maxAttempts = 4
  } = {}) {
    this.logger = logger
    this.limiter = limiter
    this.searchCache = searchCache
    this.detailCache = detailCache
    this.countriesCache = countriesCache
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
    this.maxAttempts = maxAttempts
  }

  /**
   * Searches for setlists.
   *
   * A 404 here means "nothing matched", not an outage: setlist.fm returns 404 rather
   * than an empty collection when a search has no results. Treating that as an error
   * would make every unsuccessful search look like a broken tool.
   *
   * @param {Object} params
   * @param {string} [params.artistMbid] - MusicBrainz ID of the artist.
   * @param {string} [params.artistName] - Artist name, if no MBID is available.
   * @param {string} [params.cityName] - City the gig was in.
   * @param {string} [params.countryCode] - ISO 3166-1 alpha-2 country code.
   * @param {string} [params.venueName] - Venue name.
   * @param {string} [params.tourName] - Tour name.
   * @param {string} [params.date] - Gig date in ISO yyyy-MM-dd.
   * @param {number|string} [params.year] - Gig year.
   * @param {number} [params.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with setlist, total, page and itemsPerPage.
   */
  async searchSetlists ({
    artistMbid,
    artistName,
    cityName,
    countryCode,
    venueName,
    tourName,
    date,
    year,
    page = 1
  } = {}) {
    const url = new URL(`${this.baseUrl}/search/setlists`)
    appendParam(url, 'artistMbid', artistMbid)
    appendParam(url, 'artistName', artistName)
    appendParam(url, 'cityName', cityName)
    appendParam(url, 'countryCode', countryCode)
    appendParam(url, 'venueName', venueName)
    appendParam(url, 'tourName', tourName)
    // The API wants dd-MM-yyyy; every date crossing this boundary is ISO on our side.
    appendParam(url, 'date', date ? toApiDate(date) : undefined)
    appendParam(url, 'year', year)
    appendParam(url, 'p', page)

    try {
      return await this.doFetch(url, { cache: this.searchCache })
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        this.logger?.info(`Setlist.fm: no setlists matched ${url.search}`)
        return { setlist: [], total: 0, page, itemsPerPage: 0 }
      }
      throw error
    }
  }

  /**
   * Fetches one setlist by id.
   *
   * Unlike search, a 404 here is a real answer and propagates.
   *
   * @param {string} setlistId - The setlist.fm setlist id.
   * @returns {Promise<Object>} The setlist.
   * @throws {Error} If the id is not well formed.
   */
  async getSetlist (setlistId) {
    if (!SETLIST_ID_PATTERN.test(String(setlistId ?? ''))) {
      throw new Error(`Not a valid setlist id: ${setlistId}`)
    }
    // Encoded as well as validated: this value lands in a URL path.
    const url = new URL(`${this.baseUrl}/setlist/${encodeURIComponent(setlistId)}`)
    return this.doFetch(url, { cache: this.detailCache })
  }

  /**
   * Fetches one specific historical edit of a setlist.
   *
   * @param {string} versionId - The setlist.fm version id.
   * @returns {Promise<Object>} The setlist as it stood at that version.
   * @throws {Error} If the id is not well formed.
   */
  async getSetlistVersion (versionId) {
    if (!SETLIST_ID_PATTERN.test(String(versionId ?? ''))) {
      throw new Error(`Not a valid setlist version id: ${versionId}`)
    }
    const url = new URL(`${this.baseUrl}/setlist/version/${encodeURIComponent(versionId)}`)
    return this.doFetch(url, { cache: this.detailCache })
  }

  /**
   * Fetches one artist by MusicBrainz id.
   *
   * @param {string} mbid - The artist's MusicBrainz id.
   * @returns {Promise<Object>} The artist.
   */
  async getArtist (mbid) {
    const url = new URL(`${this.baseUrl}/artist/${encodeURIComponent(mbid)}`)
    return this.doFetch(url, { cache: this.detailCache })
  }

  /**
   * Searches setlist.fm's own artist directory by name or MBID.
   *
   * @param {Object} params
   * @param {string} [params.artistName] - Artist name to search for.
   * @param {string} [params.artistMbid] - MusicBrainz id to search for.
   * @param {string} [params.sort] - "sortName" (default) or "relevance".
   * @param {number} [params.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with artist, total, page and itemsPerPage.
   */
  async searchArtists ({ artistName, artistMbid, sort, page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/search/artists`)
    appendParam(url, 'artistName', artistName)
    appendParam(url, 'artistMbid', artistMbid)
    appendParam(url, 'sort', sort)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { artist: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches the setlists for one artist.
   *
   * @param {string} mbid - The artist's MusicBrainz id.
   * @param {Object} [options]
   * @param {number} [options.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with setlist, total, page and itemsPerPage.
   */
  async getArtistSetlists (mbid, { page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/artist/${encodeURIComponent(mbid)}/setlists`)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { setlist: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches one venue by id.
   *
   * @param {string} venueId - The venue's setlist.fm id.
   * @returns {Promise<Object>} The venue.
   */
  async getVenue (venueId) {
    const url = new URL(`${this.baseUrl}/venue/${encodeURIComponent(venueId)}`)
    return this.doFetch(url, { cache: this.detailCache })
  }

  /**
   * Fetches the setlists for one venue.
   *
   * @param {string} venueId - The venue's setlist.fm id.
   * @param {Object} [options]
   * @param {number} [options.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with setlist, total, page and itemsPerPage.
   */
  async getVenueSetlists (venueId, { page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/venue/${encodeURIComponent(venueId)}/setlists`)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { setlist: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Searches for venues.
   *
   * @param {Object} params
   * @param {string} [params.name] - Venue name.
   * @param {string} [params.cityName] - City the venue is in.
   * @param {string} [params.cityId] - City geoId.
   * @param {string} [params.country] - Country name.
   * @param {string} [params.state] - State name.
   * @param {string} [params.stateCode] - State code.
   * @param {number} [params.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with venue, total, page and itemsPerPage.
   */
  async searchVenues ({ name, cityName, cityId, country, state, stateCode, page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/search/venues`)
    appendParam(url, 'name', name)
    appendParam(url, 'cityName', cityName)
    appendParam(url, 'cityId', cityId)
    appendParam(url, 'country', country)
    appendParam(url, 'state', state)
    appendParam(url, 'stateCode', stateCode)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { venue: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches one city by geoId.
   *
   * @param {string} geoId - The city's geoId.
   * @returns {Promise<Object>} The city.
   */
  async getCity (geoId) {
    const url = new URL(`${this.baseUrl}/city/${encodeURIComponent(geoId)}`)
    return this.doFetch(url, { cache: this.detailCache })
  }

  /**
   * Searches for cities.
   *
   * @param {Object} params
   * @param {string} [params.name] - City name.
   * @param {string} [params.country] - Country name.
   * @param {string} [params.state] - State name.
   * @param {string} [params.stateCode] - State code.
   * @param {number} [params.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with cities, total, page and itemsPerPage.
   */
  async searchCities ({ name, country, state, stateCode, page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/search/cities`)
    appendParam(url, 'name', name)
    appendParam(url, 'country', country)
    appendParam(url, 'state', state)
    appendParam(url, 'stateCode', stateCode)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { cities: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches the complete, static list of countries setlist.fm supports.
   *
   * The endpoint takes no filters but is still paginated at 20/page, so this walks
   * every page and caches the merged result for a long time - the dataset changes
   * essentially never, so repeated calls should cost at most one request ever.
   *
   * @returns {Promise<Object>} An envelope with country, total, page and itemsPerPage.
   */
  async searchCountries () {
    const cached = this.countriesCache?.get(COUNTRIES_CACHE_KEY)
    if (cached !== undefined) {
      this.logger?.debug('Setlist.fm: cache hit for search/countries')
      return cached
    }

    const countries = []
    let total = Infinity
    for (let page = 1; page <= MAX_COUNTRY_PAGES && countries.length < total; page += 1) {
      const url = new URL(`${this.baseUrl}/search/countries`)
      appendParam(url, 'p', page)
      const response = await this.doFetch(url)
      const batch = response.country ?? []
      total = response.total ?? countries.length + batch.length
      countries.push(...batch)
      if (batch.length === 0) {
        break
      }
    }

    const result = { country: countries, total: countries.length, page: 1, itemsPerPage: countries.length }
    this.countriesCache?.set(COUNTRIES_CACHE_KEY, result)
    return result
  }

  /**
   * Fetches setlists a user has logged as attended.
   *
   * @param {string} userId - The setlist.fm userId.
   * @param {Object} [options]
   * @param {number} [options.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with setlist, total, page and itemsPerPage.
   */
  async getUserAttended (userId, { page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/user/${encodeURIComponent(userId)}/attended`)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { setlist: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches setlists a user has edited. Note this returns the current version of each
   * setlist, not the version the user actually edited.
   *
   * @param {string} userId - The setlist.fm userId.
   * @param {Object} [options]
   * @param {number} [options.page=1] - Result page.
   * @returns {Promise<Object>} An envelope with setlist, total, page and itemsPerPage.
   */
  async getUserEdited (userId, { page = 1 } = {}) {
    const url = new URL(`${this.baseUrl}/user/${encodeURIComponent(userId)}/edited`)
    appendParam(url, 'p', page)
    return this.fetchList(url, { cache: this.searchCache, emptyEnvelope: { setlist: [], total: 0, page, itemsPerPage: 0 } })
  }

  /**
   * Fetches a collection endpoint, treating a 404 as an empty collection.
   *
   * setlist.fm returns 404 rather than an empty array whenever a collection would
   * otherwise be empty - true of every search/list endpoint here, not just
   * search/setlists. Treating that as an error would make a legitimate empty result
   * look like a broken tool.
   *
   * @param {URL} url - The request URL.
   * @param {Object} options
   * @param {import('./cache.js').TtlCache} [options.cache] - Cache to consult and populate.
   * @param {Object} options.emptyEnvelope - What to return in place of a 404.
   * @returns {Promise<Object>} The parsed response body, or emptyEnvelope.
   * @private
   */
  async fetchList (url, { cache, emptyEnvelope }) {
    try {
      return await this.doFetch(url, { cache })
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        this.logger?.info(`Setlist.fm: no results for ${url.pathname}${url.search}`)
        return emptyEnvelope
      }
      throw error
    }
  }

  /**
   * Shared request helper. Checks the API key lazily rather than in the constructor,
   * so the server still starts and lists its tools without one - otherwise you cannot
   * even see the tool that would tell you the key is missing.
   *
   * @param {URL} url - The request URL.
   * @param {Object} [options]
   * @param {import('./cache.js').TtlCache} [options.cache] - Cache to consult and populate.
   * @returns {Promise<Object>} The parsed response body.
   * @throws {ConfigurationError} If no API key is configured.
   */
  async doFetch (url, { cache } = {}) {
    if (!this.apiKey) {
      throw new ConfigurationError('SETLISTFM_API_KEY is not set. Add it to the .env file in the setlist-mcp directory.')
    }

    const cacheKey = url.toString()
    const cached = cache?.get(cacheKey)
    if (cached !== undefined) {
      this.logger?.debug(`Setlist.fm: cache hit for ${url.pathname}${url.search}`)
      return cached
    }

    const body = await requestJson({
      url,
      limiter: this.limiter,
      logger: this.logger,
      label: 'Setlist.fm',
      headers: { 'x-api-key': this.apiKey, Accept: 'application/json' },
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts
    })

    cache?.set(cacheKey, body)
    return body
  }
}

/**
 * Appends a query parameter, skipping empty values so they never reach the API.
 *
 * @param {URL} url - The URL being built.
 * @param {string} name - Parameter name.
 * @param {*} value - Parameter value.
 * @returns {void}
 * @private
 */
function appendParam (url, name, value) {
  if (value === undefined || value === null || value === '') {
    return
  }
  url.searchParams.append(name, String(value))
}

export { SETLIST_ID_PATTERN, SetlistFmClient }
