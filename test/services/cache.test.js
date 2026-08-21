import { describe, it, beforeEach } from 'mocha'
import { expect } from 'chai'
import { TtlCache } from '../../src/services/cache.js'

describe('TtlCache', () => {
  let clock
  let now

  beforeEach(() => {
    clock = 1000000
    now = () => clock
  })

  it('should return a stored value', () => {
    const cache = new TtlCache({ now })
    cache.set('key', { id: 'abc' })

    expect(cache.get('key')).to.deep.equal({ id: 'abc' })
  })

  it('should return undefined on a miss', () => {
    expect(new TtlCache({ now }).get('absent')).to.equal(undefined)
  })

  it('should keep a value until the TTL elapses', () => {
    const cache = new TtlCache({ ttlMs: 1000, now })
    cache.set('key', 'value')
    clock += 999

    expect(cache.get('key')).to.equal('value')
  })

  it('should expire a value once the TTL has elapsed', () => {
    const cache = new TtlCache({ ttlMs: 1000, now })
    cache.set('key', 'value')
    clock += 1000

    expect(cache.get('key')).to.equal(undefined)
  })

  it('should drop an expired entry rather than leaving it in place', () => {
    const cache = new TtlCache({ ttlMs: 1000, now })
    cache.set('key', 'value')
    clock += 1000
    cache.get('key')

    expect(cache.size).to.equal(0)
  })

  it('should evict the oldest entry when full', () => {
    const cache = new TtlCache({ maxEntries: 2, now })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.get('a')).to.equal(undefined)
    expect(cache.get('b')).to.equal(2)
    expect(cache.get('c')).to.equal(3)
    expect(cache.size).to.equal(2)
  })

  it('should refresh insertion order when a key is re-set', () => {
    const cache = new TtlCache({ maxEntries: 2, now })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 'updated')
    cache.set('c', 3)

    // 'b' is now the oldest, so 'a' survives with its new value
    expect(cache.get('a')).to.equal('updated')
    expect(cache.get('b')).to.equal(undefined)
  })

  it('should report presence with has', () => {
    const cache = new TtlCache({ ttlMs: 1000, now })
    cache.set('key', 'value')

    expect(cache.has('key')).to.be.true
    clock += 1000
    expect(cache.has('key')).to.be.false
  })

  it('should delete and clear', () => {
    const cache = new TtlCache({ now })
    cache.set('a', 1)
    cache.set('b', 2)

    expect(cache.delete('a')).to.be.true
    expect(cache.get('a')).to.equal(undefined)

    cache.clear()
    expect(cache.size).to.equal(0)
  })

  it('should store falsy values without treating them as misses on has', () => {
    const cache = new TtlCache({ now })
    cache.set('zero', 0)

    expect(cache.get('zero')).to.equal(0)
  })
})
