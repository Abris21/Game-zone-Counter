/**
 * Exact monetary math and Ethiopian Birr formatting.
 * Uses integer cents (1 ETB = 100 cents) internally to eliminate floating-point rounding errors.
 */

/**
 * Converts a numeric or string currency amount into integer cents (1 ETB = 100 cents).
 */
export function toCents(amount: number | string | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount))
  if (isNaN(num)) return 0
  return Math.round(num * 100)
}

/**
 * Converts integer cents back to a decimal number.
 */
export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

/**
 * Adds multiple currency amounts without float drift.
 */
export function addMoney(...amounts: (number | string | null | undefined)[]): number {
  const totalCents = amounts.reduce<number>((acc, cur) => acc + toCents(cur), 0)
  return fromCents(totalCents)
}

/**
 * Subtracts b from a: (a - b) without float drift.
 */
export function subMoney(
  a: number | string | null | undefined,
  b: number | string | null | undefined
): number {
  return fromCents(toCents(a) - toCents(b))
}

/**
 * Multiplies an amount by a quantity without float drift.
 */
export function multiplyMoney(
  amount: number | string | null | undefined,
  quantity: number | string | null | undefined
): number {
  const qty = typeof quantity === 'number' ? quantity : parseFloat(String(quantity || 0))
  if (isNaN(qty) || qty === 0) return 0
  const totalCents = Math.round(toCents(amount) * qty)
  return fromCents(totalCents)
}

/**
 * Calculates net profit: Gross Revenue - Cost of Goods Sold - Expenses.
 */
export function calculateNetProfit(
  gameRevenue: number,
  snackRevenue: number,
  snackCost: number,
  expenses: number
): number {
  const grossCents = toCents(gameRevenue) + toCents(snackRevenue)
  const deductionCents = toCents(snackCost) + toCents(expenses)
  return fromCents(grossCents - deductionCents)
}

/**
 * Calculates shift variance: Counted Cash - Expected Cash.
 */
export function calculateShiftVariance(
  countedCash: number | string,
  expectedCash: number | string
): { variance: number; isMatch: boolean; isDeficit: boolean; isSurplus: boolean } {
  const diffCents = toCents(countedCash) - toCents(expectedCash)
  const variance = fromCents(diffCents)
  return {
    variance,
    isMatch: diffCents === 0,
    isDeficit: diffCents < 0,
    isSurplus: diffCents > 0,
  }
}

/**
 * Formats a currency amount to Ethiopian Birr with consistent formatting.
 *
 * Output format (per design spec): "ETB 0.00" (English) or "0.00 ብር" (Amharic).
 * English: prefix "ETB " before the number.
 * Amharic: suffix " ብር" after the number (conventional Ethiopian).
 */
export function formatETB(
  amount: number | null | undefined,
  overrideLang?: 'en' | 'am'
): string {
  const val = fromCents(toCents(amount))
  let lang = overrideLang
  if (!lang && typeof window !== 'undefined') {
    try {
      lang = (localStorage.getItem('gz-lang') as 'en' | 'am') || 'en'
    } catch {
      lang = 'en'
    }
  }
  const formatted = val.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  // Spec: "ETB 0.00" prefix format for English; "0.00 ብር" suffix for Amharic
  return lang === 'am' ? `${formatted} ብር` : `ETB ${formatted}`
}
