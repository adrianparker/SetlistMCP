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
      countriesCache: new TtlCache({ now: () => clock }),
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

  describe('getSetlistVersion', () => {
    it('should request the version by id', async () => {
      resolveBody({ id: 'abc123', versionId: 'version1' })

      await client.getSetlistVersion('version1')

      expect(fetchStub.firstCall.args[0]).to.include('/setlist/version/version1')
    })

    it('should reject an id that is not well formed', async () => {
      try {
        await client.getSetlistVersion('../../etc/passwd')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.message).to.include('Not a valid setlist version id')
      }
      expect(fetchStub.called).to.be.false
    })

    it('should propagate a 404, since a missing version is a real answer', async () => {
      resolveStatus(404, 'Not Found')

      try {
        await client.getSetlistVersion('nosuchid')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(404)
      }
    })
  })

  describe('getArtist', () => {
    it('should request the artist by mbid', async () => {
      resolveBody({ mbid: 'mbid-1', name: 'The Cure' })

      await client.getArtist('mbid-1')

      expect(fetchStub.firstCall.args[0]).to.include('/artist/mbid-1')
    })

    it('should propagate a 404', async () => {
      resolveStatus(404, 'Not Found')

      try {
        await client.getArtist('nosuchmbid')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(404)
      }
    })
  })

  describe('searchArtists', () => {
    it('should map every supported parameter', async () => {
      resolveBody({ artist: [] })

      await client.searchArtists({ artistName: 'The Cure', artistMbid: 'mbid-1', sort: 'relevance', page: 2 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('artistName=The+Cure')
      expect(url).to.include('artistMbid=mbid-1')
      expect(url).to.include('sort=relevance')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.searchArtists({ artistName: 'Obscure' })).to.deep.equal({
        artist: [], total: 0, page: 1, itemsPerPage: 0
      })
    })

    it('should still throw on a genuine failure', async () => {
      resolveStatus(401, 'Unauthorized')

      try {
        await client.searchArtists({ artistName: 'The Cure' })
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(401)
      }
    })
  })

  describe('getArtistSetlists', () => {
    it('should request the artist\'s setlists', async () => {
      resolveBody({ setlist: [] })

      await client.getArtistSetlists('mbid-1', { page: 3 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('/artist/mbid-1/setlists')
      expect(url).to.include('p=3')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.getArtistSetlists('mbid-1')).to.deep.equal({
        setlist: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })

  describe('getVenue', () => {
    it('should request the venue by id', async () => {
      resolveBody({ id: 'venue-1', name: 'Town Hall' })

      await client.getVenue('venue-1')

      expect(fetchStub.firstCall.args[0]).to.include('/venue/venue-1')
    })

    it('should propagate a 404', async () => {
      resolveStatus(404, 'Not Found')

      try {
        await client.getVenue('nosuchvenue')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(404)
      }
    })
  })

  describe('getVenueSetlists', () => {
    it('should request the venue\'s setlists', async () => {
      resolveBody({ setlist: [] })

      await client.getVenueSetlists('venue-1', { page: 2 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('/venue/venue-1/setlists')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.getVenueSetlists('venue-1')).to.deep.equal({
        setlist: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })

  describe('searchVenues', () => {
    it('should map every supported parameter', async () => {
      resolveBody({ venue: [] })

      await client.searchVenues({
        name: 'Town Hall', cityName: 'Wellington', cityId: 'city-1', country: 'New Zealand', state: 'Wellington', stateCode: 'WGN', page: 2
      })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('name=Town+Hall')
      expect(url).to.include('cityName=Wellington')
      expect(url).to.include('cityId=city-1')
      expect(url).to.include('country=New+Zealand')
      expect(url).to.include('state=Wellington')
      expect(url).to.include('stateCode=WGN')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.searchVenues({ name: 'Obscure' })).to.deep.equal({
        venue: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })

  describe('getCity', () => {
    it('should request the city by geoId', async () => {
      resolveBody({ id: 'city-1', name: 'Wellington' })

      await client.getCity('city-1')

      expect(fetchStub.firstCall.args[0]).to.include('/city/city-1')
    })

    it('should propagate a 404', async () => {
      resolveStatus(404, 'Not Found')

      try {
        await client.getCity('nosuchcity')
        expect.fail('Should have thrown an error')
      } catch (error) {
        expect(error.status).to.equal(404)
      }
    })
  })

  describe('searchCities', () => {
    it('should map every supported parameter', async () => {
      resolveBody({ cities: [] })

      await client.searchCities({ name: 'Wellington', country: 'New Zealand', state: 'Wellington', stateCode: 'WGN', page: 2 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('name=Wellington')
      expect(url).to.include('country=New+Zealand')
      expect(url).to.include('state=Wellington')
      expect(url).to.include('stateCode=WGN')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.searchCities({ name: 'Obscure' })).to.deep.equal({
        cities: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })

  describe('searchCountries', () => {
    it('should walk every page and merge the results', async () => {
      fetchStub.onCall(0).resolves({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ country: [{ code: 'NZ', name: 'New Zealand' }], total: 2, page: 1, itemsPerPage: 1 })
      })
      fetchStub.onCall(1).resolves({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => null },
        json: async () => ({ country: [{ code: 'AU', name: 'Australia' }], total: 2, page: 2, itemsPerPage: 1 })
      })

      const result = await client.searchCountries()

      expect(fetchStub.callCount).to.equal(2)
      expect(result.country).to.deep.equal([{ code: 'NZ', name: 'New Zealand' }, { code: 'AU', name: 'Australia' }])
      expect(result.total).to.equal(2)
    })

    it('should cache the merged result', async () => {
      resolveBody({ country: [{ code: 'NZ', name: 'New Zealand' }], total: 1, page: 1, itemsPerPage: 1 })

      await client.searchCountries()
      await client.searchCountries()

      expect(fetchStub.calledOnce).to.be.true
    })

    it('should stop paging once a page comes back empty', async () => {
      resolveBody({ country: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await client.searchCountries()

      expect(fetchStub.calledOnce).to.be.true
      expect(result.country).to.deep.equal([])
    })
  })

  describe('getUserAttended', () => {
    it('should request the user\'s attended setlists', async () => {
      resolveBody({ setlist: [] })

      await client.getUserAttended('someuser', { page: 2 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('/user/someuser/attended')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.getUserAttended('someuser')).to.deep.equal({
        setlist: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })

  describe('getUserEdited', () => {
    it('should request the user\'s edited setlists', async () => {
      resolveBody({ setlist: [] })

      await client.getUserEdited('someuser', { page: 2 })

      const url = fetchStub.firstCall.args[0]
      expect(url).to.include('/user/someuser/edited')
      expect(url).to.include('p=2')
    })

    it('should treat a 404 as no matches rather than an error', async () => {
      resolveStatus(404, 'Not Found')

      expect(await client.getUserEdited('someuser')).to.deep.equal({
        setlist: [], total: 0, page: 1, itemsPerPage: 0
      })
    })
  })
})
