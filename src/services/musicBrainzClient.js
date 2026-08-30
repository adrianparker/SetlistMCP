import { requestJson } from './httpJson.js'

const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2'
const DEFAULT_CONTACT = 'https://github.com/adrianparker/setlist-mcp'
const ALTERNATIVE_SCORE_FLOOR = 70
const MAX_ALTERNATIVES = 3
// An alternative is only worth raising when it is nearly as good a match as the best
// one. Searching "Prince" returns Bobby Prince and Bonnie "Prince" Billy in the
// seventies against a perfect 100 - offering those as candidates invites the model to
// retry with an MBID that is definitely wrong.
const ALTERNATIVE_SCORE_MARGIN = 5

/**
 * Resolves artist names to MusicBrainz IDs.
 *
 * Setlist.fm can search by artist name directly, but an MBID is exact, and resolving
 * here spends MusicBrainz's budget rather than setlist.fm's - which is the scarcer of
 * the two.
 */
class MusicBrainzClient {
  /**
   * @param {Object} logger - Logger with debug/info/warn/error.
   * @param {Object} options
   * @param {import('./rateLimiter.js').RateLimiter} options.limiter - Guards the outbound rate.
   * @param {import('./cache.js').TtlCache} [options.cache] - Artist lookup cache.
   * @param {string} [options.baseUrl] - API base URL.
   * @param {string} [options.contact] - Contact detail for the User-Agent.
   * @param {string} [options.version] - This server's version, for the User-Agent.
   * @param {number} [options.timeoutMs] - Per-request time budget.
   * @param {number} [options.limit=5] - How many candidates to request.
   * @param {number} [options.maxAttempts] - Total attempts (including retries) per request.
   */
  constructor (logger, {
    limiter,
    cache,
    baseUrl = DEFAULT_BASE_URL,
    contact,
    version = '0.0.0',
    timeoutMs = 10000,
    limit = 5,
    maxAttempts = 4
  } = {}) {
    this.logger = logger
    this.limiter = limiter
    this.cache = cache
    this.baseUrl = baseUrl
    this.timeoutMs = timeoutMs
    this.limit = limit
    this.maxAttempts = maxAttempts

    if (!contact) {
      logger?.warn('MUSICBRAINZ_CONTACT is not set; falling back to the repository URL. MusicBrainz asks for contact details in the User-Agent.')
    }
    this.contact = contact || DEFAULT_CONTACT
    // MusicBrainz throttles anonymous-looking User-Agents harder, and their policy
    // asks for a way to contact the maintainer.
    this.userAgent = `setlist-mcp/${version} ( ${this.contact} )`
  }

  /**
   * Searches for an artist by name.
   *
   * Returns the best match plus any credible alternatives. The reference CLI took
   * artists[0] blindly, which in practice picked between identically named acts at
   * random; surfacing alternatives lets the caller correct course in one turn.
   *
   * @param {string} artistName - The name to search for.
   * @returns {Promise<Object|null>} The match, or null if nothing was found.
   */
  async searchArtist (artistName) {
    const cacheKey = String(artistName ?? '').trim().toLowerCase()
    const cached = this.cache?.get(cacheKey)
    if (cached !== undefined) {
      this.logger?.debug(`MusicBrainz: cache hit for "${artistName}"`)
      return cached
    }

    const url = new URL(`${this.baseUrl}/artist`)
    url.searchParams.append('query', artistName)
    url.searchParams.append('fmt', 'json')
    url.searchParams.append('limit', String(this.limit))

    const data = await this.doFetch(url)
    const artists = Array.isArray(data?.artists) ? data.artists : []
    this.logger?.info(`MusicBrainz: ${artists.length} result(s) for "${artistName}"`)

    if (artists.length === 0) {
      this.cache?.set(cacheKey, null)
      return null
    }

    const [best, ...rest] = artists
    const threshold = Math.max(ALTERNATIVE_SCORE_FLOOR, (best.score ?? 0) - ALTERNATIVE_SCORE_MARGIN)
    const result = {
      name: best.name,
      mbid: best.id,
      // Note the hyphen: the MusicBrainz JSON field is sort-name, not sortName.
      sortName: best['sort-name'] ?? null,
      disambiguation: best.disambiguation ?? null,
      country: best.country ?? null,
      score: best.score ?? null,
      alternatives: rest
        .filter(artist => (artist.score ?? 0) >= threshold)
        .slice(0, MAX_ALTERNATIVES)
        .map(artist => ({
          name: artist.name,
          mbid: artist.id,
          disambiguation: artist.disambiguation ?? null,
          score: artist.score ?? null
        }))
    }

    this.cache?.set(cacheKey, result)
    return result
  }

  /**
   * @param {URL} url - The request URL.
   * @returns {Promise<Object>} The parsed response body.
   */
  async doFetch (url) {
    return requestJson({
      url,
      limiter: this.limiter,
      logger: this.logger,
      label: 'MusicBrainz',
      headers: { 'User-Agent': this.userAgent, Accept: 'application/json' },
      timeoutMs: this.timeoutMs,
      maxAttempts: this.maxAttempts
    })
  }
}

export { DEFAULT_CONTACT, MusicBrainzClient }
