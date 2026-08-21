import { describe, it, beforeEach, afterEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { SetlistFmClient } from '../../src/services/setlistFmClient.js'
import { RateLimiter } from '../../src/services/rateLimiter.js'
import { TtlCache } from '../../src/services/cache.js'

describe('SetlistFmClient', () => {
  let fetchStub
  let logger
  let limiter
  let client
  let clock

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch')
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    clock = 1000000
    limiter = new RateLimiter({
      name: 'setlist.fm',
      minIntervalMs: 0,
      logger,
      now: () => clock,
      sleep: async ms => { clock += ms }
    })
    client = new SetlistFmClient(logger, {
      limiter,
      searchCache: new TtlCache({ now: () => clock }),
      detailCache: new TtlCache({ now: () => clock }),
      apiKey: 'test-key'
    })
  })

  afterEach(() => {
    fetchStub.restore()
  })

  function resolveBody (body) {
    fetchStub.resolves({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => body
    })
  }

  function resolveStatus (status, statusText) {
    fetchStub.resolves({
      ok: false,
      status,
      statusText,
      headers: { get: () => null },
      text: async () => ''
    })
  }

  describe('authentication', () => {
    it('should send the api key and ask for JSON', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1' })

      expect(fetchStub.firstCall.args[1].headers).to.deep.equal({
        'x-api-key': 'test-key',
        Accept: 'application/json'
      })
    })

    it('should throw a ConfigurationError when no key is set', async () => {
      const keyless = new SetlistFmClient(logger, { limiter })

      try {
        await keyless.searchSetlists({ artistMbid: 'mbid-1' })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('ConfigurationError')
        expect(error.message).to.include('SETLISTFM_API_KEY')
      }
    })

    it('should still be constructible without a key, so the server can start', () => {
      expect(() => new SetlistFmClient(logger, { limiter })).to.not.throw()
    })

    it('should not spend a rate limit slot when the key is missing', async () => {
      const keyless = new SetlistFmClient(logger, { limiter })

      await keyless.searchSetlists({ artistMbid: 'mbid-1' }).catch(() => {})

      expect(limiter.stats().requestsToday).to.equal(0)
    })
  })

  describe('searchSetlists', () => {
    it('should map every supported parameter', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({
        artistMbid: 'mbid-1',
        cityName: 'Wellington',
        countryCode: 'NZ',
        venueName: 'Town Hall',
        tourName: 'Wish Tour',
        year: 1992,
        page: 2
      })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('artistMbid=mbid-1')
      expect(url).to.include('cityName=Wellington')
      expect(url).to.include('countryCode=NZ')
      expect(url).to.include('venueName=Town+Hall')
      expect(url).to.include('tourName=Wish+Tour')
      expect(url).to.include('year=1992')
      expect(url).to.include('p=2')
    })

    it('should convert an ISO date to the dd-MM-yyyy form the API expects', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1', date: '1992-08-13' })

      expect(fetchStub.firstCall.args[0]).to.include('date=13-08-1992')
    })

    it('should omit parameters that were not supplied', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1' })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.not.include('cityName')
      expect(url).to.not.include('date=')
      expect(url).to.not.include('year=')
    })

    it('should return the response envelope', async () => {
      resolveBody({ setlist: [{ id: 'abc' }], total: 1, page: 1, itemsPerPage: 20 })

      expect(await client.searchSetlists({ artistMbid: 'mbid-1' })).to.deep.equal({
        setlist: [{ id: 'abc' }],
        total: 1,
        page: 1,
        itemsPerPage: 20
      })
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.searchSetlists({ artistMbid: 'mbid-1', page: 1 })).to.deep.equal({
        setlist: [],
        total: 0,
        page: 1,
        itemsPerPage: 0
      })
    })

    it('should still throw on a genuine failure', async () => {
      resolveStatus(401, 'Unauthorized')

      try {
        await client.searchSetlists({ artistMbid: 'mbid-1' })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(401)
      }
    })
  })

  describe('getSetlist', () => {
    it('should request the setlist by id', async () => {
      resolveBody({ id: '6bd7ee5e' })

      await client.getSetlist('6bd7ee5e')

      expect(fetchStub.firstCall.args[0]).to.include('/setlist/6bd7ee5e')
    })

    it('should reject an id that is not well formed', async () => {
      try {
        await client.getSetlist('../../etc/passwd')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Not a valid setlist id')
      }
      expect(fetchStub.called).to.be.false
    })

    it('should reject an empty id', async () => {
      try {
        await client.getSetlist('')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Not a valid setlist id')
      }
    })

    it('should propagate a 404, since a missing setlist is a real answer', async () => {
      resolveStatus(404, 'Not Found')

      try {
        await client.getSetlist('nosuchid')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(404)
      }
    })
  })

  describe('caching', () => {
    it('should not refetch an identical search', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1', cityName: 'Wellington' })
      await client.searchSetlists({ artistMbid: 'mbid-1', cityName: 'Wellington' })

      expect(fetchStub.calledOnce).to.be.true
    })

    it('should treat a different parameter as a different search', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1', cityName: 'Wellington' })
      await client.searchSetlists({ artistMbid: 'mbid-1', cityName: 'Auckland' })

      expect(fetchStub.calledTwice).to.be.true
    })

    it('should cache setlist detail separately from searches', async () => {
      resolveBody({ id: '6bd7ee5e' })

      await client.getSetlist('6bd7ee5e')
      await client.getSetlist('6bd7ee5e')

      expect(fetchStub.calledOnce).to.be.true
    })

    it('should consume no rate limit budget on a cache hit', async () => {
      resolveBody({ setlist: [] })

      await client.searchSetlists({ artistMbid: 'mbid-1' })
      await client.searchSetlists({ artistMbid: 'mbid-1' })

      expect(limiter.stats().requestsToday).to.equal(1)
    })
  })
})
