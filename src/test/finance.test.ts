import { describe, it, expect } from 'vitest'
import {
  toCents,
  fromCents,
  addMoney,
  subMoney,
  multiplyMoney,
  calculateNetProfit,
  calculateShiftVariance,
  formatETB,
} from '../lib/finance'

describe('Financial Math & Currency Precision', () => {
  it('converts between ETB decimals and integer cents without float drift', () => {
    expect(toCents(100)).toBe(10000)
    expect(toCents('150.50')).toBe(15050)
    expect(toCents(0.1 + 0.2)).toBe(30) // solves standard float 0.30000000000000004
    expect(fromCents(15050)).toBe(150.5)
  })

  it('accurately adds multiple currency amounts', () => {
    // 0.1 + 0.2 = 0.3
    const sum = addMoney(0.1, 0.2)
    expect(sum).toBe(0.3)

    // Multiple session totals: 150 + 225.50 + 75.25
    expect(addMoney(150, 225.5, 75.25)).toBe(450.75)
  })

  it('accurately subtracts currency amounts', () => {
    expect(subMoney(100.5, 50.25)).toBe(50.25)
    expect(subMoney(200, 250)).toBe(-50)
  })

  it('accurately multiplies price by quantity', () => {
    expect(multiplyMoney(35.5, 3)).toBe(106.5)
    expect(multiplyMoney(120, 1.5)).toBe(180)
  })

  it('calculates net operating profit correctly (Gross - COGS - Expenses)', () => {
    // Game: 5000 ETB, Snack: 1200 ETB, Snack Cost: 800 ETB, Rent/Expenses: 2000 ETB
    // Expected: 5000 + 1200 - 800 - 2000 = 3400 ETB
    const profit = calculateNetProfit(5000, 1200, 800, 2000)
    expect(profit).toBe(3400)

    // Loss scenario
    const loss = calculateNetProfit(1000, 200, 150, 2500)
    expect(loss).toBe(-1450)
  })

  it('calculates shift reconciliation variance accurately', () => {
    // Match
    const match = calculateShiftVariance(1500, 1500)
    expect(match.variance).toBe(0)
    expect(match.isMatch).toBe(true)
    expect(match.isDeficit).toBe(false)
    expect(match.isSurplus).toBe(false)

    // Deficit (Employee counted less than expected cash)
    const deficit = calculateShiftVariance(1450, 1500)
    expect(deficit.variance).toBe(-50)
    expect(deficit.isMatch).toBe(false)
    expect(deficit.isDeficit).toBe(true)

    // Surplus
    const surplus = calculateShiftVariance(1550, 1500)
    expect(surplus.variance).toBe(50)
    expect(surplus.isSurplus).toBe(true)
  })

  it('formats ETB currency properly for English and Amharic (spec: "ETB 0.00")', () => {
    // English: "ETB " prefix per design spec, always 2 decimal places
    expect(formatETB(150, 'en')).toBe('ETB 150.00')
    expect(formatETB(150.5, 'en')).toBe('ETB 150.50')
    expect(formatETB(0, 'en')).toBe('ETB 0.00')
    expect(formatETB(null, 'en')).toBe('ETB 0.00')
    // Amharic: suffix " ብር"
    expect(formatETB(150, 'am')).toBe('150.00 ብር')
  })
})
