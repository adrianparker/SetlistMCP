import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildFindVenuesTool, FIND_VENUES_OUTPUT } from '../../src/tools/findVenues.js'

describe('find_venues', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { searchVenues: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildFindVenuesTool({ setlistFm, logger }).handler
  })

  it('should be named find_venues and flagged read-only', () => {
    const tool = buildFindVenuesTool({ setlistFm, logger })

    expect(tool.name).to.equal('find_venues')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should map venues and return structured content that satisfies the output schema', async () => {
      setlistFm.searchVenues.resolves({
        venue: [{ id: 'venue-1', name: 'Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } }],
        total: 1,
        page: 1,
        itemsPerPage: 20
      })

      const result = await handler({ name: 'Town Hall', page: 1 })

      expect(() => FIND_VENUES_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.venues[0].name).to.equal('Town Hall')
    })
  })

  describe('empty results', () => {
    it('should treat no matches as a success, not an error', async () => {
      setlistFm.searchVenues.resolves({ venue: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await handler({ name: 'Obscure', page: 1 })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.venues).to.deep.equal([])
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.searchVenues.rejects(new Error('boom'))

      const result = await handler({ name: 'Town Hall', page: 1 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
