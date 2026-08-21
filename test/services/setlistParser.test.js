import { describe, it } from 'mocha'
import { expect } from 'chai'
import { detailSetlist, parseSetlistSongs, summariseSetlist } from '../../src/services/setlistParser.js'

/**
 * Shaped like a real setlist.fm response, trimmed to the fields the parser reads.
 * Ported from setlist-finder's test suite.
 */
const sampleSetlist = {
  id: '6bd7ee5e',
  url: 'https://www.setlist.fm/setlist/the-cure/1992/6bd7ee5e.html',
  eventDate: '13-08-1992',
  lastUpdated: '2020-01-01T00:00:00.000+0000',
  artist: {
    mbid: '69ee3720-a7cb-4402-b48d-a02c366f2bcf',
    name: 'The Cure',
    sortName: 'Cure, The'
  },
  venue: {
    id: '23d4d0c3',
    name: 'Wellington Town Hall',
    city: {
      id: '2179537',
      name: 'Wellington',
      country: { code: 'NZ', name: 'New Zealand' }
    }
  },
  tour: { name: 'Wish Tour' },
  sets: {
    set: [
      {
        song: [
          { name: 'Tape', tape: true },
          { name: 'Open' },
          { name: 'High' },
          { name: 'Pictures of You' }
        ]
      },
      { encore: 1, song: [{ name: 'Lovesong' }, { name: 'Close to Me' }] }
    ]
  }
}

describe('parseSetlistSongs', () => {
  describe('basic parsing', () => {
    it('should extract every song across all sets', () => {
      expect(parseSetlistSongs(sampleSetlist)).to.have.lengthOf(6)
    })

    it('should carry the song name and headline artist', () => {
      expect(parseSetlistSongs(sampleSetlist)[1]).to.deep.include({
        songName: 'Open',
        artistName: 'The Cure'
      })
    })

    it('should number positions continuously across sets', () => {
      const positions = parseSetlistSongs(sampleSetlist).map(song => song.position)

      expect(positions).to.deep.equal([1, 2, 3, 4, 5, 6])
    })

    it('should number sets from one', () => {
      const songs = parseSetlistSongs(sampleSetlist)

      expect(songs[0].setNumber).to.equal(1)
      expect(songs[4].setNumber).to.equal(2)
    })
  })

  describe('XML-derived shapes', () => {
    it('should handle sets.set arriving as a single object rather than an array', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'Solo Act' },
        sets: { set: { song: [{ name: 'Only Song' }] } }
      })

      expect(songs).to.have.lengthOf(1)
      expect(songs[0].songName).to.equal('Only Song')
    })

    it('should handle a set with a single song object rather than an array', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'Solo Act' },
        sets: { set: [{ song: { name: 'Just The One' } }] }
      })

      expect(songs).to.have.lengthOf(1)
      expect(songs[0].songName).to.equal('Just The One')
    })

    it('should handle both collapsed at once', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'Solo Act' },
        sets: { set: { song: { name: 'Doubly Collapsed' } } }
      })

      expect(songs).to.have.lengthOf(1)
      expect(songs[0].songName).to.equal('Doubly Collapsed')
    })
  })

  describe('encore handling', () => {
    it('should flag encore sets', () => {
      const songs = parseSetlistSongs(sampleSetlist)

      expect(songs[0].isEncoreSet).to.be.false
      expect(songs[4].isEncoreSet).to.be.true
      expect(songs[4].encoreNumber).to.equal(1)
    })

    it('should treat encore 0 as an encore, not as absent', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'A' },
        sets: { set: [{ encore: 0, song: [{ name: 'Edge Case' }] }] }
      })

      expect(songs[0].isEncoreSet).to.be.true
    })
  })

  describe('tape handling', () => {
    it('should flag tape entries', () => {
      const songs = parseSetlistSongs(sampleSetlist)

      expect(songs[0].isTape).to.be.true
      expect(songs[1].isTape).to.be.false
    })
  })

  describe('song metadata', () => {
    it('should capture cover, guest and info', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'The Band' },
        sets: {
          set: [{
            song: [{
              name: 'Hallelujah',
              cover: { name: 'Leonard Cohen' },
              with: { name: 'A Guest' },
              info: 'dedicated to the crew'
            }]
          }]
        }
      })

      expect(songs[0]).to.deep.include({
        cover: 'Leonard Cohen',
        with: 'A Guest',
        info: 'dedicated to the crew'
      })
    })

    it('should null those fields when absent', () => {
      expect(parseSetlistSongs(sampleSetlist)[1]).to.deep.include({
        cover: null,
        with: null,
        info: null
      })
    })

    it('should carry the set name when present', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'A' },
        sets: { set: [{ name: 'Acoustic Set', song: [{ name: 'Quiet One' }] }] }
      })

      expect(songs[0].setName).to.equal('Acoustic Set')
    })
  })

  describe('edge cases', () => {
    it('should return an empty array for null, undefined and empty input', () => {
      expect(parseSetlistSongs(null)).to.deep.equal([])
      expect(parseSetlistSongs(undefined)).to.deep.equal([])
      expect(parseSetlistSongs({})).to.deep.equal([])
      expect(parseSetlistSongs({ sets: {} })).to.deep.equal([])
    })

    it('should skip songs with no name', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'A' },
        sets: { set: [{ song: [{ name: 'Real' }, { tape: true }, null] }] }
      })

      expect(songs).to.have.lengthOf(1)
      expect(songs[0].songName).to.equal('Real')
    })

    it('should skip null sets', () => {
      const songs = parseSetlistSongs({
        artist: { name: 'A' },
        sets: { set: [null, { song: [{ name: 'Real' }] }] }
      })

      expect(songs).to.have.lengthOf(1)
    })

    it('should fall back to a placeholder artist name', () => {
      const songs = parseSetlistSongs({ sets: { set: [{ song: [{ name: 'Orphan' }] }] } })

      expect(songs[0].artistName).to.equal('Unknown Artist')
    })
  })
})

