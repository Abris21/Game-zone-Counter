import { describe, it, expect } from 'vitest'
import {
  calculateBracketStructure,
  validateMatchResult,
  calculateTournamentAccounting,
  getRoundTitle,
} from '../lib/tournamentBrackets'

describe('Tournament Bracket Generation & Accounting', () => {
  it('calculates single-elimination bracket sizes and byes correctly', () => {
    // 4 players -> size 4, 2 rounds, 0 byes
    const b4 = calculateBracketStructure(4)
    expect(b4.bracketSize).toBe(4)
    expect(b4.totalRounds).toBe(2)
    expect(b4.byesCount).toBe(0)

    // 8 players -> size 8, 3 rounds, 0 byes
    const b8 = calculateBracketStructure(8)
    expect(b8.bracketSize).toBe(8)
    expect(b8.totalRounds).toBe(3)
    expect(b8.byesCount).toBe(0)

    // 5 players -> size 8, 3 rounds, 3 byes
    const b5 = calculateBracketStructure(5)
    expect(b5.bracketSize).toBe(8)
    expect(b5.totalRounds).toBe(3)
    expect(b5.byesCount).toBe(3)

    // 16 players -> size 16, 4 rounds
    const b16 = calculateBracketStructure(16)
    expect(b16.bracketSize).toBe(16)
    expect(b16.totalRounds).toBe(4)
  })

  it('provides human-readable round names', () => {
    expect(getRoundTitle(4, 4)).toBe('Championship Final')
    expect(getRoundTitle(3, 4)).toBe('Semi-Finals')
    expect(getRoundTitle(2, 4)).toBe('Quarter-Finals')
    expect(getRoundTitle(1, 4)).toBe('Round 1')
  })

  it('validates match scores and advances winner', () => {
    // Player 1 wins 3-1
    const res1 = validateMatchResult(3, 1, 'p1', 'p2')
    expect(res1.valid).toBe(true)
    expect(res1.winnerId).toBe('p1')

    // Player 2 wins 0-2
    const res2 = validateMatchResult(0, 2, 'p1', 'p2')
    expect(res2.valid).toBe(true)
    expect(res2.winnerId).toBe('p2')

    // Tie (disallowed in single elimination)
    const tie = validateMatchResult(2, 2, 'p1', 'p2')
    expect(tie.valid).toBe(false)
    expect(tie.winnerId).toBeNull()
    expect(tie.error).toContain('Ties require FIFA extra time')

    // Negative scores disallowed
    const negative = validateMatchResult(-1, 2, 'p1', 'p2')
    expect(negative.valid).toBe(false)
  })

  it('calculates tournament financial accounting correctly', () => {
    // 20 players paying ETB 100 each -> Gross ETB 2,000. Prize: ETB 1,200. Expenses: ETB 300.
    // Net profit: 2,000 - 1,200 - 300 = ETB 500
    const report = calculateTournamentAccounting(100, 20, 1200, 300)
    expect(report.grossRevenue).toBe(2000)
    expect(report.netProfit).toBe(500)
    expect(report.isProfitable).toBe(true)

    // Unprofitable tournament
    const loss = calculateTournamentAccounting(50, 10, 800, 100)
    expect(loss.grossRevenue).toBe(500)
    expect(loss.netProfit).toBe(-400)
    expect(loss.isProfitable).toBe(false)
  })
})
