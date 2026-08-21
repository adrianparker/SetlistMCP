import { ConfigurationError, HttpError } from './errors.js'
import { requestJson } from './httpJson.js'
import { toApiDate } from './dates.js'

const DEFAULT_BASE_URL = 'https://api.setlist.fm/rest/1.0'
const SETLIST_ID_PATTERN = /^[0-9a-zA-Z]{4,32}$/

/**
 * Client for the setlist.fm REST API.
 */
class SetlistFmClient {
  /**
   * @param {Object} logger - Logger with debug/info/warn/error.
   * @param {Object} options
   * @param {import('./rateLimiter.js').RateLimiter} options.limiter - Guards the outbound rate.
   * @param {import('./cache.js').TtlCache} [options.searchCache] - Search response cache.
   * @param {import('./cache.js').TtlCache} [options.detailCache] - Setlist detail cache.
   * @param {string} [options.baseUrl] - API base URL.
   * @param {string} [options.apiKey] - The setlist.fm API key.
   * @param {number} [options.timeoutMs] - Per-request time budget.
   */
  constructor (logger, {
    limiter,
    searchCache,
    detailCache,
    baseUrl = DEFAULT_BASE_URL,
    apiKey,
    timeoutMs = 10000
  } = {}) {
    this.logger = logger
    this.limiter = limiter
    this.searchCache = searchCache
    this.detailCache = detailCache
    this.baseUrl = baseUrl
    this.apiKey = apiKey
    this.timeoutMs = timeoutMs
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
      timeoutMs: this.timeoutMs
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
