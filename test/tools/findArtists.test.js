import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildFindArtistsTool, FIND_ARTISTS_OUTPUT } from '../../src/tools/findArtists.js'

describe('find_artists', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { searchArtists: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildFindArtistsTool({ setlistFm, logger }).handler
  })

  it('should be named find_artists and flagged read-only', () => {
    const tool = buildFindArtistsTool({ setlistFm, logger })

    expect(tool.name).to.equal('find_artists')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should map artists and return structured content that satisfies the output schema', async () => {
      setlistFm.searchArtists.resolves({
        artist: [{ mbid: 'mbid-cure', name: 'The Cure' }],
        total: 1,
        page: 1,
        itemsPerPage: 20
      })

      const result = await handler({ artistName: 'The Cure', page: 1 })

      expect(setlistFm.searchArtists.calledWith({ artistName: 'The Cure', artistMbid: undefined, sort: undefined, page: 1 })).to.be.true
      expect(() => FIND_ARTISTS_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.artists[0].name).to.equal('The Cure')
    })
  })

  describe('empty results', () => {
    it('should treat no matches as a success, not an error', async () => {
      setlistFm.searchArtists.resolves({ artist: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await handler({ artistName: 'Obscure Band', page: 1 })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.artists).to.deep.equal([])
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.searchArtists.rejects(new Error('boom'))

      const result = await handler({ artistName: 'The Cure', page: 1 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
