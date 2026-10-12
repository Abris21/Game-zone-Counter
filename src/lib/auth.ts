'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg } from './supabase'

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
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    zone: null,
    loading: true,
    error: null,
  })

  const check = useCallback(async () => {
    const { user, profile, error } = await getVerifiedProfile()
    if (!user || !profile) {
      router.replace('/login')
      return
    }

    if (!profile.is_active || profile.deleted_at) {
      await sb.auth.signOut()
      router.replace('/login?error=deactivated')
      return
    }

    if (profile.must_change_password && !window.location.pathname.startsWith('/account')) {
      router.replace('/account?force=1')
      return
    }

    // Verify game zone is active for non-super admins
    let zone: GameZone | null = null
    if (profile.role !== 'super_admin' && profile.zone_id) {
      const { data: zoneData } = await sb
        .from('game_zones')
        .select('*')
        .eq('id', profile.zone_id)
        .single()
      
      zone = zoneData as GameZone | null
      if (zone?.status === 'suspended') {
        await sb.auth.signOut()
        router.replace('/login?error=suspended')
        return
      }
    }

    if (allowedRoles && !allowedRoles.includes(profile.role)) {
      const dest = ROLE_HOMES[profile.role] || '/login'
      router.replace(dest)
      return
    }

    setState({
      user,
      profile,
      zone,
      loading: false,
      error: null,
    })
  }, [router, allowedRoles])

  useEffect(() => {
    check()
    const { data: authListener } = sb.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        cachedProfile = null
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
