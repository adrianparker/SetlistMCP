import { expect } from 'chai'
import { greet } from '../src/index.js'

describe('greet', () => {
  it('returns a greeting for the given name', () => {
    expect(greet('world')).to.equal('Hello, world!')
  })
})
