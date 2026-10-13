'use client'
import ActionButton from '@/components/ActionButton'

import React, { useState } from 'react'
import Link from 'next/link'
import { sb } from '@/lib/supabase'
import { PlayStationSymbolsRow } from '@/components/PlayStationIcons'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    try {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset`,
      })
      setBusy(false)
      if (error) {
        setErr(error.message)
      } else {
        setSent(true)
      }
    } catch {
      setBusy(false)
      setErr('Failed to request password reset.')
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-8 bg-bg relative">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="font-display text-3xl font-extrabold text-ink">Reset Password</h1>
          <p className="text-xs text-ink-muted">
            Game zone owners can receive a secure password recovery link
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

          {sent ? (
            <div className="rounded-2xl border border-ok/40 bg-ok/10 p-4 text-center space-y-2">
              <span className="text-2xl text-ok">✉️</span>
              <p className="text-sm font-bold text-ok">Reset Link Sent</p>
              <p className="text-xs text-ink-muted">
                If that email exists in our records, instructions have been dispatched. Check your inbox and spam folder.
              </p>
            </div>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <p className="text-xs text-ink-muted leading-relaxed">
                Note: Employees should ask their game zone owner to reset their password directly from the Staff Management screen.
              </p>
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Owner Email Address
                </label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@example.com"
                  className="inp"
                />
              </div>

              <ActionButton disabled={busy} className="btn btn-gold w-full">
                {busy ? 'Sending…' : 'Send Recovery Link'}
              </ActionButton>
            </form>
          )}

          <div className="text-center pt-2">
            <Link href="/login" className="text-xs text-brand hover:underline font-semibold">
              ← Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </main>
  )
}