describe('summariseSetlist', () => {
  it('should normalise the event date to ISO', () => {
    expect(summariseSetlist(sampleSetlist).eventDate).to.equal('1992-08-13')
  })

  it('should flatten venue, city and country', () => {
    expect(summariseSetlist(sampleSetlist)).to.deep.include({
      id: '6bd7ee5e',
      artistName: 'The Cure',
      venue: 'Wellington Town Hall',
      city: 'Wellington',
      country: 'New Zealand',
      countryCode: 'NZ',
      tour: 'Wish Tour'
    })
  })

  it('should exclude tape entries from the song count', () => {
    // Six entries, one of which is walk-in tape
    expect(summariseSetlist(sampleSetlist).songCount).to.equal(5)
  })

  it('should fall back gracefully on a sparse setlist', () => {
    expect(summariseSetlist({ id: 'abc123' })).to.deep.include({
      id: 'abc123',
      artistName: 'Unknown artist',
      venue: 'Unknown venue',
      city: 'Unknown city',
      country: 'Unknown country',
      songCount: 0,
      tour: null,
      url: null
    })
  })
})

describe('detailSetlist', () => {
  it('should group songs back into their sets', () => {
    const detail = detailSetlist(sampleSetlist)

    expect(detail.sets).to.have.lengthOf(2)
    expect(detail.sets[0].songs).to.have.lengthOf(4)
    expect(detail.sets[1].songs).to.have.lengthOf(2)
  })

  it('should carry the encore number on the encore set', () => {
    const detail = detailSetlist(sampleSetlist)

    expect(detail.sets[0].encore).to.be.null
    expect(detail.sets[1].encore).to.equal(1)
  })

  it('should preserve continuous song positions across sets', () => {
    const detail = detailSetlist(sampleSetlist)

    expect(detail.sets[1].songs.map(song => song.position)).to.deep.equal([5, 6])
  })

  it('should normalise the event date and flatten the venue', () => {
    const detail = detailSetlist(sampleSetlist)

    expect(detail.eventDate).to.equal('1992-08-13')
    expect(detail.venue).to.deep.include({
      name: 'Wellington Town Hall',
      city: 'Wellington',
      country: 'New Zealand',
      countryCode: 'NZ'
    })
  })

  it('should include the artist mbid and the setlist url', () => {
    const detail = detailSetlist(sampleSetlist)

    expect(detail.artist.mbid).to.equal('69ee3720-a7cb-4402-b48d-a02c366f2bcf')
    expect(detail.url).to.include('setlist.fm')
  })

  it('should return an empty set list for a setlist with no sets', () => {
    expect(detailSetlist({ id: 'abc123' }).sets).to.deep.equal([])
  })
})
