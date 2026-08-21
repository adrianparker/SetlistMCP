import { DailyQuotaExceededError } from './errors.js'

/**
 * Serialises outbound requests and spaces them out, so this server never bursts
 * against an API that would rather it did not.
 *
 * Three deliberate choices:
 *
 * 1. Serialisation is a promise chain rather than an array queue. It gives FIFO order
 *    for free, and re-chaining on a settled promise guarantees one rejected task
 *    cannot wedge the queue - the classic bug in hand-rolled limiters.
 *
 * 2. The interval is tracked as "next allowed at", not "last started at". That makes
 *    penalise() fall out for free, and it means a 429 backs off the whole queue
 *    rather than just the request that happened to receive it. A 429 is a statement
 *    about the client, so letting nine queued requests each rediscover it is wrong.
 *
 * 3. now and sleep are injected. Tests assert on the decision to wait rather than
 *    actually waiting, which keeps the suite fast and deterministic.
 */
class RateLimiter {
  /**
   * @param {Object} options
   * @param {string} options.name - Which API this guards, e.g. 'setlist.fm'.
   * @param {number} [options.minIntervalMs=1100] - Minimum gap between request starts.
   * @param {number|null} [options.dailyLimit=null] - Per-process request budget, or null for none.
   * @param {Object} [options.logger] - Logger with debug/info/warn/error.
   * @param {() => number} [options.now] - Clock, injected for tests.
   * @param {(ms: number) => Promise<void>} [options.sleep] - Delay, injected for tests.
   */
  constructor ({
    name,
    minIntervalMs = 1100,
    dailyLimit = null,
    logger,
    now = () => Date.now(),
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    this.name = name
    this.minIntervalMs = minIntervalMs
    this.dailyLimit = dailyLimit
    this.logger = logger
    this.now = now
    this.sleep = sleep

    this.nextAllowedAt = 0
    this.chain = Promise.resolve()
    this.pending = 0
    this.requestsToday = 0
    this.dayKey = this.currentDayKey()
  }

  /**
   * Queues a task, running it once the interval and budget allow.
   *
   * @param {() => Promise<*>} task - The work to run, typically a fetch.
   * @returns {Promise<*>} Whatever task resolves to.
   * @throws {DailyQuotaExceededError} If the per-process budget is exhausted.
   */
  async schedule (task) {
    this.pending += 1
    const run = this.chain.then(() => this.runOne(task))
    // Swallow settlement on the chain itself so a failed task never blocks the queue.
    this.chain = run.then(() => undefined, () => undefined)
    try {
      return await run
    } finally {
      this.pending -= 1
    }
  }

  /**
   * Delays the whole queue, e.g. after a 429 or a Retry-After header.
   *
   * @param {number} ms - How long to hold off, from now.
   * @returns {void}
   */
  penalise (ms) {
    if (!(ms > 0)) {
      return
    }
    this.nextAllowedAt = Math.max(this.nextAllowedAt, this.now() + ms)
    this.logger?.warn(`${this.name}: backing off ${ms}ms`)
  }

  /**
   * @returns {Object} Current limiter state, for logging and diagnostics.
   */
  stats () {
    this.rollDayIfNeeded()
    return {
      name: this.name,
      requestsToday: this.requestsToday,
      dailyLimit: this.dailyLimit,
      day: this.dayKey,
      pending: this.pending,
      nextAllowedAt: this.nextAllowedAt
    }
  }

  /**
   * Runs one task, having acquired its place in the queue.
   *
   * @param {() => Promise<*>} task - The work to run.
   * @returns {Promise<*>} Whatever task resolves to.
   * @private
   */
  async runOne (task) {
    this.rollDayIfNeeded()
    if (this.dailyLimit !== null && this.requestsToday >= this.dailyLimit) {
      throw new DailyQuotaExceededError(this.name, this.dailyLimit)
    }

    const wait = this.nextAllowedAt - this.now()
    if (wait > 0) {
      this.logger?.debug(`${this.name}: waiting ${wait}ms for a slot`)
      await this.sleep(wait)
    }

    this.nextAllowedAt = this.now() + this.minIntervalMs
    this.requestsToday += 1
    return task()
  }

  /**
   * Resets the counter when the UTC day changes.
   *
   * @returns {void}
   * @private
   */
  rollDayIfNeeded () {
    const today = this.currentDayKey()
    if (today !== this.dayKey) {
      this.logger?.info(`${this.name}: ${this.requestsToday} requests on ${this.dayKey}`)
      this.dayKey = today
      this.requestsToday = 0
    }
  }

  /**
   * @returns {string} The current UTC date as yyyy-MM-dd.
   * @private
   */
  currentDayKey () {
    return new Date(this.now()).toISOString().slice(0, 10)
  }
}

export { RateLimiter }
