import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import sinon from 'sinon'
import { buildGetSetlistTool, GET_SETLIST_OUTPUT } from '../../src/tools/getSetlist.js'
import { HttpError } from '../../src/services/errors.js'

const sampleSetlist = {
  id: '6bd7ee5e',
  url: 'https://www.setlist.fm/setlist/the-cure/1992/6bd7ee5e.html',
  eventDate: '13-08-1992',
  lastUpdated: '2020-01-01T00:00:00.000+0000',
  artist: { mbid: 'mbid-cure', name: 'The Cure' },
  venue: {
    name: 'Wellington Town Hall',
    city: { name: 'Wellington', country: { code: 'NZ', name: 'New Zealand' } }
  },
  tour: { name: 'Wish Tour' },
  sets: {
    set: [
      { song: [{ name: 'Tape', tape: true }, { name: 'Open' }, { name: 'High' }] },
      { encore: 1, song: [{ name: 'Lovesong', cover: { name: 'Someone' } }] }
    ]
  }
}

describe('get_setlist', () => {
  let setlistFm
  let logger
  let handler

  beforeEach(() => {
    setlistFm = { getSetlist: sinon.stub() }
    logger = { debug: sinon.stub(), info: sinon.stub(), warn: sinon.stub(), error: sinon.stub() }
    handler = buildGetSetlistTool({ setlistFm, logger }).handler
  })

  describe('tool definition', () => {
    it('should be named get_setlist and flagged read-only', () => {
      const tool = buildGetSetlistTool({ setlistFm, logger })

      expect(tool.name).to.equal('get_setlist')
      expect(tool.config.annotations).to.include({ readOnlyHint: true })
    })
  })

  describe('happy path', () => {
    beforeEach(() => {
      setlistFm.getSetlist.resolves(sampleSetlist)
    })

    it('should fetch the setlist by id', async () => {
      await handler({ id: '6bd7ee5e' })

      expect(setlistFm.getSetlist.calledWith('6bd7ee5e')).to.be.true
    })

    it('should return structured content that satisfies the output schema', async () => {
      const result = await handler({ id: '6bd7ee5e' })

      expect(() => GET_SETLIST_OUTPUT.parse(result.structuredContent)).to.not.throw()
    })

    it('should group songs into sets and encores', async () => {
      const result = await handler({ id: '6bd7ee5e' })

      expect(result.structuredContent.sets).to.have.lengthOf(2)
      expect(result.structuredContent.sets[1].encore).to.equal(1)
      expect(result.structuredContent.sets[1].songs[0].name).to.equal('Lovesong')
    })

    it('should exclude tape entries from the song count', async () => {
      const result = await handler({ id: '6bd7ee5e' })

      expect(result.structuredContent.songCount).to.equal(3)
    })

    it('should normalise the event date to ISO', async () => {
      const result = await handler({ id: '6bd7ee5e' })

      expect(result.structuredContent.eventDate).to.equal('1992-08-13')
    })

    it('should render a readable setlist with encore headings', async () => {
      const text = (await handler({ id: '6bd7ee5e' })).content[0].text

      expect(text).to.include('The Cure - 1992-08-13')
      expect(text).to.include('Wellington Town Hall')
      expect(text).to.include('Encore 1')
      expect(text).to.include('2. Open')
    })

    it('should annotate tapes and covers in the text rendering', async () => {
      const text = (await handler({ id: '6bd7ee5e' })).content[0].text

      expect(text).to.include('(tape)')
      expect(text).to.include('Someone cover')
    })

    it('should include the setlist.fm url for attribution', async () => {
      const result = await handler({ id: '6bd7ee5e' })

      expect(result.content[0].text).to.include('setlist.fm/setlist/the-cure')
      expect(result.structuredContent.url).to.include('setlist.fm')
    })
  })

  describe('edge cases', () => {
    it('should handle a setlist with no songs recorded', async () => {
      setlistFm.getSetlist.resolves({ id: 'empty1', artist: { name: 'The Cure' }, eventDate: '13-08-1992' })

      const result = await handler({ id: 'empty1' })

      expect(result.isError).to.equal(undefined)
      expect(result.structuredContent.sets).to.deep.equal([])
      expect(result.content[0].text).to.include('No songs have been recorded')
      expect(() => GET_SETLIST_OUTPUT.parse(result.structuredContent)).to.not.throw()
    })
  })

  describe('errors', () => {
    it('should return a helpful isError for an unknown id', async () => {
      setlistFm.getSetlist.rejects(new HttpError('Setlist.fm API error: 404 Not Found', { status: 404 }))

      const result = await handler({ id: 'nosuch1' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('nosuch1')
      expect(result.content[0].text).to.include('find_setlists')
    })

    it('should return isError when the upstream call fails', async () => {
      setlistFm.getSetlist.rejects(new HttpError('Setlist.fm API error: 500 Server Error', { status: 500 }))

      const result = await handler({ id: '6bd7ee5e' })

      expect(result.isError).to.be.true
      expect(result.content[0].text).to.include('temporary')
      expect(logger.error.called).to.be.true
    })
  })
})
