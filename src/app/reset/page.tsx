'use client'
import ActionButton from '@/components/ActionButton'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { sb } from '@/lib/supabase'
import { PlayStationSymbolsRow } from '@/components/PlayStationIcons'

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    const { data: listener } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    if (password.length < 8) {
      setErr('Password must be 8 or more characters.')
      setBusy(false)
      return
    }

    if (password !== confirmPassword) {
      setErr('Passwords do not match.')
      setBusy(false)
      return
    }

    const { error } = await sb.auth.updateUser({ password })
    setBusy(false)
    if (error) {
      setErr(error.message)
    } else {
      await sb.auth.signOut()
      setDone(true)
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 bg-bg relative">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-3xl font-extrabold text-ink">Set New Password</h1>
          <p className="text-xs text-ink-muted">
            Choose a strong, memorable password for your game zone account
          </p>
          <div className="flex justify-center pt-1">
            <PlayStationSymbolsRow />
          </div>
        </div>

        <div className="surface-card p-6 shadow-2xl space-y-4">
          {err && (
            <div role="alert" className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
              {err}
            </div>
          )}

          {done ? (
            <div className="rounded-2xl border border-ok/40 bg-ok/10 p-4 text-center space-y-3">
              <span className="text-2xl text-ok">✓</span>
              <p className="text-sm font-bold text-ok">Password Successfully Updated</p>
              <p className="text-xs text-ink-muted">
                Your credentials have been securely updated. You can now sign in.
              </p>
              <Link href="/login" className="btn btn-gold w-full mt-2 text-xs">
                Proceed to Sign In
              </Link>
            </div>
          ) : !ready ? (
            <div className="p-6 text-center text-xs text-ink-muted space-y-3">
              <p>Please open this recovery page directly from the link sent to your email address.</p>
              <Link href="/login" className="btn btn-secondary w-full text-xs">
                Back to Sign In
              </Link>
            </div>
          ) : (
            <form onSubmit={handleUpdate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  New Password (8+ characters)
                </label>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className="inp"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Confirm New Password
                </label>
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="inp"
                />
              </div>

              <ActionButton disabled={busy} className="btn btn-gold w-full">
                {busy ? 'Updating…' : 'Update Password'}
              </ActionButton>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}
