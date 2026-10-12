'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import AppLayout from '@/components/AppLayout'

interface SessionRecord {
  id: string
  station_id: string
  games_count: number
  total_amount: number | null
  payment_method: string | null
  status: string
}

interface ShiftRecord {
  id: string
  status: 'open' | 'pending_verification' | 'settled' | 'rejected'
  variance: number | null
  expected_cash: number | null
  counted_cash: number | null
  note: string | null
}

export default function EmployeeDayPage() {
  const router = useRouter()
  const t = useT()
  const { user, profile, zone, loading } = useAuthGuard(['employee', 'admin'])

  const [shift, setShift] = useState<ShiftRecord | null>(null)
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [stationNames, setStationNames] = useState<Record<string, string>>({})
  const [sales, setSales] = useState<{ total: number; payment_method: string | null }[]>([])
  const [err, setErr] = useState('')
  const [cashCounted, setCashCounted] = useState('')
  const [shiftNote, setShiftNote] = useState('')
  const [busy, setBusy] = useState(false)

  const loadData = useCallback(async () => {
    if (!user) return

    // Load active or most recent shift
    const shiftRes = await sb
      .from('shifts')
      .select('id, status, variance, expected_cash, counted_cash, note')
      .eq('employee_id', user.id)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const activeShift = (shiftRes.data as ShiftRecord) || null
    setShift(activeShift)

    const [sessionsRes, stationsRes] = await Promise.all([
      activeShift
        ? sb
            .from('sessions')
            .select('id, station_id, games_count, total_amount, payment_method, status')
            .eq('shift_id', activeShift.id)
            .neq('status', 'cancelled')
            .order('started_at')
        : Promise.resolve({ data: [], error: null }),
      sb.from('stations').select('id, name'),
    ])

    if (sessionsRes.error || stationsRes.error) {
      setErr(msg(sessionsRes.error || stationsRes.error))
      return
    }

    setSessions((sessionsRes.data as SessionRecord[]) || [])
    setStationNames(
      Object.fromEntries(
        ((stationsRes.data || []) as { id: string; name: string }[]).map((x) => [x.id, x.name])
      )
    )

    if (activeShift) {
      const salesRes = await sb
        .from('sales')
        .select('total, payment_method')
        .eq('shift_id', activeShift.id)
        .is('voided_at', null)
      setSales((salesRes.data || []) as { total: number; payment_method: string | null }[])
    }
  }, [user])

  useEffect(() => {
    if (user) loadData()
  }, [user, loadData])

  const endedSessions = sessions.filter((s) => s.status === 'ended')
  const totalGames = endedSessions.reduce((acc, s) => acc + s.games_count, 0)

  // Payment totals breakdown
  const snackRevenue = (method?: string) =>
    sales
      .filter((s) => s.payment_method && (!method || s.payment_method === method))
      .reduce((acc, s) => acc + Number(s.total), 0)

  const sessionRevenue = (method?: string) =>
    endedSessions
      .filter((s) => !method || s.payment_method === method)
      .reduce((acc, s) => acc + (s.total_amount ?? 0), 0)

  const totalSum = (method?: string) => sessionRevenue(method) + snackRevenue(method)

  // Group sessions by station
  const sessionsByStation = Object.entries(
    sessions.reduce<Record<string, SessionRecord[]>>((acc, s) => {
      ;(acc[s.station_id] ??= []).push(s)
      return acc
    }, {})
  )

  const handleSubmitDay = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    const counted = Number(cashCounted)
    if (isNaN(counted) || counted < 0) {
      setErr('Please enter a valid cash amount counted.')
      setBusy(false)
      return
    }

    const { error } = await sb.rpc('close_shift', {
      p_counted: counted,
      p_note: shiftNote.trim() || null,
    })

    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setCashCounted('')
      setShiftNote('')
      loadData()
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-ink">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title={t('My day')}
      subtitle={`${totalGames} ${t('games')} · ${etb(totalSum())} total collected`}
      onRefresh={loadData}
    >
      <div className="max-w-2xl mx-auto space-y-5">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Shift Status Banners */}
        {shift?.status === 'rejected' && (
          <div className="rounded-2xl border border-bad/50 bg-bad/10 p-4 space-y-2">
            <div className="flex items-center gap-2 text-bad font-bold text-sm">
              <span>⚠️</span>
              <span>Shift Sent Back by Owner for Recount</span>
            </div>
            {shift.note && (
              <p className="text-xs text-ink/80 italic bg-surface-elevated/60 p-2.5 rounded-xl border border-line">
                Owner Note: “{shift.note}”
              </p>
            )}
            <p className="text-xs text-ink-muted">
              Please review your counted cash and notes below, make corrections, and resubmit.
            </p>
          </div>
        )}

        {shift?.status === 'pending_verification' && (
          <div className="surface-card-gold p-4.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm text-brand">Shift Submitted for Verification</span>
              <span className="rounded-full bg-brand/20 px-2 py-0.5 text-xs font-extrabold text-brand border border-brand/40">
                Pending
              </span>
            </div>
            <p className="text-xs text-ink-muted">
              Expected cash was {etb(shift.expected_cash)}, counted {etb(shift.counted_cash)}.
              Difference:{' '}
              <b className={shift.variance === 0 ? 'text-ok' : 'text-bad'}>
                {etb(shift.variance)}
              </b>
            </p>
          </div>
        )}

        {shift?.status === 'settled' && (
          <div className="rounded-2xl border border-ok/40 bg-ok/10 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-ok">Shift Settled</p>
              <p className="text-xs text-ink-muted">
                Your day closeout has been approved by the manager.
              </p>
            </div>
            <span className="text-2xl text-ok">✓</span>
          </div>
        )}

        {/* Payment Summary Cards */}
        <div className="grid grid-cols-3 gap-2.5 text-center">
          {(['cash', 'telebirr', 'cbe'] as const).map((method) => (
            <div key={method} className="surface-card p-3 space-y-1">
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-ink-muted">
                {method === 'cbe' ? 'CBE' : t(method)}
              </p>
              <p className="font-display text-base sm:text-lg font-bold text-ink">
                {etb(totalSum(method))}
              </p>
            </div>
          ))}
        </div>

        {/* Sessions list by unit */}
        <div className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Sessions Recorded Today</h2>
          {sessionsByStation.map(([stId, list]) => (
            <section key={stId} className="surface-card p-4 space-y-2.5">
              <h3 className="font-display text-sm font-bold text-brand">
                {stationNames[stId] ?? 'Unit'}
              </h3>
              <div className="space-y-1.5 divide-y divide-line/60">
                {list.map((s, idx) => (
                  <div key={s.id} className="pt-1.5 flex justify-between items-center text-xs">
                    <div>
                      <span className="font-semibold text-ink">
                        {t('Session')} {idx + 1}
                      </span>
                      <span className="text-ink-muted ml-2">
                        · {s.games_count} {t('games')}
                        {s.payment_method && ` (${s.payment_method})`}
                      </span>
                      {s.status === 'open' && (
                        <span className="ml-2 rounded bg-brand/20 px-1 py-0.5 text-[10px] text-brand font-bold">
                          {t('running')}
                        </span>
                      )}
                    </div>
                    <span className="font-bold text-ink">
                      {s.status === 'open' ? '—' : etb(s.total_amount)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}

          {sessions.length === 0 && (
            <div className="surface-card p-8 text-center text-xs text-ink-muted">
              {t('No sessions yet. Start a session on the counter screen.')}
            </div>
          )}
        </div>

        {/* Close Day Cash Reconciliation Form */}
        {(shift?.status === 'open' || shift?.status === 'rejected') && sessions.length > 0 && (
          <form
            onSubmit={handleSubmitDay}
            className="surface-card-gold p-5 space-y-4 shadow-xl"
          >
            <div className="border-b border-line pb-3">
              <h3 className="font-display text-lg font-bold text-ink">{t('Close your day')}</h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                {t('You should hand over')}{' '}
                <b className="text-brand font-display text-sm">{etb(totalSum('cash'))}</b>{' '}
                {t('in cash. Count the cash you have and enter it.')}
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  {t('Cash counted (ETB)')}
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={cashCounted}
                  onChange={(e) => setCashCounted(e.target.value)}
                  placeholder="0.00"
                  className="inp text-base font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  {t('Note for the owner (optional)')}
                </label>
                <input
                  value={shiftNote}
                  onChange={(e) => setShiftNote(e.target.value)}
                  placeholder="e.g. 50 ETB change shortage explained"
                  className="inp text-xs"
                />
              </div>
            </div>

            <button disabled={busy} className="btn btn-gold w-full">
              {busy ? 'Submitting…' : t('Submit day')}
            </button>
          </form>
        )}
      </div>
    </AppLayout>
  )
}
