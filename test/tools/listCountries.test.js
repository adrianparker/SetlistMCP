import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildListCountriesTool, LIST_COUNTRIES_OUTPUT } from '../../src/tools/listCountries.js'

describe('list_countries', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { searchCountries: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildListCountriesTool({ setlistFm, logger }).handler
  })

  it('should be named list_countries and flagged read-only', () => {
    const tool = buildListCountriesTool({ setlistFm, logger })

    expect(tool.name).to.equal('list_countries')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should return every country and satisfy the output schema', async () => {
      setlistFm.searchCountries.resolves({
        country: [{ code: 'NZ', name: 'New Zealand' }, { code: 'AU', name: 'Australia' }]
      })

      const result = await handler()

      expect(() => LIST_COUNTRIES_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.total).to.equal(2)
      expect(result.content[0].text).to.include('New Zealand (NZ)')
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.searchCountries.rejects(new Error('boom'))

      const result = await handler()

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
