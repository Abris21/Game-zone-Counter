import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '../lib/rateLimit'

describe('Rate Limiter & Abuse Protection', () => {
  it('allows requests within max limits and decrements remaining', () => {
    const key = `test-user-${Date.now()}`
    const r1 = checkRateLimit(key, { windowMs: 10000, maxRequests: 3 })
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBe(2)

    const r2 = checkRateLimit(key, { windowMs: 10000, maxRequests: 3 })
    expect(r2.allowed).toBe(true)
    expect(r2.remaining).toBe(1)

    const r3 = checkRateLimit(key, { windowMs: 10000, maxRequests: 3 })
    expect(r3.allowed).toBe(true)
    expect(r3.remaining).toBe(0)
  })

  it('blocks requests exceeding maximum allowance', () => {
    const key = `test-block-${Date.now()}`
    checkRateLimit(key, { windowMs: 10000, maxRequests: 2 })
    checkRateLimit(key, { windowMs: 10000, maxRequests: 2 })

    const blocked = checkRateLimit(key, { windowMs: 10000, maxRequests: 2 })
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetMs).toBeGreaterThan(0)
  })
})
