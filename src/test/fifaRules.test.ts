import { describe, it, expect } from 'vitest'

describe('FIFA Extra Time & Penalty Surcharge Rules', () => {
  function computeFifaSurcharge(
    basePrice: number,
    rule: 'free' | 'half_price' | 'full_price' | 'flat_fee',
    flatFee = 0
  ): number {
    switch (rule) {
      case 'half_price':
        return Math.round((basePrice / 2) * 100) / 100
      case 'full_price':
        return basePrice
      case 'flat_fee':
        return Math.max(0, flatFee)
      case 'free':
      default:
        return 0
    }
  }

  it('calculates free extra time (default rule)', () => {
    expect(computeFifaSurcharge(150, 'free')).toBe(0)
    expect(computeFifaSurcharge(200, 'free', 50)).toBe(0)
  })

  it('calculates half price extra time', () => {
    expect(computeFifaSurcharge(150, 'half_price')).toBe(75)
    expect(computeFifaSurcharge(75, 'half_price')).toBe(37.5)
  })

  it('calculates full price extra time', () => {
    expect(computeFifaSurcharge(150, 'full_price')).toBe(150)
  })

  it('calculates flat fee extra time', () => {
    expect(computeFifaSurcharge(150, 'flat_fee', 30)).toBe(30)
    expect(computeFifaSurcharge(200, 'flat_fee', 50)).toBe(50)
  })

  it('correctly totals session bill with games and tie-break surcharges', () => {
    const gamesCount = 2
    const priceSnapshot = 120
    const extraTimeCharge = computeFifaSurcharge(priceSnapshot, 'half_price') // 60
    const penaltiesCharge = computeFifaSurcharge(priceSnapshot, 'flat_fee', 25) // 25
    const snacksTotal = 80

    const total = gamesCount * priceSnapshot + extraTimeCharge + penaltiesCharge + snacksTotal
    expect(total).toBe(240 + 60 + 25 + 80) // 405
    expect(total).toBe(405)
  })
})
