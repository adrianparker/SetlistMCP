/**
 * A small TTL cache, keyed by request URL or a normalised parameter object.
 *
 * The point is rate limit relief rather than speed: for the "which gig was that?"
 * workflow the model re-queries the same artist several times in a conversation, and
 * a cache hit costs no request budget at all. Lookups happen before the rate limiter,
 * so a hit consumes no slot and waits for nothing.
 *
 * In-memory only, so it resets whenever the MCP client restarts the server.
 */
class TtlCache {
  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs=3600000] - How long an entry stays fresh.
   * @param {number} [options.maxEntries=500] - Cap before the oldest entry is evicted.
   * @param {() => number} [options.now] - Clock, injected so tests need not sleep.
   */
  constructor ({ ttlMs = 3600000, maxEntries = 500, now = () => Date.now() } = {}) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
    this.now = now
    this.entries = new Map()
  }

  /**
   * @param {string} key - The cache key.
   * @returns {*} The cached value, or undefined on a miss or expiry.
   */
  get (key) {
    const entry = this.entries.get(key)
    if (!entry) {
      return undefined
    }
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  /**
   * Stores a value, evicting the oldest entry if the cache is full.
   *
   * @param {string} key - The cache key.
   * @param {*} value - The value to store.
   * @returns {void}
   */
  set (key, value) {
    // Re-inserting must refresh insertion order, or an often-updated key would still
    // be evicted as though it were the oldest.
    this.entries.delete(key)
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs })
  }

  /**
   * @param {string} key - The cache key.
   * @returns {boolean} True if the key is present and unexpired.
   */
  has (key) {
    return this.get(key) !== undefined
  }

  /**
   * @param {string} key - The cache key.
   * @returns {boolean} True if an entry was removed.
   */
  delete (key) {
    return this.entries.delete(key)
  }

  /** @returns {void} */
  clear () {
    this.entries.clear()
  }

  /** @returns {number} Entry count, including any not yet evicted expired ones. */
  get size () {
    return this.entries.size
  }
}

export { TtlCache }
