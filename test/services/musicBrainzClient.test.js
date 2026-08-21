import { describe, it, beforeEach, afterEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { MusicBrainzClient } from '../../src/services/musicBrainzClient.js'
import { RateLimiter } from '../../src/services/rateLimiter.js'
import { TtlCache } from '../../src/services/cache.js'

describe('MusicBrainzClient', () => {
  let fetchStub
  let logger
  let limiter
  let cache
  let client
  let clock

  beforeEach(() => {
    fetchStub = sinon.stub(global, 'fetch')
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    clock = 1000000
    limiter = new RateLimiter({
      name: 'musicbrainz',
      minIntervalMs: 0,
      logger,
      now: () => clock,
      sleep: async ms => { clock += ms }
    })
    cache = new TtlCache({ now: () => clock })
    client = new MusicBrainzClient(logger, {
      limiter,
      cache,
      contact: 'test@example.com',
      version: '1.2.3'
    })
  })

  afterEach(() => {
    fetchStub.restore()
  })

  function resolveArtists (artists) {
    fetchStub.resolves({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => null },
      json: async () => ({ created: '2026-08-21', count: artists.length, offset: 0, artists })
    })
  }

  describe('request shape', () => {
    it('should send a User-Agent with the version and contact detail', async () => {
      resolveArtists([])

      await client.searchArtist('The Cure')

      expect(fetchStub.firstCall.args[1].headers['User-Agent'])
        .to.match(/^setlist-mcp\/1\.2\.3 \( test@example\.com \)$/)
    })

    it('should fall back to the repository URL when no contact is configured', () => {
      const fallbackClient = new MusicBrainzClient(logger, { limiter, version: '1.2.3' })

      expect(fallbackClient.userAgent).to.include('github.com/adrianparker/setlist-mcp')
      expect(logger.warn.called).to.be.true
    })

    it('should query the artist resource as JSON', async () => {
      resolveArtists([])

      await client.searchArtist('The Cure')

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('/ws/2/artist')
      expect(url).to.include('query=The+Cure')
      expect(url).to.include('fmt=json')
      expect(url).to.include('limit=5')
    })

    it('should encode names with special characters', async () => {
      resolveArtists([])

      await client.searchArtist('AC/DC')

      expect(fetchStub.firstCall.args[0]).to.include('query=AC%2FDC')
    })
  })

  describe('result mapping', () => {
    it('should return the top match with its mbid', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', 'sort-name': 'Cure, The', score: 100 }])

      expect(await client.searchArtist('The Cure')).to.deep.include({
        name: 'The Cure',
        mbid: 'mbid-1',
        score: 100
      })
    })

    it('should read sort-name, which is hyphenated in the MusicBrainz JSON', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', 'sort-name': 'Cure, The', score: 100 }])

      expect((await client.searchArtist('The Cure')).sortName).to.equal('Cure, The')
    })

    it('should null sortName when the field is absent', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'Nameless', score: 100 }])

      expect((await client.searchArtist('Nameless')).sortName).to.be.null
    })

    it('should null disambiguation when absent, since MusicBrainz omits it', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', score: 100 }])

      expect((await client.searchArtist('The Cure')).disambiguation).to.be.null
    })

    it('should return credible alternatives so the caller can disambiguate', async () => {
      resolveArtists([
        { id: 'mbid-1', name: 'Villainy', score: 100 },
        { id: 'mbid-2', name: 'Villainy', score: 95, disambiguation: 'NZ rock band' },
        // A different band, far enough behind not to be worth raising
        { id: 'mbid-3', name: 'The Villainy', score: 80 }
      ])

      const result = await client.searchArtist('Villainy')

      expect(result.alternatives).to.have.lengthOf(1)
      expect(result.alternatives[0]).to.deep.equal({
        name: 'Villainy',
        mbid: 'mbid-2',
        disambiguation: 'NZ rock band',
        score: 95
      })
    })

    it('should drop low-scoring alternatives', async () => {
      resolveArtists([
        { id: 'mbid-1', name: 'Villainy', score: 100 },
        { id: 'mbid-2', name: 'Vinny Villany', score: 40 }
      ])

      expect((await client.searchArtist('Villainy')).alternatives).to.deep.equal([])
    })

    it('should not offer alternatives that are far behind a decisive match', async () => {
      // The real shape of a "Prince" search: a perfect match plus unrelated acts
      resolveArtists([
        { id: 'mbid-prince', name: 'Prince', score: 100 },
        { id: 'mbid-bobby', name: 'Bobby Prince', score: 78, disambiguation: 'video game composer' },
        { id: 'mbid-bonnie', name: 'Bonnie "Prince" Billy', score: 72 }
      ])

      expect((await client.searchArtist('Prince')).alternatives).to.deep.equal([])
    })

    it('should still offer alternatives when the match is genuinely ambiguous', async () => {
      resolveArtists([
        { id: 'mbid-1', name: 'Villainy', score: 100 },
        { id: 'mbid-2', name: 'Villainy', score: 100, disambiguation: 'NZ rock band' }
      ])

      expect((await client.searchArtist('Villainy')).alternatives).to.have.lengthOf(1)
    })

    it('should cap the number of alternatives', async () => {
      resolveArtists([
        { id: 'a', name: 'A', score: 100 },
        { id: 'b', name: 'B', score: 99 },
        { id: 'c', name: 'C', score: 98 },
        { id: 'd', name: 'D', score: 97 },
        { id: 'e', name: 'E', score: 96 }
      ])

      expect((await client.searchArtist('A')).alternatives).to.have.lengthOf(3)
    })

    it('should return null when nothing matches', async () => {
      resolveArtists([])

      expect(await client.searchArtist('Not A Real Band At All')).to.be.null
    })

    it('should return null when the artists field is missing entirely', async () => {
      fetchStub.resolves({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({})
      })

      expect(await client.searchArtist('Anything')).to.be.null
    })
  })

  describe('caching', () => {
    it('should not refetch a name it has already resolved', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', score: 100 }])

      await client.searchArtist('The Cure')
      await client.searchArtist('The Cure')

      expect(fetchStub.calledOnce).to.be.true
    })

    it('should consume no rate limit budget on a cache hit', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', score: 100 }])

      await client.searchArtist('The Cure')
      await client.searchArtist('The Cure')

      expect(limiter.stats().requestsToday).to.equal(1)
    })

    it('should treat names differing only by case or whitespace as the same', async () => {
      resolveArtists([{ id: 'mbid-1', name: 'The Cure', score: 100 }])

      await client.searchArtist('The Cure')
      await client.searchArtist('  the cure  ')

      expect(fetchStub.calledOnce).to.be.true
    })

    it('should cache a negative result so a typo is not retried repeatedly', async () => {
      resolveArtists([])

      await client.searchArtist('Nonexistent')
      await client.searchArtist('Nonexistent')

      expect(fetchStub.calledOnce).to.be.true
    })
  })

  describe('errors', () => {
    it('should retry a 503, which is how MusicBrainz signals throttling', async () => {
      fetchStub.onFirstCall().resolves({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: { get: () => null },
        text: async () => ''
      })
      fetchStub.onSecondCall().resolves({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ artists: [{ id: 'mbid-1', name: 'The Cure', score: 100 }] })
      })

      expect((await client.searchArtist('The Cure')).mbid).to.equal('mbid-1')
    })

    it('should throw on a non-retryable HTTP failure', async () => {
      fetchStub.resolves({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => null },
        text: async () => ''
      })

      try {
        await client.searchArtist('The Cure')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.name).to.equal('HttpError')
        expect(error.status).to.equal(400)
      }
    })
  })
})
