/**
 * Typed errors so the tool layer can map failures to useful, model-facing text
 * without resorting to matching on message strings.
 */

/**
 * A non-retryable (or retry-exhausted) HTTP failure from an upstream API.
 */
class HttpError extends Error {
  /**
   * @param {string} message - Human-readable description.
   * @param {Object} [details]
   * @param {number} [details.status] - HTTP status code.
   * @param {string} [details.url] - The request URL.
   * @param {number} [details.retryAfterMs] - Retry-After, in milliseconds, if the server sent one.
   * @param {string} [details.body] - A truncated response body, for diagnostics.
   */
  constructor (message, { status, url, retryAfterMs, body } = {}) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.url = url
    this.retryAfterMs = retryAfterMs
    this.body = body
  }
}

/**
 * A request that exceeded its time budget.
 */
class TimeoutError extends Error {
  /**
   * @param {string} label - Which API timed out, e.g. 'Setlist.fm'.
   * @param {number} timeoutMs - The budget that was exceeded.
   */
  constructor (label, timeoutMs) {
    super(`${label} request timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
    this.label = label
    this.timeoutMs = timeoutMs
  }
}

/**
 * The per-process request budget for an API has been used up.
 */
class DailyQuotaExceededError extends Error {
  /**
   * @param {string} name - The limiter name, e.g. 'setlist.fm'.
   * @param {number} limit - The configured limit.
   */
  constructor (name, limit) {
    super(`${name} request budget of ${limit} exhausted for today`)
    this.name = 'DailyQuotaExceededError'
    this.limiterName = name
    this.limit = limit
  }
}

/**
 * Something the operator needs to fix, such as a missing API key.
 */
class ConfigurationError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export { ConfigurationError, DailyQuotaExceededError, HttpError, TimeoutError }
