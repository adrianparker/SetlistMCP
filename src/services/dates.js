/**
 * Date handling for setlist.fm.
 *
 * The API speaks dd-MM-yyyy; this server speaks ISO yyyy-MM-dd everywhere else. That
 * boundary matters more than it looks: a model reading "13-08-1992" as ISO-ish gets
 * the wrong date silently.
 *
 * All arithmetic goes through Date.UTC rather than the local-time Date constructor.
 * From NZ, parsing "1992-08-13" locally and comparing against a UTC-parsed date is a
 * guaranteed off-by-one, and date matching is the whole point of this feature.
 */

const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const API_PATTERN = /^(\d{2})-(\d{2})-(\d{4})$/
const MS_PER_DAY = 86400000

/**
 * Checks a string is a real calendar date in yyyy-MM-dd form.
 *
 * Round-trips through Date.UTC so impossible dates like 2026-02-31 are rejected
 * rather than silently rolling over into March.
 *
 * @param {string} value - The candidate date string.
 * @returns {boolean} True if value is a valid ISO calendar date.
 */
function isIsoDate (value) {
  const match = ISO_PATTERN.exec(value ?? '')
  if (!match) {
    return false
  }
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

/**
 * Converts an ISO date to the dd-MM-yyyy form the setlist.fm API expects.
 *
 * @param {string} isoDate - A date in yyyy-MM-dd form.
 * @returns {string} The same date in dd-MM-yyyy form.
 * @throws {Error} If isoDate is not a valid ISO calendar date.
 */
function toApiDate (isoDate) {
  if (!isIsoDate(isoDate)) {
    throw new Error(`Not a valid ISO date (expected yyyy-MM-dd): ${isoDate}`)
  }
  const [year, month, day] = isoDate.split('-')
  return `${day}-${month}-${year}`
}

/**
 * Converts a setlist.fm dd-MM-yyyy date to ISO yyyy-MM-dd.
 *
 * Returns the input unchanged when it does not match, so a surprising value from the
 * API surfaces as-is rather than becoming null halfway through a response.
 *
 * @param {string} apiDate - A date in dd-MM-yyyy form.
 * @returns {string} The date in yyyy-MM-dd form, or the input unchanged.
 */
function fromApiDate (apiDate) {
  const match = API_PATTERN.exec(apiDate ?? '')
  if (!match) {
    return apiDate
  }
  const [, day, month, year] = match
  return `${year}-${month}-${day}`
}

/**
 * Extracts the year from an ISO date.
 *
 * @param {string} isoDate - A date in yyyy-MM-dd form.
 * @returns {number|null} The year, or null if the input is not a valid ISO date.
 */
function yearOf (isoDate) {
  return isIsoDate(isoDate) ? Number(isoDate.slice(0, 4)) : null
}

/**
 * Whole days from isoA to isoB, signed. Positive means isoB is later.
 *
 * @param {string} isoA - The earlier date, yyyy-MM-dd.
 * @param {string} isoB - The later date, yyyy-MM-dd.
 * @returns {number|null} Signed day count, or null if either date is invalid.
 */
function daysBetween (isoA, isoB) {
  if (!isIsoDate(isoA) || !isIsoDate(isoB)) {
    return null
  }
  return Math.round((toUtcMs(isoB) - toUtcMs(isoA)) / MS_PER_DAY)
}

/**
 * @param {string} isoDate - A valid ISO date.
 * @returns {number} Milliseconds since epoch at UTC midnight on that date.
 * @private
 */
function toUtcMs (isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year, month - 1, day)
}

export { daysBetween, fromApiDate, isIsoDate, toApiDate, yearOf }
