import { describe, it } from 'mocha'
import { expect } from 'chai'
import { daysBetween, fromApiDate, isIsoDate, toApiDate, yearOf } from '../../src/services/dates.js'

describe('isIsoDate', () => {
  it('should accept a real calendar date', () => {
    expect(isIsoDate('1992-08-13')).to.be.true
  })

  it('should accept a leap day in a leap year', () => {
    expect(isIsoDate('2024-02-29')).to.be.true
  })

  it('should reject a leap day in a non-leap year', () => {
    expect(isIsoDate('2023-02-29')).to.be.false
  })

  it('should reject an impossible day of month rather than rolling it over', () => {
    expect(isIsoDate('2026-02-31')).to.be.false
  })

  it('should reject an impossible month', () => {
    expect(isIsoDate('1992-13-01')).to.be.false
  })

  it('should reject the setlist.fm dd-MM-yyyy form', () => {
    expect(isIsoDate('13-08-1992')).to.be.false
  })

  it('should reject malformed and empty input', () => {
    expect(isIsoDate('1992-8-13')).to.be.false
    expect(isIsoDate('not a date')).to.be.false
    expect(isIsoDate('')).to.be.false
    expect(isIsoDate(undefined)).to.be.false
    expect(isIsoDate(null)).to.be.false
  })
})

describe('toApiDate', () => {
  it('should convert ISO to the dd-MM-yyyy form setlist.fm expects', () => {
    expect(toApiDate('1992-08-13')).to.equal('13-08-1992')
  })

  it('should preserve leading zeroes', () => {
    expect(toApiDate('2024-01-05')).to.equal('05-01-2024')
  })

  it('should throw on an invalid date', () => {
    try {
      toApiDate('2026-02-31')
      expect.fail('Should have thrown an error')
    } catch (error) {
      expect(error.message).to.include('Not a valid ISO date')
    }
  })
})

describe('fromApiDate', () => {
  it('should convert dd-MM-yyyy to ISO', () => {
    expect(fromApiDate('13-08-1992')).to.equal('1992-08-13')
  })

  it('should return unrecognised input unchanged', () => {
    expect(fromApiDate('1992-08-13')).to.equal('1992-08-13')
    expect(fromApiDate('whenever')).to.equal('whenever')
    expect(fromApiDate(undefined)).to.equal(undefined)
  })
})

describe('yearOf', () => {
  it('should extract the year as a number', () => {
    expect(yearOf('1992-08-13')).to.equal(1992)
  })

  it('should return null for an invalid date', () => {
    expect(yearOf('13-08-1992')).to.be.null
  })
})

describe('daysBetween', () => {
  it('should return zero for the same date', () => {
    expect(daysBetween('1992-08-13', '1992-08-13')).to.equal(0)
  })

  it('should be positive when the second date is later', () => {
    expect(daysBetween('1992-08-13', '1992-08-14')).to.equal(1)
  })

  it('should be negative when the second date is earlier', () => {
    expect(daysBetween('1992-08-13', '1992-08-12')).to.equal(-1)
  })

  it('should cross month and year boundaries', () => {
    expect(daysBetween('1992-12-31', '1993-01-01')).to.equal(1)
    expect(daysBetween('2024-02-28', '2024-03-01')).to.equal(2)
  })

  it('should be unaffected by the host timezone', () => {
    // This suite runs in NZ, where a local-time Date parse of an ISO string lands on
    // the previous UTC day. All arithmetic goes through Date.UTC to avoid that.
    const original = process.env.TZ
    process.env.TZ = 'Pacific/Auckland'
    expect(daysBetween('1992-08-13', '1992-08-14')).to.equal(1)
    process.env.TZ = 'UTC'
    expect(daysBetween('1992-08-13', '1992-08-14')).to.equal(1)
    process.env.TZ = original
  })

  it('should return null when either date is invalid', () => {
    expect(daysBetween('13-08-1992', '1992-08-14')).to.be.null
    expect(daysBetween('1992-08-13', 'nonsense')).to.be.null
  })
})
