import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetArtistSetlistsTool, GET_ARTIST_SETLISTS_OUTPUT } from '../../src/tools/getArtistSetlists.js'

const sampleSetlist = {
  id: '6bd7ee5e',
  eventDate: '13-08-1992',
  artist: { mbid: 'mbid-cure', name: 'The Cure' },
  venue: { name: 'Wellington Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } },
  sets: { set: [{ song: [{ name: 'Open' }] }] }
}

describe('get_artist_setlists', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getArtistSetlists: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetArtistSetlistsTool({ setlistFm, logger }).handler
  })

  it('should be named get_artist_setlists and flagged read-only', () => {
    const tool = buildGetArtistSetlistsTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_artist_setlists')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should page through an artist\'s setlists', async () => {
      setlistFm.getArtistSetlists.resolves({ setlist: [sampleSetlist], total: 1, page: 1, itemsPerPage: 20 })

      const result = await handler({ artistMbid: 'mbid-cure', page: 1 })

      expect(setlistFm.getArtistSetlists.calledWith('mbid-cure', { page: 1 })).to.be.true
      expect(() => GET_ARTIST_SETLISTS_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.setlists[0].id).to.equal('6bd7ee5e')
    })
  })

  describe('empty results', () => {
    it('should treat no setlists as a success, not an error', async () => {
      setlistFm.getArtistSetlists.resolves({ setlist: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await handler({ artistMbid: 'mbid-1', page: 1 })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.setlists).to.deep.equal([])
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.getArtistSetlists.rejects(new Error('boom'))

      const result = await handler({ artistMbid: 'mbid-1', page: 1 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
