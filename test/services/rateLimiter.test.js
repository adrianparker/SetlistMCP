import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { RateLimiter } from '../../src/services/rateLimiter.js'

describe('RateLimiter', () => {
  let clock
  let now
  let sleep
  let logger

  /**
   * Builds a limiter on a fake clock. sleep advances the clock rather than waiting,
   * so the tests assert on the decision to wait without any real delay.
   */
  function makeLimiter (options = {}) {
    return new RateLimiter({ name: 'test', logger, now, sleep, ...options })
  }

  beforeEach(() => {
    clock = 1000000
    now = () => clock
    sleep = sinon.stub().callsFake(async ms => { clock += ms })
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
  })

  describe('interval spacing', () => {
    it('should not delay the first request', async () => {
      const limiter = makeLimiter({ minIntervalMs: 1100 })

      await limiter.schedule(async () => 'first')

      expect(sleep.called).to.be.false
    })

    it('should wait the minimum interval before a back-to-back request', async () => {
      const limiter = makeLimiter({ minIntervalMs: 1100 })

      await limiter.schedule(async () => 'first')
      await limiter.schedule(async () => 'second')

      expect(sleep.calledOnce).to.be.true
      expect(sleep.firstCall.args[0]).to.equal(1100)
    })

    it('should not delay a request made after the interval has already elapsed', async () => {
      const limiter = makeLimiter({ minIntervalMs: 1100 })

      await limiter.schedule(async () => 'first')
      clock += 5000
      await limiter.schedule(async () => 'second')

      expect(sleep.called).to.be.false
    })

    it('should space a burst of requests evenly', async () => {
      const limiter = makeLimiter({ minIntervalMs: 1100 })

      await Promise.all([
        limiter.schedule(async () => 'a'),
        limiter.schedule(async () => 'b'),
        limiter.schedule(async () => 'c')
      ])

      expect(sleep.callCount).to.equal(2)
      expect(sleep.getCall(0).args[0]).to.equal(1100)
      expect(sleep.getCall(1).args[0]).to.equal(1100)
    })

    it('should return the task result', async () => {
      const limiter = makeLimiter()

      expect(await limiter.schedule(async () => ({ ok: true }))).to.deep.equal({ ok: true })
    })
  })

  describe('serialisation', () => {
    it('should run queued tasks in order', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })
      const order = []

      await Promise.all([
        limiter.schedule(async () => { order.push('a') }),
        limiter.schedule(async () => { order.push('b') }),
        limiter.schedule(async () => { order.push('c') })
      ])

      expect(order).to.deep.equal(['a', 'b', 'c'])
    })

    it('should not run tasks concurrently', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })
      let active = 0
      let maxActive = 0

      const task = async () => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await Promise.resolve()
        active -= 1
      }

      await Promise.all([limiter.schedule(task), limiter.schedule(task), limiter.schedule(task)])

      expect(maxActive).to.equal(1)
    })

    it('should keep serving the queue after a task rejects', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })

      const failing = limiter.schedule(async () => { throw new Error('boom') })
      const following = limiter.schedule(async () => 'survived')

      try {
        await failing
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.equal('boom')
      }
      expect(await following).to.equal('survived')
    })

    it('should propagate a task rejection to its own caller only', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })
      const results = await Promise.allSettled([
        limiter.schedule(async () => { throw new Error('boom') }),
        limiter.schedule(async () => 'fine')
      ])

      expect(results[0].status).to.equal('rejected')
      expect(results[1].status).to.equal('fulfilled')
      expect(results[1].value).to.equal('fine')
    })
  })

  describe('penalise', () => {
    it('should delay subsequent queued tasks, not just the caller', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })

      await limiter.schedule(async () => 'first')
      limiter.penalise(30000)
      await limiter.schedule(async () => 'second')

      expect(sleep.calledOnce).to.be.true
      expect(sleep.firstCall.args[0]).to.equal(30000)
    })

    it('should take the longer of an existing wait and a new penalty', async () => {
      const limiter = makeLimiter({ minIntervalMs: 60000 })

      await limiter.schedule(async () => 'first')
      limiter.penalise(1000)
      await limiter.schedule(async () => 'second')

      expect(sleep.firstCall.args[0]).to.equal(60000)
    })

    it('should ignore a zero or negative penalty', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0 })

      await limiter.schedule(async () => 'first')
      limiter.penalise(0)
      limiter.penalise(-500)
      await limiter.schedule(async () => 'second')

      expect(sleep.called).to.be.false
    })
  })

  describe('daily budget', () => {
    it('should throw once the budget is exhausted', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0, dailyLimit: 2 })

      await limiter.schedule(async () => 'one')
      await limiter.schedule(async () => 'two')

      try {
        await limiter.schedule(async () => 'three')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('DailyQuotaExceededError')
        expect(error.message).to.include('budget of 2')
      }
    })

    it('should not run the task when the budget is exhausted', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0, dailyLimit: 1 })
      const task = sinon.stub().resolves('ran')

      await limiter.schedule(task)
      await limiter.schedule(task).catch(() => {})

      expect(task.calledOnce).to.be.true
    })

    it('should reset the counter when the UTC day changes', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0, dailyLimit: 1 })

      await limiter.schedule(async () => 'day one')
      clock += 86400000

      expect(await limiter.schedule(async () => 'day two')).to.equal('day two')
      expect(limiter.stats().requestsToday).to.equal(1)
    })

    it('should never cap when dailyLimit is null', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0, dailyLimit: null })

      for (let i = 0; i < 50; i += 1) {
        await limiter.schedule(async () => i)
      }

      expect(limiter.stats().requestsToday).to.equal(50)
    })
  })

  describe('stats', () => {
    it('should report the limiter name, usage and budget', async () => {
      const limiter = makeLimiter({ minIntervalMs: 0, dailyLimit: 100 })

      await limiter.schedule(async () => 'one')

      expect(limiter.stats()).to.include({
        name: 'test',
        requestsToday: 1,
        dailyLimit: 100,
        pending: 0
      })
    })
  })
})
