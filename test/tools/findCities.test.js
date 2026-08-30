import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildFindCitiesTool, FIND_CITIES_OUTPUT } from '../../src/tools/findCities.js'

describe('find_cities', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { searchCities: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildFindCitiesTool({ setlistFm, logger }).handler
  })

  it('should be named find_cities and flagged read-only', () => {
    const tool = buildFindCitiesTool({ setlistFm, logger })

    expect(tool.name).to.equal('find_cities')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should map the "cities" array and return structured content that satisfies the output schema', async () => {
      setlistFm.searchCities.resolves({
        cities: [{ id: 'city-1', name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } }],
        total: 1,
        page: 1,
        itemsPerPage: 20
      })

      const result = await handler({ name: 'Wellington', page: 1 })

      expect(() => FIND_CITIES_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.cities[0].name).to.equal('Wellington')
    })
  })

  describe('empty results', () => {
    it('should treat no matches as a success, not an error', async () => {
      setlistFm.searchCities.resolves({ cities: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await handler({ name: 'Obscure', page: 1 })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.cities).to.deep.equal([])
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.searchCities.rejects(new Error('boom'))

      const result = await handler({ name: 'Wellington', page: 1 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
