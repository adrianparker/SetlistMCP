import { describe, it } from 'mocha'
import { expect } from 'chai'
import { describeError, errorResult, textResult } from '../../src/tools/toolResult.js'
import { ConfigurationError, DailyQuotaExceededError, HttpError, TimeoutError } from '../../src/services/errors.js'

describe('textResult', () => {
  it('should carry both a text block and structured content', () => {
    const result = textResult('a summary', { count: 1 })

    expect(result.content).to.deep.equal([{ type: 'text', text: 'a summary' }])
    expect(result.structuredContent).to.deep.equal({ count: 1 })
    expect(result.isError).to.equal(undefined)
  })
})

describe('errorResult', () => {
  it('should flag the result as an error', () => {
    const result = errorResult('it broke')

    expect(result.isError).to.be.true
    expect(result.content[0].text).to.equal('it broke')
    expect(result.structuredContent).to.equal(undefined)
  })
})

describe('describeError', () => {
  it('should tell the caller how to fix a configuration problem', () => {
    const text = describeError(new ConfigurationError('SETLISTFM_API_KEY is not set.'))

    expect(text).to.include('not configured')
    expect(text).to.include('SETLISTFM_API_KEY')
  })

  it('should explain that the daily budget is self-imposed', () => {
    const text = describeError(new DailyQuotaExceededError('setlist.fm', 1300))

    expect(text).to.include('self-imposed')
    expect(text).to.include('1300')
  })

  it('should suggest retrying after a timeout', () => {
    const text = describeError(new TimeoutError('Setlist.fm', 10000))

    expect(text).to.include('10000ms')
    expect(text).to.include('again')
  })

  it('should point at the api key for a 401', () => {
    const text = describeError(new HttpError('nope', { status: 401 }))

    expect(text).to.include('SETLISTFM_API_KEY')
  })

  it('should point at the api key for a 403', () => {
    expect(describeError(new HttpError('nope', { status: 403 }))).to.include('SETLISTFM_API_KEY')
  })

  it('should advise waiting after an unresolved 429', () => {
    const text = describeError(new HttpError('too many', { status: 429 }))

    expect(text).to.include('rate limiting')
    expect(text).to.include('Wait')
  })

  it('should describe a server error as temporary', () => {
    expect(describeError(new HttpError('boom', { status: 503 }))).to.include('temporary')
  })

  it('should fall back to the http error message for other statuses', () => {
    expect(describeError(new HttpError('Bad Request details', { status: 400 }))).to.equal('Bad Request details')
  })

  it('should handle an unrecognised error', () => {
    expect(describeError(new Error('something odd'))).to.include('something odd')
  })

  it('should handle a non-error value without throwing', () => {
    expect(describeError(undefined)).to.include('undefined')
  })
})
