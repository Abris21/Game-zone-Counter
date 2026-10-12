/**
 * Single-elimination tournament bracket computation and layout helpers.
 */

export interface Participant {
  id: string
  name: string
  phone?: string | null
  seed?: number | null
  payment_status: 'unpaid' | 'paid' | 'refunded'
  payment_method?: string | null
}

export interface Match {
  id: string
  round: number
  match_number: number
  player1_id: string | null
  player2_id: string | null
  score1: number | null
  score2: number | null
  winner_id: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'walkover'
  next_match_id: string | null
  next_match_slot: number | null
}

/**
 * Returns round title based on current round number and total rounds.
 */
export function getRoundTitle(round: number, totalRounds: number): string {
  const diff = totalRounds - round
  if (diff === 0) return 'Championship Final'
  if (diff === 1) return 'Semi-Finals'
  if (diff === 2) return 'Quarter-Finals'
  return `Round ${round}`
}

/**
 * Calculates bracket dimensions for single elimination.
 */
export function calculateBracketStructure(playerCount: number): {
  bracketSize: number
  totalRounds: number
  byesCount: number
} {
  const count = Math.max(2, playerCount)
  let size = 2
  let rounds = 1

  while (size < count) {
    size *= 2
    rounds += 1
  }

  return {
    bracketSize: size,
    totalRounds: rounds,
    byesCount: size - count,
  }
}

/**
 * Validates if scores are valid and determines the winner for a match.
 */
export function validateMatchResult(
  score1: number,
  score2: number,
  player1Id: string,
  player2Id: string,
  allowDraw = false
): { valid: boolean; winnerId: string | null; error?: string } {
  if (score1 < 0 || score2 < 0) {
    return { valid: false, winnerId: null, error: 'Scores cannot be negative' }
  }
  if (!allowDraw && score1 === score2) {
    return {
      valid: false,
      winnerId: null,
      error: 'Ties require FIFA extra time or penalties to determine the winner',
    }
  }

  const winnerId = score1 > score2 ? player1Id : player2Id
  return { valid: true, winnerId }
}

/**
 * Calculates tournament accounting metrics.
 */
export function calculateTournamentAccounting(
  entryFee: number,
  paidPlayersCount: number,
  prizePool: number,
  organizerExpenses: number
): {
  grossRevenue: number
  netProfit: number
  isProfitable: boolean
} {
  const grossRevenue = Math.round(entryFee * paidPlayersCount * 100) / 100
  const deductions = Math.round((prizePool + organizerExpenses) * 100) / 100
  const netProfit = Math.round((grossRevenue - deductions) * 100) / 100

  return {
    grossRevenue,
    netProfit,
    isProfitable: netProfit >= 0,
  }
}
