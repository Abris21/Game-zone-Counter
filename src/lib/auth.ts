'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, isSupabaseConfigured, SUPABASE_STATUS_MESSAGE } from './supabase'
import { setLocalSnapshotScope } from './offline'

export type UserRole = 'super_admin' | 'admin' | 'employee'

export interface Profile {
  id: string
  role: UserRole
  full_name: string | null
  username: string | null
  zone_id: string | null
  is_active: boolean
  must_change_password: boolean
  deleted_at: string | null
}

export interface GameZone {
  id: string
  name: string
  location: string | null
  currency: string
  timezone: string
  status: 'active' | 'suspended'
  max_employees: number
  max_stations: number
}

export const ROLE_HOMES: Record<UserRole, string> = {
  employee: '/counter',
  admin: '/monitor',
  super_admin: '/super',
}

export interface AuthState {
  user: { id: string; email?: string } | null
  profile: Profile | null
  zone: GameZone | null
  loading: boolean
  error: string | null
}

let cachedProfile: { userId: string; profile: Profile; timestamp: number } | null = null
let cachedGuardState: { userId: string; state: Omit<AuthState, 'loading' | 'error'>; timestamp: number } | null = null
let cachedZone: { zoneId: string; zone: GameZone | null; timestamp: number } | null = null
const AUTH_CACHE_MS = 30_000

/** Clear client-side auth snapshots after a profile/security change. */
export function invalidateAuthCache() {
  cachedProfile = null
  cachedGuardState = null
  cachedZone = null
}

/**
 * Validates the current user session and fetches the verified database profile.
 * Server-authoritative: does not trust localStorage for role information.
 */
export async function getVerifiedProfile(forceRefresh = false): Promise<{
  user: { id: string; email?: string } | null
  profile: Profile | null
  error: string | null
}> {
  try {
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) {
      cachedProfile = null
      return { user: null, profile: null, error: authErr ? msg(authErr) : null }
    }

    const now = Date.now()
    if (!forceRefresh && cachedProfile && cachedProfile.userId === user.id && (now - cachedProfile.timestamp < 30000)) {
      return { user, profile: cachedProfile.profile, error: null }
    }

    const { data: profile, error: profErr } = await sb
      .from('profiles')
      .select('id, role, full_name, username, zone_id, is_active, must_change_password, deleted_at')
      .eq('id', user.id)
      .single()

    if (profErr || !profile) {
      cachedProfile = null
      return { user, profile: null, error: profErr ? msg(profErr) : 'Profile not found' }
    }

    cachedProfile = { userId: user.id, profile: profile as Profile, timestamp: now }
    return { user, profile: profile as Profile, error: null }
  } catch (err) {
    return { user: null, profile: null, error: err instanceof Error ? err.message : 'Auth verification failed' }
  }
}

/**
 * React hook to guard pages by role. Automatically redirects unauthorized users.
 */
export function useAuthGuard(allowedRoles?: UserRole[]) {
  const router = useRouter()
  // Callers commonly pass an inline array; depend on its values rather than
  // its new reference so rerenders do not restart auth validation.
  const allowedRoleKey = allowedRoles?.join('|') || ''
  const [state, setState] = useState<AuthState>(() => {
    const cached = cachedGuardState
    if (cached && Date.now() - cached.timestamp < AUTH_CACHE_MS) {
      setLocalSnapshotScope(cached.userId, cached.state.profile?.zone_id)
      return { ...cached.state, loading: false, error: null }
    }
    return { user: null, profile: null, zone: null, loading: true, error: null }
  })

  const check = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLocalSnapshotScope(null)
      setState({ user: null, profile: null, zone: null, loading: false, error: SUPABASE_STATUS_MESSAGE || 'Supabase is not configured.' })
      return
    }

    const { user, profile, error } = await getVerifiedProfile()
    if (!user || !profile) {
      setLocalSnapshotScope(null)
      router.replace('/login')
      return
    }

    if (!profile.is_active || profile.deleted_at) {
      setLocalSnapshotScope(null)
      await sb.auth.signOut()
      router.replace('/login?error=deactivated')
      return
    }

    if (profile.must_change_password && !window.location.pathname.startsWith('/account')) {
      setLocalSnapshotScope(null)
      router.replace('/account?force=1')
      return
    }

    // Verify game zone is active for non-super admins
    let zone: GameZone | null = null
    if (profile.role !== 'super_admin' && profile.zone_id) {
      if (cachedZone?.zoneId === profile.zone_id && Date.now() - cachedZone.timestamp < AUTH_CACHE_MS) {
        zone = cachedZone.zone
      } else {
        const { data: zoneData } = await sb
          .from('game_zones')
          .select('*')
          .eq('id', profile.zone_id)
          .single()
        zone = zoneData as GameZone | null
        cachedZone = { zoneId: profile.zone_id, zone, timestamp: Date.now() }
      }
      if (zone?.status === 'suspended') {
        setLocalSnapshotScope(null)
        await sb.auth.signOut()
        router.replace('/login?error=suspended')
        return
      }
    }

    if (allowedRoleKey && !allowedRoleKey.split('|').includes(profile.role)) {
      const dest = ROLE_HOMES[profile.role] || '/login'
      router.replace(dest)
      return
    }

    const verifiedState = {
      user,
      profile,
      zone,
    }
    setLocalSnapshotScope(user.id, profile.zone_id)
    cachedGuardState = { userId: user.id, state: verifiedState, timestamp: Date.now() }
    setState({
      ...verifiedState,
      loading: false,
      error: null,
    })
  }, [router, allowedRoleKey])

  useEffect(() => {
    check()
    const { data: authListener } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setLocalSnapshotScope(null)
        cachedProfile = null
        cachedGuardState = null
        cachedZone = null
        router.replace('/login')
      } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
        check()
      }
    })
    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [check, router])

  return state
}
