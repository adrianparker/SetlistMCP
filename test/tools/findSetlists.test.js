import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildFindSetlistsTool, FIND_SETLISTS_OUTPUT } from '../../src/tools/findSetlists.js'
import { ConfigurationError } from '../../src/services/errors.js'

/**
 * Builds a setlist.fm search result, trimmed to what the parser reads.
 */
function setlistFixture ({ id, eventDate, city = 'Wellington', venue = 'Wellington Town Hall', songs = 3 }) {
  return {
    id,
    eventDate,
    url: `https://www.setlist.fm/setlist/${id}.html`,
    artist: { mbid: 'mbid-cure', name: 'The Cure' },
    venue: { name: venue, city: { name: city, country: { code: 'NZ', name: 'New Zealand' } } },
    sets: { set: [{ song: Array.from({ length: songs }, (_, i) => ({ name: `Song ${i + 1}` })) }] }
  }
}

describe('find_setlists', () => {
  let musicBrainz
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    musicBrainz = { searchArtist: sinon.stub() }
    setlistFm = { searchSetlists: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildFindSetlistsTool({ musicBrainz, setlistFm, logger }).handler

    musicBrainz.searchArtist.resolves({
      name: 'The Cure',
      mbid: 'mbid-cure',
      disambiguation: null,
      alternatives: []
    })
  })

  describe('tool definition', () => {
    it('should be named find_setlists and flagged read-only', () => {
      const tool = buildFindSetlistsTool({ musicBrainz, setlistFm, logger })

      expect(tool.name).to.equal('find_setlists')
      expect(tool.config.annotations).to.include({ readOnlyHint: true })
    })
  })

  describe('happy path', () => {
    beforeEach(() => {
      setlistFm.searchSetlists.resolves({
        setlist: [setlistFixture({ id: 'abc123', eventDate: '13-08-1992' })],
        total: 1,
        page: 1,
        itemsPerPage: 20
      })
    })

    it('should resolve the artist then search by mbid', async () => {
      await handler({ artist: 'The Cure', city: 'Wellington', date: '1992-08-13' })

      expect(musicBrainz.searchArtist.calledWith('The Cure')).to.be.true
      expect(setlistFm.searchSetlists.firstCall.args[0].artistMbid).to.equal('mbid-cure')
    })

    it('should query the exact date first when one is given', async () => {
      await handler({ artist: 'The Cure', city: 'Wellington', date: '1992-08-13' })

      expect(setlistFm.searchSetlists.firstCall.args[0].date).to.equal('1992-08-13')
    })

    it('should take just one search when the exact date hits', async () => {
      await handler({ artist: 'The Cure', city: 'Wellington', date: '1992-08-13' })

      expect(setlistFm.searchSetlists.calledOnce).to.be.true
    })

    it('should omit the city from the exact-date query, so a wrong city cannot hide a match', async () => {
      await handler({ artist: 'The Cure', city: 'Lower Hutt', date: '1992-08-13' })

      expect(setlistFm.searchSetlists.firstCall.args[0].cityName).to.equal(undefined)
    })

    it('should search the year when only a year is given', async () => {
      setlistFm.searchSetlists.resetHistory()

      await handler({ artist: 'The Cure', city: 'Wellington', year: 1992 })

      expect(setlistFm.searchSetlists.firstCall.args[0]).to.include({
        year: 1992,
        cityName: 'Wellington'
      })
      expect(setlistFm.searchSetlists.firstCall.args[0].date).to.equal(undefined)
    })

    it('should return structured content that satisfies the output schema', async () => {
      const result = await handler({ artist: 'The Cure', city: 'Wellington', date: '1992-08-13' })

      expect(() => FIND_SETLISTS_OUTPUT.parse(result.structuredContent)).to.not.throw()
    })

    it('should normalise event dates to ISO', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-13' })

      expect(result.structuredContent.setlists[0].eventDate).to.equal('1992-08-13')
    })

    it('should flag an exact date match', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-13' })

      expect(result.structuredContent.setlists[0]).to.include({
        exactDateMatch: true,
        daysFromRequestedDate: 0
      })
    })

    it('should include a readable text block alongside the structured data', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-13' })

      expect(result.content[0].text).to.include('The Cure')
      expect(result.content[0].text).to.include('abc123')
      expect(result.isError).to.equal(undefined)
    })

    it('should skip the artist lookup when an mbid is supplied', async () => {
      await handler({ artist: 'The Cure', artistMbid: 'mbid-known', date: '1992-08-13' })

      expect(musicBrainz.searchArtist.called).to.be.false
      expect(setlistFm.searchSetlists.firstCall.args[0].artistMbid).to.equal('mbid-known')
    })
  })

  describe('date ranking', () => {
    beforeEach(() => {
      setlistFm.searchSetlists.resolves({
        setlist: [
          setlistFixture({ id: 'far', eventDate: '20-08-1992' }),
          setlistFixture({ id: 'exact', eventDate: '13-08-1992' }),
          setlistFixture({ id: 'near', eventDate: '14-08-1992' })
        ],
        total: 3,
        page: 1
      })
    })

    it('should put the exact match first and order the rest by closeness', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-13' })

      expect(result.structuredContent.setlists.map(s => s.id)).to.deep.equal(['exact', 'near', 'far'])
    })

    it('should sign the day offset by direction', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-13' })
      const byId = Object.fromEntries(result.structuredContent.setlists.map(s => [s.id, s]))

      expect(byId.near.daysFromRequestedDate).to.equal(1)
      expect(byId.far.daysFromRequestedDate).to.equal(7)
    })

    it('should rank the nearest gig first when the remembered date is a day out', async () => {
      // No gig on the 15th; the 14th is one day before and the 20th five days after
      const result = await handler({ artist: 'The Cure', date: '1992-08-15' })

      expect(result.structuredContent.setlists[0].id).to.equal('near')
      expect(result.structuredContent.setlists[0].daysFromRequestedDate).to.equal(-1)
      expect(result.structuredContent.note).to.include('closest matches')
    })

    it('should still find an exact match when the date lands on a later gig', async () => {
      const result = await handler({ artist: 'The Cure', date: '1992-08-14' })

      expect(result.structuredContent.setlists[0]).to.include({
        id: 'near',
        exactDateMatch: true
      })
    })

    it('should sort newest first when no date was given', async () => {
      const result = await handler({ artist: 'The Cure', year: 1992 })

      expect(result.structuredContent.setlists[0].id).to.equal('far')
    })
  })

  describe('city broadening', () => {
    it('should retry without the city when the city search finds nothing', async () => {
      // Only a year, so the flow is year+city then year alone
      setlistFm.searchSetlists.onFirstCall().resolves({ setlist: [], total: 0, page: 1 })
      setlistFm.searchSetlists.onSecondCall().resolves({
        setlist: [setlistFixture({ id: 'abc123', eventDate: '13-08-1992', city: 'Lower Hutt' })],
        total: 1,
        page: 1
      })

      const result = await handler({ artist: 'The Cure', city: 'Wellington', year: 1992 })

      expect(setlistFm.searchSetlists.calledTwice).to.be.true
      expect(setlistFm.searchSetlists.secondCall.args[0].cityName).to.equal(undefined)
      expect(result.structuredContent.query.broadened).to.be.true
      expect(result.structuredContent.note).to.include('widened')
    })

    it('should broaden at most once', async () => {
      setlistFm.searchSetlists.resolves({ setlist: [], total: 0, page: 1 })

      await handler({ artist: 'The Cure', city: 'Wellington', year: 1992 })

      expect(setlistFm.searchSetlists.calledTwice).to.be.true
    })

    it('should not broaden when no city was given', async () => {
      setlistFm.searchSetlists.resolves({ setlist: [], total: 0, page: 1 })

      await handler({ artist: 'The Cure', year: 1992 })

      expect(setlistFm.searchSetlists.calledOnce).to.be.true
    })

    it('should fall back to the year when the exact date finds nothing', async () => {
      setlistFm.searchSetlists.onFirstCall().resolves({ setlist: [], total: 0, page: 1 })
      setlistFm.searchSetlists.onSecondCall().resolves({
        setlist: [setlistFixture({ id: 'nearby', eventDate: '14-08-1992' })],
        total: 1,
        page: 1
      })

      const result = await handler({ artist: 'The Cure', city: 'Wellington', date: '1992-08-13' })

      expect(setlistFm.searchSetlists.firstCall.args[0].date).to.equal('1992-08-13')
      expect(setlistFm.searchSetlists.secondCall.args[0].year).to.equal(1992)
      expect(result.structuredContent.setlists[0].id).to.equal('nearby')
    })

    it('should prefer city substring matches once broadened', async () => {
      setlistFm.searchSetlists.onFirstCall().resolves({ setlist: [], total: 0, page: 1 })
      setlistFm.searchSetlists.onSecondCall().resolves({
        setlist: [
          setlistFixture({ id: 'auckland', eventDate: '01-08-1992', city: 'Auckland' }),
          setlistFixture({ id: 'wellington', eventDate: '13-08-1992', city: 'Wellington City' })
        ],
        total: 2,
        page: 1
      })

      const result = await handler({ artist: 'The Cure', city: 'Wellington', year: 1992 })

      expect(result.structuredContent.setlists.map(s => s.id)).to.deep.equal(['wellington'])
    })
  })

  describe('prolific artists (regression: Prince, London, 2007)', () => {
    /**
     * Prince played 42 shows in London in 2007. setlist.fm returns 20 per page,
     * newest first, so a year search returns only September and late August on page
     * one - a real 17 August gig is invisible to it. Searching the exact date first
     * finds it in one request; the paging below is the safety net for when the
     * remembered date is also wrong.
     */
    function page (dates, total) {
      return {
        setlist: dates.map(eventDate => setlistFixture({ id: `id-${eventDate}`, eventDate, city: 'London' })),
        total,
        page: 1
      }
    }

    it('should find a gig buried past page one by querying the exact date', async () => {
      setlistFm.searchSetlists.resolves(page(['17-08-2007'], 1))

      const result = await handler({ artist: 'Prince', city: 'London', date: '2007-08-17' })

      expect(setlistFm.searchSetlists.calledOnce).to.be.true
      expect(result.structuredContent.setlists[0]).to.include({
        eventDate: '2007-08-17',
        exactDateMatch: true
      })
    })

    it('should page through the year until it reaches the requested date', async () => {
      setlistFm.searchSetlists.onCall(0).resolves({ setlist: [], total: 0, page: 1 })
      // Page one is all September; the target date is older, so it must keep paging
      setlistFm.searchSetlists.onCall(1).resolves(page(['22-09-2007', '01-09-2007'], 4))
      setlistFm.searchSetlists.onCall(2).resolves(page(['28-08-2007', '16-08-2007'], 4))

      const result = await handler({ artist: 'Prince', city: 'London', date: '2007-08-17' })

      expect(setlistFm.searchSetlists.callCount).to.equal(3)
      expect(result.structuredContent.setlists[0].eventDate).to.equal('2007-08-16')
    })

    it('should stop paging once the page reaches past the requested date', async () => {
      setlistFm.searchSetlists.onCall(0).resolves({ setlist: [], total: 0, page: 1 })
      setlistFm.searchSetlists.onCall(1).resolves(page(['22-09-2007', '16-08-2007'], 40))

      await handler({ artist: 'Prince', city: 'London', date: '2007-08-17' })

      // One exact-date attempt plus one year page: the page already spans the date
      expect(setlistFm.searchSetlists.callCount).to.equal(2)
    })

    it('should stop paging once every result has been collected', async () => {
      setlistFm.searchSetlists.onCall(0).resolves({ setlist: [], total: 0, page: 1 })
      setlistFm.searchSetlists.onCall(1).resolves(page(['22-09-2007', '20-09-2007'], 2))

      await handler({ artist: 'Prince', city: 'London', date: '2007-08-17' })

      expect(setlistFm.searchSetlists.callCount).to.equal(2)
    })

    it('should cap paging so one search cannot drain the request budget', async () => {
      setlistFm.searchSetlists.onCall(0).resolves({ setlist: [], total: 0, page: 1 })
      // Every page stays newer than the target, so only the cap stops it
      setlistFm.searchSetlists.resolves(page(['22-09-2007', '20-09-2007'], 500))

      await handler({ artist: 'Prince', city: 'London', date: '2007-08-17' })

      expect(setlistFm.searchSetlists.callCount).to.be.at.most(6)
    })

    it('should honour an explicit page request without paging on top of it', async () => {
      setlistFm.searchSetlists.resolves(page(['22-09-2007'], 40))

      await handler({ artist: 'Prince', city: 'London', year: 2007, page: 2 })

      expect(setlistFm.searchSetlists.calledOnce).to.be.true
      expect(setlistFm.searchSetlists.firstCall.args[0].page).to.equal(2)
    })
  })

  describe('empty and ambiguous results', () => {
    it('should treat no artist match as a success, not an error', async () => {
      musicBrainz.searchArtist.resolves(null)

      const result = await handler({ artist: 'Not A Band' })

      expect(result.isError).to.equal(undefined)
      expect(result.structuredContent.setlists).to.deep.equal([])
      expect(result.content[0].text).to.include('No artist found')
      expect(() => FIND_SETLISTS_OUTPUT.parse(result.structuredContent)).to.not.throw()
    })

    it('should treat no setlists as a success, not an error', async () => {
      setlistFm.searchSetlists.resolves({ setlist: [], total: 0, page: 1 })

      const result = await handler({ artist: 'The Cure', year: 1992 })

      expect(result.isError).to.equal(undefined)
      expect(result.structuredContent.count).to.equal(0)
      expect(result.structuredContent.note).to.include('No setlists found')
    })

    it('should surface artist alternatives so the caller can correct course', async () => {
      musicBrainz.searchArtist.resolves({
        name: 'Villainy',
        mbid: 'mbid-1',
        disambiguation: null,
        alternatives: [{ name: 'Villainy', mbid: 'mbid-2', disambiguation: 'NZ rock band', score: 95 }]
      })
      setlistFm.searchSetlists.resolves({
        setlist: [setlistFixture({ id: 'abc123', eventDate: '13-08-1992' })],
        total: 1,
        page: 1
      })

      const result = await handler({ artist: 'Villainy', year: 1992 })

      expect(result.structuredContent.artist.alternatives).to.have.lengthOf(1)
      expect(result.structuredContent.note).to.include('NZ rock band')
      expect(result.structuredContent.note).to.include('artistMbid')
    })

    it('should note when more results exist than were returned', async () => {
      setlistFm.searchSetlists.resolves({
        setlist: [setlistFixture({ id: 'abc123', eventDate: '13-08-1992' })],
        total: 45,
        page: 1
      })

      const result = await handler({ artist: 'The Cure', year: 1992 })

      expect(result.structuredContent.note).to.include('45 setlists matched')
    })
  })

  describe('errors', () => {
    it('should return isError with remediation when the api key is missing', async () => {
      setlistFm.searchSetlists.rejects(new ConfigurationError('SETLISTFM_API_KEY is not set. Add it to the .env file in the setlist-mcp directory.'))

      const result = await handler({ artist: 'The Cure', year: 1992 })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('SETLISTFM_API_KEY')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.searchSetlists.rejects(new Error('network down'))

      const result = await handler({ artist: 'The Cure', year: 1992 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
