import { createClient } from '@supabase/supabase-js'
import { getLang } from './i18n'
import { formatETB } from './finance'

const defaultUrl = 'https://placeholder.supabase.co'
const defaultKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.placeholder'

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || defaultUrl
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || defaultKey

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const ERR: Record<string, string> = {
  SESSION_ALREADY_ENDED: 'This session has already ended.',
  COUNT_OUT_OF_RANGE: 'Game count must stay between 0 and 200.',
  UNIT_BUSY: 'This unit already has an open session.',
  NOT_ALLOWED: 'You do not have permission for that.',
  LIMIT_REACHED: 'You reached the limit for this plan. Ask the platform owner to raise it.',
  USERNAME_TAKEN: 'That username or email is already taken.',
  INVALID_INPUT: 'Please check your inputs (valid format and minimum length required).',
  OPEN_SESSIONS: 'End all open sessions before closing your day.',
  NO_OPEN_SHIFT: 'You have no open day to close.',
  SHIFT_LOCKED: 'This day was already submitted or settled.',
  SHIFT_CONFLICT: 'This employee already has another open day. Settle that first.',
  OUT_OF_STOCK: 'Not enough stock for one or more items.',
  REASON_REQUIRED: 'Please enter a reason (at least 3 characters).',
  REOPEN_EXPIRED: 'Too late to reopen. The configured reopen window has elapsed.',
  ZONE_SUSPENDED: 'This game zone is suspended or deactivated. Contact the platform administrator.',
  TOURNAMENT_FULL: 'This tournament is already at maximum capacity.',
  TOURNAMENT_REGISTRATION_CLOSED: 'Registration for this tournament has closed.',
  TOURNAMENT_ALREADY_STARTED: 'Tournament matches have already begun.',
  PLAYER_ALREADY_REGISTERED: 'This player is already registered in this tournament.',
  INVALID_MATCH_RESULT: 'Invalid match result or scores.',
  TOO_MANY_REQUESTS: 'Too many requests. Please wait a moment before trying again.',
}

export const msg = (e: { message: string } | null | undefined): string => {
  if (!e || !e.message) return ''
  if (/fetch|network|load failed/i.test(e.message)) {
    return 'You are offline or the connection failed. This action needs an internet connection.'
  }
  const match = Object.entries(ERR).find(([k]) => e.message.includes(k))
  if (match) return match[1]
  return e.message || 'Something went wrong. Please check your connection and try again.'
}

export const etb = (n: number | null | undefined): string => formatETB(n)

export const api = async (body: object) => {
  const { data: { session } } = await sb.auth.getSession()
  const r = await fetch('/api/users', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  return {
    ok: r.ok,
    data: j,
    error: r.ok ? null : { message: String(j.error ?? 'Request failed') },
  }
}
