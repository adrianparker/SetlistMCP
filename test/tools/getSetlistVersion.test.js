import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetSetlistVersionTool } from '../../src/tools/getSetlistVersion.js'
import { GET_SETLIST_OUTPUT } from '../../src/tools/getSetlist.js'
import { HttpError } from '../../src/services/errors.js'

const sampleSetlist = {
  id: '6bd7ee5e',
  versionId: 'version1',
  url: 'https://www.setlist.fm/setlist/the-cure/1992/6bd7ee5e.html',
  eventDate: '13-08-1992',
  artist: { mbid: 'mbid-cure', name: 'The Cure' },
  venue: { name: 'Wellington Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } },
  sets: { set: [{ song: [{ name: 'Open' }] }] }
}

describe('get_setlist_version', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getSetlistVersion: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetSetlistVersionTool({ setlistFm, logger }).handler
  })

  it('should be named get_setlist_version and flagged read-only', () => {
    const tool = buildGetSetlistVersionTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_setlist_version')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should fetch the version by id', async () => {
      setlistFm.getSetlistVersion.resolves(sampleSetlist)

      const result = await handler({ versionId: 'version1' })

      expect(setlistFm.getSetlistVersion.calledWith('version1')).to.be.true
      expect(() => GET_SETLIST_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.content[0].text).to.include('version1')
    })
  })

  describe('errors', () => {
    it('should return a helpful isError for an unknown version id', async () => {
      setlistFm.getSetlistVersion.rejects(new HttpError('Setlist.fm API error: 404 Not Found', { status: 404 }))

      const result = await handler({ versionId: 'nosuch1' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('nosuch1')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.getSetlistVersion.rejects(new HttpError('Setlist.fm API error: 500 Server Error', { status: 500 }))

      const result = await handler({ versionId: 'version1' })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
