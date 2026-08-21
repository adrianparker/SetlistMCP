import { describe, it, beforeEach, afterEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { parseRetryAfter, requestJson } from '../../src/services/httpJson.js'
import { RateLimiter } from '../../src/services/rateLimiter.js'

/**
 * Builds a minimal fetch Response double. Only the fields the code touches are
 * present, matching the inline-literal style used across these tests.
 */
function fakeResponse ({ ok = true, status = 200, statusText = 'OK', body = {}, headers = {}, text } = {}) {
  return {
    ok,
    status,
    statusText,
    headers: { get: name => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: text ?? (async () => JSON.stringify(body))
  }
}

describe('parseRetryAfter', () => {
  it('should parse the delta-seconds form', () => {
    expect(parseRetryAfter('120')).to.equal(120000)
  })

  it('should parse the HTTP-date form relative to now', () => {
    const now = Date.parse('2026-08-21T10:00:00Z')
    expect(parseRetryAfter('Fri, 21 Aug 2026 10:00:30 GMT', now)).to.equal(30000)
  })

  it('should clamp a past HTTP-date to zero', () => {
    const now = Date.parse('2026-08-21T10:00:00Z')
    expect(parseRetryAfter('Fri, 21 Aug 2026 09:59:00 GMT', now)).to.equal(0)
  })

  it('should return null for missing or unparseable values', () => {
    expect(parseRetryAfter(null)).to.be.null
    expect(parseRetryAfter(undefined)).to.be.null
    expect(parseRetryAfter('')).to.be.null
    expect(parseRetryAfter('soonish')).to.be.null
  })

  it('should tolerate surrounding whitespace', () => {
    expect(parseRetryAfter('  60  ')).to.equal(60000)
  })
})

describe('requestJson', () => {
  let fetchStub
  let limiter
  let logger
  let clock

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch')
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    clock = 1000000
    limiter = new RateLimiter({
      name: 'test',
      minIntervalMs: 0,
      logger,
      now: () => clock,
      sleep: async ms => { clock += ms }
    })
  })

  afterEach(() => {
    fetchStub.restore()
  })

  function call (overrides = {}) {
    return requestJson({
      url: 'https://api.example.com/thing',
      limiter,
      logger,
      label: 'Example',
      backoffBaseMs: 1000,
      ...overrides
    })
  }

  describe('success', () => {
    it('should return the parsed body', async () => {
      fetchStub.resolves(fakeResponse({ body: { id: 'abc' } }))

      expect(await call()).to.deep.equal({ id: 'abc' })
    })

    it('should pass the supplied headers through', async () => {
      fetchStub.resolves(fakeResponse())

      await call({ headers: { 'x-api-key': 'secret', Accept: 'application/json' } })

      expect(fetchStub.firstCall.args[1].headers).to.deep.equal({
        'x-api-key': 'secret',
        Accept: 'application/json'
      })
    })

    it('should attach an abort signal so a hung connection cannot stall the server', async () => {
      fetchStub.resolves(fakeResponse())

      await call()

      expect(fetchStub.firstCall.args[1].signal).to.exist
      expect(fetchStub.firstCall.args[1].signal.aborted).to.be.false
    })

    it('should log the request before making it', async () => {
      fetchStub.resolves(fakeResponse())

      await call()

      expect(logger.info.calledWith('Example API Request: GET https://api.example.com/thing')).to.be.true
    })

    it('should go through the rate limiter', async () => {
      const schedule = sinon.spy(limiter, 'schedule')
      fetchStub.resolves(fakeResponse())

      await call()

      expect(schedule.calledOnce).to.be.true
    })
  })

  describe('retryable statuses', () => {
    it('should retry a 429 and return the eventual success', async () => {
      fetchStub.onFirstCall().resolves(fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests' }))
      fetchStub.onSecondCall().resolves(fakeResponse({ body: { id: 'abc' } }))

      expect(await call()).to.deep.equal({ id: 'abc' })
      expect(fetchStub.callCount).to.equal(2)
    })

    it('should honour Retry-After when the server sends one', async () => {
      const penalise = sinon.spy(limiter, 'penalise')
      fetchStub.onFirstCall().resolves(fakeResponse({
        ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '5' }
      }))
      fetchStub.onSecondCall().resolves(fakeResponse())

      await call()

      expect(penalise.firstCall.args[0]).to.equal(5000)
    })

    it('should back off the whole queue rather than just the failed request', async () => {
      const penalise = sinon.spy(limiter, 'penalise')
      fetchStub.onFirstCall().resolves(fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests' }))
      fetchStub.onSecondCall().resolves(fakeResponse())

      await call()

      expect(penalise.called).to.be.true
    })

    it('should retry a MusicBrainz 503, which is how it signals throttling', async () => {
      fetchStub.onFirstCall().resolves(fakeResponse({ ok: false, status: 503, statusText: 'Service Unavailable' }))
      fetchStub.onSecondCall().resolves(fakeResponse({ body: { artists: [] } }))

      expect(await call({ label: 'MusicBrainz' })).to.deep.equal({ artists: [] })
    })

    it('should clamp an absurd Retry-After to the backoff ceiling', async () => {
      const penalise = sinon.spy(limiter, 'penalise')
      fetchStub.onFirstCall().resolves(fakeResponse({
        ok: false, status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '99999' }
      }))
      fetchStub.onSecondCall().resolves(fakeResponse())

      await call({ maxBackoffMs: 30000 })

      expect(penalise.firstCall.args[0]).to.equal(30000)
    })

    it('should give up after maxAttempts and name the count', async () => {
      fetchStub.resolves(fakeResponse({ ok: false, status: 429, statusText: 'Too Many Requests' }))

      try {
        await call({ maxAttempts: 3 })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('HttpError')
        expect(error.status).to.equal(429)
        expect(error.message).to.include('3 attempts')
      }
      expect(fetchStub.callCount).to.equal(3)
    })
  })

  describe('non-retryable failures', () => {
    it('should throw immediately on a 401 without retrying', async () => {
      fetchStub.resolves(fakeResponse({ ok: false, status: 401, statusText: 'Unauthorized' }))

      try {
        await call()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('HttpError')
        expect(error.status).to.equal(401)
        expect(error.message).to.include('Example API error: 401 Unauthorized')
      }
      expect(fetchStub.calledOnce).to.be.true
    })

    it('should carry the request url and a body snippet on the error', async () => {
      fetchStub.resolves(fakeResponse({
        ok: false, status: 403, statusText: 'Forbidden', text: async () => 'quota exceeded'
      }))

      try {
        await call()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.url).to.equal('https://api.example.com/thing')
        expect(error.body).to.equal('quota exceeded')
      }
    })

    it('should surface a malformed success body as HttpError, not SyntaxError', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => { throw new SyntaxError('Unexpected token <') }
      })

      try {
        await call()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('HttpError')
        expect(error.message).to.include('not valid JSON')
      }
    })
  })

  describe('timeouts', () => {
    it('should retry a timeout and succeed on a later attempt', async () => {
      const timeout = new Error('timed out')
      timeout.name = 'TimeoutError'
      fetchStub.onFirstCall().rejects(timeout)
      fetchStub.onSecondCall().resolves(fakeResponse({ body: { id: 'abc' } }))

      expect(await call()).to.deep.equal({ id: 'abc' })
    })

    it('should throw TimeoutError once attempts are exhausted', async () => {
      const timeout = new Error('timed out')
      timeout.name = 'TimeoutError'
      fetchStub.rejects(timeout)

      try {
        await call({ maxAttempts: 2, timeoutMs: 10000 })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('TimeoutError')
        expect(error.message).to.include('10000ms')
      }
    })

    it('should not retry an unrelated network error', async () => {
      fetchStub.rejects(new Error('ECONNREFUSED'))

      try {
        await call()
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.equal('ECONNREFUSED')
      }
      expect(fetchStub.calledOnce).to.be.true
    })
  })
})
