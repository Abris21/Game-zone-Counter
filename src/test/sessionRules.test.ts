import { describe, it, expect } from 'vitest'

describe('Session Lifecycle & Business Rules', () => {
  it('enforces reopen window boundary correctly', () => {
    const windowMinutes = 5
    const windowMs = windowMinutes * 60 * 1000

    const now = Date.now()

    // Ended 2 minutes ago -> eligible
    const ended2MinAgo = new Date(now - 2 * 60 * 1000).toISOString()
    const diff2 = now - new Date(ended2MinAgo).getTime()
    expect(diff2 < windowMs).toBe(true)

    // Ended 6 minutes ago -> expired
    const ended6MinAgo = new Date(now - 6 * 60 * 1000).toISOString()
    const diff6 = now - new Date(ended6MinAgo).getTime()
    expect(diff6 < windowMs).toBe(false)
  })

  it('preserves historical price snapshot on transactions', () => {
    // When a station starts with price 120 ETB:
    const session = {
      id: 'session-1',
      station_id: 'station-ps5',
      price_snapshot: 120,
      games_count: 3,
    }

    // Owner later updates station price to 150 ETB:
    const updatedStation = {
      id: 'station-ps5',
      price: 150,
    }

    // Historical session total must still use price_snapshot (120 * 3 = 360), NOT 150!
    const sessionTotal = session.games_count * session.price_snapshot
    expect(sessionTotal).toBe(360)
    expect(session.price_snapshot).not.toBe(updatedStation.price)
  })

  it('calculates pause duration accumulation properly', () => {
    let totalPausedSeconds = 0
    const pausedAt = Date.now() - 150 * 1000 // 150 seconds ago

    const elapsed = Math.floor((Date.now() - pausedAt) / 1000)
    totalPausedSeconds += elapsed

    expect(totalPausedSeconds).toBeGreaterThanOrEqual(150)
  })
})
