import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetUserSetlistsTool, GET_USER_SETLISTS_OUTPUT } from '../../src/tools/getUserSetlists.js'

const sampleSetlist = {
  id: '6bd7ee5e',
  eventDate: '13-08-1992',
  artist: { mbid: 'mbid-cure', name: 'The Cure' },
  venue: { name: 'Wellington Town Hall', city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } } },
  sets: { set: [{ song: [{ name: 'Open' }] }] }
}

describe('get_user_setlists', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getUserAttended: sinon.stub(), getUserEdited: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetUserSetlistsTool({ setlistFm, logger }).handler
  })

  it('should be named get_user_setlists and flagged read-only', () => {
    const tool = buildGetUserSetlistsTool({ setlistFm, logger })

    expect(tool.name).to.equal('get_user_setlists')
    expect(tool.config.annotations).to.include({ readOnlyHint: true })
  })

  describe('kind: attended', () => {
    it('should call getUserAttended and satisfy the output schema', async () => {
      setlistFm.getUserAttended.resolves({ setlist: [sampleSetlist], total: 1, page: 1, itemsPerPage: 20 })

      const result = await handler({ userId: 'someuser', kind: 'attended', page: 1 })

      expect(setlistFm.getUserAttended.calledWith('someuser', { page: 1 })).to.be.true
      expect(setlistFm.getUserEdited.called).to.be.false
      expect(() => GET_USER_SETLISTS_OUTPUT.parse(result.structuredContent)).to.not.throw()
      expect(result.structuredContent.kind).to.equal('attended')
    })
  })

  describe('kind: edited', () => {
    it('should call getUserEdited', async () => {
      setlistFm.getUserEdited.resolves({ setlist: [sampleSetlist], total: 1, page: 1, itemsPerPage: 20 })

      const result = await handler({ userId: 'someuser', kind: 'edited', page: 1 })

      expect(setlistFm.getUserEdited.calledWith('someuser', { page: 1 })).to.be.true
      expect(setlistFm.getUserAttended.called).to.be.false
      expect(result.structuredContent.kind).to.equal('edited')
    })
  })

  describe('empty results', () => {
    it('should treat no setlists as a success, not an error', async () => {
      setlistFm.getUserAttended.resolves({ setlist: [], total: 0, page: 1, itemsPerPage: 0 })

      const result = await handler({ userId: 'someuser', kind: 'attended', page: 1 })

      expect(result.isError).to.not.equal(true)
      expect(result.structuredContent.setlists).to.deep.equal([])
    })
  })

  describe('errors', () => {
    it('should return isError when the upstream call fails', async () => {
      setlistFm.getUserAttended.rejects(new Error('boom'))

      const result = await handler({ userId: 'someuser', kind: 'attended', page: 1 })

      expect(result.isError).to.be.true
      expect(logger.error.called).to.be.true
    })
  })
})
