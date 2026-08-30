import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetCityTool } from '../../src/tools/getCity.js'
import { CITY_OUTPUT } from '../../src/tools/getVenue.js'
import { HttpError } from '../../src/services/errors.js'

describe('get_city', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getCity: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetCityTool({ setlistFm, logger }).handler
  })

  it('should be named get_city and flagged read-only', () => {
    const tool = buildGetCityTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_city')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('happy path', () => {
    it('should fetch the city by geoId', async () => {
      setlistFm.getCity.resolves({ id: 'city-1', name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } })

      const result = await handler({ geoId: 'city-1' })

      expect(setlistFm.getCity.calledWith('city-1')).to.be.true
      expect(() => CITY_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.content[0].text).to.equal('Wellington, New Zealand')
    })
  })

  describe('errors', () => {
    it('should return a helpful isError for an unknown geoId', async () => {
      setlistFm.getCity.rejects(new HttpError('Setlist.fm API error: 404 Not Found', { status: 404 }))

      const result = await handler({ geoId: 'nosuchcity' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('nosuchcity')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.getCity.rejects(new HttpError('Setlist.fm API error: 500 Server Error', { status: 500 }))

      const result = await handler({ geoId: 'city-1' })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
