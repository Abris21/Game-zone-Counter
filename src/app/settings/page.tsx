'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

export default function SettingsPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [currency, setCurrency] = useState('ETB')
  const [timezone, setTimezone] = useState('Africa/Addis_Ababa')
  const [reopenWindow, setReopenWindow] = useState('5')
  const [fifaExtraRule, setFifaExtraRule] = useState<'free' | 'half_price' | 'full_price' | 'flat_fee'>('free')
  const [fifaExtraFee, setFifaExtraFee] = useState('0')
  const [fifaPenaltyRule, setFifaPenaltyRule] = useState<'free' | 'half_price' | 'full_price' | 'flat_fee'>('free')
  const [fifaPenaltyFee, setFifaPenaltyFee] = useState('0')

  const [okMsg, setOkMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)

  const hydrateLocalSnapshot = useCallback(() => {
    const snapSettings = getLocalSnapshot<{ name: string; location: string; currency: string; timezone: string; reopen_window_minutes?: number; fifa_extra_time_rule?: string; fifa_extra_time_flat_fee?: number; fifa_penalties_rule?: string; fifa_penalties_flat_fee?: number }>('settings_zone')
    if (snapSettings.data) {
      setName(snapSettings.data.name || '')
      setLocation(snapSettings.data.location || '')
      setCurrency(snapSettings.data.currency || 'ETB')
      setTimezone(snapSettings.data.timezone || 'Africa/Addis_Ababa')
      setReopenWindow(String(snapSettings.data.reopen_window_minutes || 5))
      setFifaExtraRule((snapSettings.data.fifa_extra_time_rule as 'free' | 'half_price' | 'full_price' | 'flat_fee') || 'free')
      setFifaExtraFee(String(snapSettings.data.fifa_extra_time_flat_fee || 0))
      setFifaPenaltyRule((snapSettings.data.fifa_penalties_rule as 'free' | 'half_price' | 'full_price' | 'flat_fee') || 'free')
      setFifaPenaltyFee(String(snapSettings.data.fifa_penalties_flat_fee || 0))
      setHasLocalSnapshot(true)
      return true
    }
    setHasLocalSnapshot(false)
    return false
  }, [])

  useEffect(() => {
    hydrateLocalSnapshot()
      ; (async () => {
        const res = await sb
          .from('game_zones')
          .select('*')
          .maybeSingle()

        if (res.data) {
          const nextSettings = {
            name: res.data.name || '',
            location: res.data.location || '',
            currency: res.data.currency || 'ETB',
            timezone: res.data.timezone || 'Africa/Addis_Ababa',
            reopen_window_minutes: res.data.reopen_window_minutes || 5,
            fifa_extra_time_rule: res.data.fifa_extra_time_rule || 'free',
            fifa_extra_time_flat_fee: res.data.fifa_extra_time_flat_fee || 0,
            fifa_penalties_rule: res.data.fifa_penalties_rule || 'free',
            fifa_penalties_flat_fee: res.data.fifa_penalties_flat_fee || 0,
          }
          setName(nextSettings.name)
          setLocation(nextSettings.location)
          setCurrency(nextSettings.currency)
          setTimezone(nextSettings.timezone)
          setReopenWindow(String(nextSettings.reopen_window_minutes))
          setFifaExtraRule((nextSettings.fifa_extra_time_rule as 'free' | 'half_price' | 'full_price' | 'flat_fee') || 'free')
          setFifaExtraFee(String(nextSettings.fifa_extra_time_flat_fee))
          setFifaPenaltyRule((nextSettings.fifa_penalties_rule as 'free' | 'half_price' | 'full_price' | 'flat_fee') || 'free')
          setFifaPenaltyFee(String(nextSettings.fifa_penalties_flat_fee))
          setLocalSnapshot('settings_zone', nextSettings)
        }
      })()
  }, [hydrateLocalSnapshot])

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    setOkMsg('')

    const { error } = await sb.rpc('update_zone_settings', {
      p_name: name.trim(),
      p_location: location.trim(),
      p_currency: currency,
      p_timezone: timezone,
      p_reopen_window: Number(reopenWindow) || 5,
      p_fifa_extra_rule: fifaExtraRule,
      p_fifa_extra_fee: Number(fifaExtraFee) || 0,
      p_fifa_penalty_rule: fifaPenaltyRule,
      p_fifa_penalty_fee: Number(fifaPenaltyFee) || 0,
    })

    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setOkMsg('Game zone settings saved successfully.')
    }
  }

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading settings…</p>
          <p className="mt-1 text-xs text-ink-muted">Loading zone rules and billing configuration.</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Zone Rules & Settings"
      subtitle="Configure PlayStation billing rules, FIFA tie-break charges, and store preferences"
    >
      <div className="max-w-2xl mx-auto space-y-6">
        {okMsg && (
          <div role="status" className="rounded-2xl border border-ok/40 bg-ok/10 p-3.5 text-xs text-ok">
            ✓ {okMsg}
          </div>
        )}
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        <form onSubmit={handleSaveSettings} className="space-y-6">
          {/* General Game Zone Info */}
          <div className="surface-card p-5 space-y-4">
            <h2 className="font-display text-base font-bold text-ink">Business Profile</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Game Zone Name
                </label>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Blackout Game Lounge"
                  className="inp text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Location / Branch
                </label>
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Bole Medhanialem, Addis Ababa"
                  className="inp text-sm"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 pt-2 border-t border-line/60">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Currency</label>
                <input
                  disabled
                  value="Ethiopian Birr (ETB)"
                  className="inp text-xs bg-surface-elevated opacity-70"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">Timezone</label>
                <input
                  disabled
                  value="Africa/Addis_Ababa (EAT +3)"
                  className="inp text-xs bg-surface-elevated opacity-70"
                />
              </div>
            </div>
          </div>

          {/* Session Lifecycle Rules */}
          <div className="surface-card p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-ink">Session Lifecycle & Timing</h2>
              <p className="text-xs text-ink-muted">
                Control the allowable grace period for reopening just-ended sessions.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">
                Session Reopen Grace Window (Minutes)
              </label>
              <select
                value={reopenWindow}
                onChange={(e) => setReopenWindow(e.target.value)}
                className="inp text-xs"
              >
                <option value="3">3 Minutes</option>
                <option value="5">5 Minutes (Recommended)</option>
                <option value="10">10 Minutes</option>
                <option value="15">15 Minutes</option>
              </select>
              <p className="mt-1 text-[11px] text-ink-dim">
                Employees can undo and reopen an ended session within this window if the shift remains open.
              </p>
            </div>
          </div>

          {/* FIFA Extra Time & Penalty Rules */}
          <div className="surface-card p-5 space-y-4">
            <div>
              <h2 className="font-display text-base font-bold text-ink">
                FIFA / EA FC Tie-Break Billing Rules
              </h2>
              <p className="text-xs text-ink-muted">
                Define the surcharge policy when games finish in a draw and proceed to extra time or penalties.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {/* Extra Time Policy */}
              <div className="rounded-2xl border border-line bg-surface-elevated p-4 space-y-3">
                <h3 className="font-bold text-sm text-brand">⏱ Extra Time Policy</h3>
                <select
                  value={fifaExtraRule}
                  onChange={(e) => setFifaExtraRule(e.target.value as any)}
                  className="inp text-xs"
                >
                  <option value="free">Free (Included in match price)</option>
                  <option value="half_price">50% of Unit Match Price</option>
                  <option value="full_price">Full Additional Match Charge</option>
                  <option value="flat_fee">Custom Flat Fee (ETB)</option>
                </select>

                {fifaExtraRule === 'flat_fee' && (
                  <div>
                    <label className="block text-[11px] text-ink-dim uppercase font-bold mb-1">
                      Flat Fee Amount (ETB)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={fifaExtraFee}
                      onChange={(e) => setFifaExtraFee(e.target.value)}
                      placeholder="0.00"
                      className="inp text-xs font-bold text-brand"
                    />
                  </div>
                )}
              </div>

              {/* Penalties Policy */}
              <div className="rounded-2xl border border-line bg-surface-elevated p-4 space-y-3">
                <h3 className="font-bold text-sm text-brand">🥅 Penalty Shootout Policy</h3>
                <select
                  value={fifaPenaltyRule}
                  onChange={(e) => setFifaPenaltyRule(e.target.value as any)}
                  className="inp text-xs"
                >
                  <option value="free">Free (Included in match price)</option>
                  <option value="half_price">50% of Unit Match Price</option>
                  <option value="full_price">Full Additional Match Charge</option>
                  <option value="flat_fee">Custom Flat Fee (ETB)</option>
                </select>

                {fifaPenaltyRule === 'flat_fee' && (
                  <div>
                    <label className="block text-[11px] text-ink-dim uppercase font-bold mb-1">
                      Flat Fee Amount (ETB)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={fifaPenaltyFee}
                      onChange={(e) => setFifaPenaltyFee(e.target.value)}
                      placeholder="0.00"
                      className="inp text-xs font-bold text-brand"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <ActionButton disabled={busy} className="btn btn-gold w-full">
            {busy ? 'Saving Settings…' : 'Save Business Settings'}
          </ActionButton>
        </form>
      </div>
    </AppLayout>
  )
}
