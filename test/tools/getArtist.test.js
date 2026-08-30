import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { ARTIST_OUTPUT, buildGetArtistTool } from '../../src/tools/getArtist.js'
import { HttpError } from '../../src/services/errors.js'

describe('get_artist', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getArtist: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetArtistTool({ setlistFm, logger }).handler
  })

  it('should be named get_artist and flagged read-only', () => {
    const tool = buildGetArtistTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_artist')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should fetch the artist by mbid', async () => {
      setlistFm.getArtist.resolves({ mbid: 'mbid-cure', name: 'The Cure', sortName: 'Cure, The', url: 'https://www.setlist.fm/setlist/the-cure.html' })

      await handler({ artistMbid: 'mbid-cure' })

      expect(setlistFm.getArtist.calledWith('mbid-cure')).to.be.true
    })

    it('should return structured content that satisfies the output schema', async () => {
      setlistFm.getArtist.resolves({ mbid: 'mbid-cure', name: 'The Cure' })

      const result = await handler({ artistMbid: 'mbid-cure' })

      expect(() => ARTIST_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.name).to.equal('The Cure')
    })

    it('should include the disambiguation in the summary when present', async () => {
      setlistFm.getArtist.resolves({ mbid: 'mbid-1', name: 'Prince', disambiguation: 'US singer' })

      const result = await handler({ artistMbid: 'mbid-1' })

      expect(result.content[0].text).to.include('Prince (US singer)')
    })
  })

  describe('errors', () => {
    it('should return a helpful isError for an unknown mbid', async () => {
      setlistFm.getArtist.rejects(new HttpError('Setlist.fm API error: 404 Not Found', { status: 404 }))

      const result = await handler({ artistMbid: 'nosuchmbid' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('nosuchmbid')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.getArtist.rejects(new HttpError('Setlist.fm API error: 500 Server Error', { status: 500 }))

      const result = await handler({ artistMbid: 'mbid-1' })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
