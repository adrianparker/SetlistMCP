import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetVenueTool, VENUE_OUTPUT } from '../../src/tools/getVenue.js'
import { HttpError } from '../../src/services/errors.js'

describe('get_venue', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getVenue: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetVenueTool({ setlistFm, logger }).handler
  })

  it('should be named get_venue and flagged read-only', () => {
    const tool = buildGetVenueTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_venue')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should fetch the venue by id and flatten its city', async () => {
      setlistFm.getVenue.resolves({
        id: 'venue-1',
        name: 'Wellington Town Hall',
        city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } }
      })

      const result = await handler({ venueId: 'venue-1' })

      expect(setlistFm.getVenue.calledWith('venue-1')).to.be.true
      expect(() => VENUE_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.city.name).to.equal('Wellington')
      expect(result.content[0].text).to.include('Wellington Town Hall, Wellington, New Zealand')
    })
  })

  describe('errors', () => {
    it('should return a helpful isError for an unknown venue id', async () => {
      setlistFm.getVenue.rejects(new HttpError('Setlist.fm API error: 404 Not Found', { status: 404 }))

      const result = await handler({ venueId: 'nosuchvenue' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('nosuchvenue')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.getVenue.rejects(new HttpError('Setlist.fm API error: 500 Server Error', { status: 500 }))

      const result = await handler({ venueId: 'venue-1' })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
