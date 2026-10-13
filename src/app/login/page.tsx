'use client'
import ActionButton from '@/components/ActionButton'
import Image from 'next/image'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, SUPABASE_STATUS_MESSAGE, isSupabaseConfigured } from '@/lib/supabase'
import { useT, useI18n } from '@/lib/i18n'
import { ROLE_HOMES, UserRole } from '@/lib/auth'
import { PlayStationSymbolsRow } from '@/components/PlayStationIcons'
import LangSwitch from '@/components/LangSwitch'

export default function LoginPage() {
  const router = useRouter()
  const t = useT()
  const { lang } = useI18n()

  const [isRegisterMode, setIsRegisterMode] = useState(false)
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [zoneName, setZoneName] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const supabaseReady = isSupabaseConfigured()

  // Auto redirect if already signed in
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        sb.from('profiles')
          .select('role, is_active, must_change_password')
          .eq('id', session.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile?.is_active) {
              if (profile.must_change_password) {
                router.replace('/account?force=1')
              } else {
                router.replace(ROLE_HOMES[profile.role as UserRole] || '/counter')
              }
            }
          })
      }
    })
  }, [router])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    setNotice('')

    const identifier = usernameOrEmail.trim()
    const email = identifier.includes('@') ? identifier : `${identifier.toLowerCase()}@gz.local`

    const { data, error } = await sb.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data.user) {
      setErr(t('Wrong username or password.'))
      setBusy(false)
      return
    }

    // Verify verified profile from database
    const { data: profile, error: profErr } = await sb
      .from('profiles')
      .select('role, is_active, must_change_password, zone_id')
      .eq('id', data.user.id)
      .single()

    if (profErr || !profile || !profile.is_active) {
      await sb.auth.signOut()
      setErr(t('This account is deactivated. Ask your manager.'))
      setBusy(false)
      return
    }

    // Verify zone status
    if (profile.role !== 'super_admin' && profile.zone_id) {
      const { data: zoneOk } = await sb.rpc('zone_ok')
      if (!zoneOk) {
        await sb.auth.signOut()
        setErr(t('This game zone is suspended or closed. Contact the platform owner.'))
        setBusy(false)
        return
      }
    }

    if (profile.must_change_password) {
      router.replace('/account?force=1')
      return
    }

    const destination = ROLE_HOMES[profile.role as UserRole] || '/login'
    router.replace(destination)
  }

  const handleRegisterOwner = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    if (!usernameOrEmail.includes('@')) {
      setErr('Please enter a valid owner email address.')
      setBusy(false)
      return
    }

    if (password.length < 8) {
      setErr('Password must be at least 8 characters.')
      setBusy(false)
      return
    }

    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'register_owner',
          email: usernameOrEmail.trim().toLowerCase(),
          password,
          full_name: fullName.trim(),
          zone_name: zoneName.trim(),
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setErr(msg({ message: data.error || 'Registration failed' }))
        setBusy(false)
        return
      }

      setIsRegisterMode(false)
      setPassword('')
      setNotice('Registration received. A platform super-admin must approve your game zone before you can sign in.')
      setBusy(false)
    } catch {
      setErr('Network error during registration.')
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 relative overflow-hidden bg-bg">
      {/* Background ambient lighting */}
      <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-96 h-96 rounded-full bg-brand/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 right-1/4 w-80 h-80 rounded-full bg-ps-blue/10 blur-3xl pointer-events-none" />

      <div className="w-full max-w-sm space-y-6 relative z-10">
        {/* Brand header */}
        <div className="text-center space-y-2">
          <div className="relative mx-auto h-24 w-24 overflow-hidden rounded-2xl border border-line bg-[#080B11] shadow-glow">
            <Image src="/logo.png" alt="Gamezone Counter logo" fill sizes="96px" className="object-cover" priority />
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
            Gamezone Counter
          </h1>
          <p className="text-xs text-ink-muted">
            {isRegisterMode ? 'Register new game zone owner account' : t('Sign in to start counting')}
          </p>
          <div className="flex justify-center pt-1">
            <PlayStationSymbolsRow />
          </div>
        </div>

        {/* Login / Register Card */}
        <div className="surface-card p-6 shadow-2xl space-y-4">
          {err && (
            <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
              {err}
            </div>
          )}
          {notice && (
            <div role="status" className="rounded-xl border border-ok/40 bg-ok/10 p-3 text-xs text-ok">
              {notice}
            </div>
          )}

          {!supabaseReady && (
            <div role="alert" className="rounded-xl border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
              {SUPABASE_STATUS_MESSAGE}
            </div>
          )}

          <form onSubmit={isRegisterMode ? handleRegisterOwner : handleSignIn} className="space-y-3.5">
            {isRegisterMode && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Game Zone Name
                  </label>
                  <input
                    required
                    value={zoneName}
                    onChange={(e) => setZoneName(e.target.value)}
                    placeholder="e.g. Blackout PlayStation Lounge"
                    className="inp"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Owner Full Name
                  </label>
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="e.g. Dawit Haile"
                    className="inp"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">
                {isRegisterMode ? 'Owner Email' : t('Username or email')}
              </label>
              <input
                required
                type={isRegisterMode ? 'email' : 'text'}
                autoComplete={isRegisterMode ? 'email' : 'username'}
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                placeholder={isRegisterMode ? 'owner@example.com' : t('Username or email')}
                className="inp"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">
                {t('Password')}
              </label>
              <input
                required
                type="password"
                autoComplete={isRegisterMode ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('Password')}
                className="inp"
              />
            </div>

            <ActionButton disabled={busy || !supabaseReady} className="btn btn-gold w-full mt-2">
              {busy
                ? isRegisterMode
                  ? 'Registering…'
                  : t('Signing in…')
                : isRegisterMode
                  ? 'Create Game Zone'
                  : t('Sign in')}
            </ActionButton>
          </form>

          {/* Helper links */}
          <div className="pt-2 flex flex-col gap-2 text-center text-xs">
            {!isRegisterMode && (
              <a href="/forgot" className="text-brand hover:underline font-medium">
                {t('Forgot password?')}
              </a>
            )}

            <ActionButton
              type="button"
              onClick={() => {
                setIsRegisterMode(!isRegisterMode)
                setErr('')
              }}
              className="text-ink-muted hover:text-ink font-medium transition-colors"
            >
              {isRegisterMode
                ? 'Already have an account? Sign in'
                : 'New Game Zone? Register as Owner'}
            </ActionButton>
          </div>
        </div>

        {/* Language switch */}
        <div className="text-center">
          <LangSwitch />
        </div>
      </div>
    </main>
  )
}
