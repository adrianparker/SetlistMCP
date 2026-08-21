import { HttpError, TimeoutError } from './errors.js'

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504]
const MAX_BODY_SNIPPET = 500

/**
 * The shared request path for both upstream APIs: rate limited, timed out, and
 * retried on the statuses that mean "later, not never".
 *
 * MusicBrainz signals throttling with 503 and setlist.fm with 429, so both land on
 * the same code path rather than needing a special case each.
 *
 * @param {Object} options
 * @param {string|URL} options.url - The request URL.
 * @param {import('./rateLimiter.js').RateLimiter} options.limiter - Guards the outbound rate.
 * @param {Object} options.logger - Logger with debug/info/warn/error.
 * @param {string} options.label - Which API this is, for logs and errors.
 * @param {Object} [options.headers] - Request headers.
 * @param {number} [options.timeoutMs=10000] - Per-attempt time budget.
 * @param {number[]} [options.retryStatuses] - Statuses worth retrying.
 * @param {number} [options.maxAttempts=4] - Total attempts including the first.
 * @param {number} [options.backoffBaseMs=1000] - Base for exponential backoff.
 * @param {number} [options.maxBackoffMs=30000] - Ceiling on any single backoff.
 * @returns {Promise<Object>} The parsed JSON body.
 * @throws {HttpError|TimeoutError} On a non-retryable failure or exhausted retries.
 */
async function requestJson ({
  url,
  limiter,
  logger,
  label,
  headers = {},
  timeoutMs = 10000,
  retryStatuses = DEFAULT_RETRY_STATUSES,
  maxAttempts = 4,
  backoffBaseMs = 1000,
  maxBackoffMs = 30000
}) {
  const target = String(url)
  let lastStatus

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response
    try {
      response = await limiter.schedule(async () => {
        logger?.info(`${label} API Request: GET ${target}`)
        // Built inside the scheduled task so queue wait never eats the time budget.
        return fetch(target, { headers, signal: AbortSignal.timeout(timeoutMs) })
      })
    } catch (error) {
      if (isTimeout(error)) {
        if (attempt < maxAttempts) {
          logger?.warn(`${label}: request timed out, attempt ${attempt} of ${maxAttempts}`)
          limiter.penalise(backoffFor(attempt, backoffBaseMs, maxBackoffMs))
          continue
        }
        throw new TimeoutError(label, timeoutMs)
      }
      throw error
    }

    if (response.ok) {
      return parseJson(response, label, target)
    }

    lastStatus = response.status
    if (!retryStatuses.includes(response.status)) {
      throw await httpErrorFrom(response, label, target)
    }

    if (attempt >= maxAttempts) {
      const error = await httpErrorFrom(response, label, target)
      error.message = `${label} still returning HTTP ${lastStatus} after ${maxAttempts} attempts`
      throw error
    }

    const retryAfterMs = parseRetryAfter(response.headers?.get?.('retry-after'), Date.now())
    const delay = clamp(retryAfterMs ?? backoffFor(attempt, backoffBaseMs, maxBackoffMs), 0, maxBackoffMs)
    logger?.warn(`${label}: HTTP ${response.status}, retrying in ${delay}ms (attempt ${attempt} of ${maxAttempts})`)
    // Penalising the limiter holds off the whole queue, so the next scheduled request
    // waits automatically - no separate sleep needed here.
    limiter.penalise(delay)
  }

  /* c8 ignore next - unreachable: the loop always returns or throws */
  throw new HttpError(`${label} request failed`, { status: lastStatus, url: target })
}

/**
 * Parses Retry-After in either form the RFC allows: delta-seconds, or an HTTP-date.
 *
 * @param {string|null|undefined} headerValue - The raw header value.
 * @param {number} [nowMs] - Current time, for the HTTP-date form.
 * @returns {number|null} Milliseconds to wait, or null if unparseable.
 */
function parseRetryAfter (headerValue, nowMs = Date.now()) {
  if (!headerValue) {
    return null
  }
  const trimmed = String(headerValue).trim()

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000
  }

  const asDate = Date.parse(trimmed)
  if (Number.isNaN(asDate)) {
    return null
  }
  return Math.max(0, asDate - nowMs)
}

/**
 * @param {number} attempt - 1-based attempt number.
 * @param {number} baseMs - Backoff base.
 * @param {number} maxMs - Backoff ceiling.
 * @returns {number} Backoff in milliseconds, with jitter.
 * @private
 */
function backoffFor (attempt, baseMs, maxMs) {
  const exponential = baseMs * Math.pow(2, attempt - 1)
  const jitter = Math.floor(Math.random() * baseMs)
  return clamp(exponential + jitter, 0, maxMs)
}

/**
 * @param {number} value - The value to clamp.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {number} The clamped value.
 * @private
 */
function clamp (value, min, max) {
  return Math.min(Math.max(value, min), max)
}

/**
 * @param {Error} error - A rejection from fetch.
 * @returns {boolean} True if it represents a timeout.
 * @private
 */
function isTimeout (error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError'
}

/**
 * Parses a successful response body, mapping a malformed body to HttpError rather
 * than letting a bare SyntaxError escape.
 *
 * @param {Response} response - The fetch response.
 * @param {string} label - Which API this is.
 * @param {string} url - The request URL.
 * @returns {Promise<Object>} The parsed body.
 * @private
 */
async function parseJson (response, label, url) {
  try {
    return await response.json()
  } catch {
    throw new HttpError(`${label} returned a body that is not valid JSON`, {
      status: response.status,
      url
    })
  }
}

/**
 * Builds an HttpError, reading the error body when there is a useful one.
 *
 * @param {Response} response - The failed response.
 * @param {string} label - Which API this is.
 * @param {string} url - The request URL.
 * @returns {Promise<HttpError>} The error to throw.
 * @private
 */
async function httpErrorFrom (response, label, url) {
  const body = await response.text().catch(() => '')
  const snippet = body.slice(0, MAX_BODY_SNIPPET)
  return new HttpError(`${label} API error: ${response.status} ${response.statusText}`, {
    status: response.status,
    url,
    retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after'), Date.now()),
    body: snippet
  })
}

export { DEFAULT_RETRY_STATUSES, parseRetryAfter, requestJson }
