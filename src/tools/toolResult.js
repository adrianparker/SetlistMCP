/**
 * Helpers for shaping MCP tool results.
 *
 * Handlers return errors as isError results rather than throwing, so the model gets
 * an actionable sentence instead of a generic tool failure it cannot reason about.
 */

/**
 * A successful result carrying both a readable summary and structured data.
 *
 * The text block matters even when structuredContent is present: it is what a model
 * reads first, and it survives clients that ignore structured output.
 *
 * @param {string} text - Human-readable summary.
 * @param {Object} structuredContent - Data matching the tool's output schema.
 * @returns {Object} An MCP tool result.
 */
function textResult (text, structuredContent) {
  return {
    content: [{ type: 'text', text }],
    structuredContent
  }
}

/**
 * A failed result.
 *
 * @param {string} message - What went wrong, and what to do about it.
 * @returns {Object} An MCP tool result flagged as an error.
 */
function errorResult (message) {
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}

/**
 * Turns an error into a sentence worth showing a model.
 *
 * Typed errors are mapped by name rather than by matching message strings, which is
 * why the service layer bothers to define them.
 *
 * @param {Error} error - The error to describe.
 * @returns {string} A model-facing description.
 */
function describeError (error) {
  switch (error?.name) {
    case 'ConfigurationError':
      return `The setlist.fm MCP server is not configured: ${error.message}`
    case 'DailyQuotaExceededError':
      return `${error.message}. This is a self-imposed limit to stay within setlist.fm's rate limiting policy; it resets when the server restarts or the UTC day rolls over.`
    case 'TimeoutError':
      return `${error.message}. The upstream API may be slow or unreachable - worth trying again shortly.`
    case 'HttpError':
      return describeHttpError(error)
    default:
      return `Unexpected error: ${error?.message ?? String(error)}`
  }
}

/**
 * @param {Error} error - An HttpError.
 * @returns {string} A model-facing description.
 * @private
 */
function describeHttpError (error) {
  if (error.status === 401 || error.status === 403) {
    return 'setlist.fm rejected the API key. Check SETLISTFM_API_KEY in the .env file in the setlist-mcp directory.'
  }
  if (error.status === 429) {
    return 'setlist.fm is rate limiting this server and the retries did not clear it. Wait a minute or two before searching again.'
  }
  if (error.status >= 500) {
    return `The upstream API is having trouble (HTTP ${error.status}). This is usually temporary.`
  }
  return error.message
}

export { describeError, errorResult, textResult }
