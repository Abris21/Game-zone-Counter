'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import { useT } from '@/lib/i18n'
import AppLayout from '@/components/AppLayout'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface SessionRecord {
  id: string
  station_id: string
  games_count: number
  price_snapshot: number
  fifa_extra_charge: number
  started_at: string
  ended_at: string | null
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
  const [shiftSessions, setShiftSessions] = useState<SessionRecord[]>([])
  const [stationNames, setStationNames] = useState<Record<string, string>>({})
  const [sales, setSales] = useState<{
    total: number
    payment_method: string | null
    session_id: string | null
  }[]>([])
  const [shiftSales, setShiftSales] = useState<{ total: number; payment_method: string | null }[]>([])
  const [err, setErr] = useState('')
  const [cashCounted, setCashCounted] = useState('')
  const [shiftNote, setShiftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)
  const loadVersion = useRef(0)
  const refreshQueued = useRef(false)

  const hydrateLocalSnapshot = useCallback(() => {
    const localSessions = getLocalSnapshot<SessionRecord[]>('counter_day_sessions')
    const localShift = getLocalSnapshot<ShiftRecord>('counter_day_shift')
    const localSales = getLocalSnapshot<{ total: number; payment_method: string | null; session_id: string | null }[]>('counter_day_sales')
    const localShiftSales = getLocalSnapshot<{ total: number; payment_method: string | null }[]>('counter_day_shift_sales')
    const localStationNames = getLocalSnapshot<Record<string, string>>('counter_day_station_names')

    const hasAny = Boolean(
      localSessions.data || localShift.data || localSales.data || localShiftSales.data || localStationNames.data
    )

    if (localSessions.data) setSessions(localSessions.data)
    if (localShift.data) setShift(localShift.data)
    if (localSales.data) setSales(localSales.data)
    if (localShiftSales.data) setShiftSales(localShiftSales.data)
    if (localStationNames.data) setStationNames(localStationNames.data)
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadData = useCallback(async () => {
    if (!user) return
    const version = ++loadVersion.current

    hydrateLocalSnapshot()

    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    const nextDay = new Date(dayStart)
    nextDay.setDate(nextDay.getDate() + 1)
    const dayFilter = `status.eq.open,and(started_at.gte.${dayStart.toISOString()},started_at.lt.${nextDay.toISOString()}),and(ended_at.gte.${dayStart.toISOString()},ended_at.lt.${nextDay.toISOString()})`
    // Fetch the data used by the page header in parallel with shift metadata.
    // Previously the shift request completed before these requests even began.
    const shiftRequest = sb.from('shifts')
      .select('id, status, variance, expected_cash, counted_cash, note')
      .eq('employee_id', user.id)
      .order('opened_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const sessionsRequest = sb.from('sessions')
      .select('id, station_id, games_count, price_snapshot, fifa_extra_charge, started_at, ended_at, total_amount, payment_method, status')
      .eq('employee_id', user.id)
      .neq('status', 'cancelled')
      .or(dayFilter)
      .order('started_at')
    const stationsRequest = sb.from('stations').select('id, name')
    const salesRequest = sb.from('sales').select('total, payment_method, session_id')
      .eq('employee_id', user.id)
      .gte('created_at', dayStart.toISOString())
      .lt('created_at', nextDay.toISOString())
      .is('voided_at', null)

    // Sessions drive the page headline. Show them as soon as that request
    // returns instead of waiting for sales and station metadata too.
    const sessionsRes = await sessionsRequest

    if (version !== loadVersion.current) return
    if (!sessionsRes.error) {
      const nextSessions = (sessionsRes.data as SessionRecord[]) || []
      setSessions(nextSessions)
      setLocalSnapshot('counter_day_sessions', nextSessions)
    }

    const [shiftRes, stationsRes, salesRes] = await Promise.all([
      shiftRequest,
      stationsRequest,
      salesRequest,
    ])
    if (version !== loadVersion.current) return
    const activeShift = (shiftRes.data as ShiftRecord) || null
    if (!stationsRes.error) {
      const nextNames = Object.fromEntries(((stationsRes.data || []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
      setStationNames(nextNames)
      setLocalSnapshot('counter_day_station_names', nextNames)
    }
    if (!salesRes.error) {
      const nextSales = (salesRes.data || []) as { total: number; payment_method: string | null; session_id: string | null }[]
      setSales(nextSales)
      setLocalSnapshot('counter_day_sales', nextSales)
    }
    if (!shiftRes.error) {
      setShift(activeShift)
      setLocalSnapshot('counter_day_shift', activeShift)
    }

    const [shiftSessionsRes, shiftSalesRes] = activeShift ? await Promise.all([
      sb.from('sessions').select('id, station_id, games_count, price_snapshot, fifa_extra_charge, started_at, ended_at, total_amount, payment_method, status')
        .eq('shift_id', activeShift.id).neq('status', 'cancelled').order('started_at'),
      sb.from('sales').select('total, payment_method')
        .eq('shift_id', activeShift.id).is('voided_at', null),
    ]) : [
      { data: [] as SessionRecord[], error: null },
      { data: [] as { total: number; payment_method: string | null }[], error: null },
    ]

    if (version !== loadVersion.current) return
    if (!shiftSessionsRes.error) {
      const nextSessions = (shiftSessionsRes.data as SessionRecord[]) || []
      setShiftSessions(nextSessions)
    }
    if (!shiftSalesRes.error) {
      const nextShiftSales = (shiftSalesRes.data || []) as { total: number; payment_method: string | null }[]
      setShiftSales(nextShiftSales)
      setLocalSnapshot('counter_day_shift_sales', nextShiftSales)
    }

    const queryError = shiftRes.error || sessionsRes.error || stationsRes.error || salesRes.error || shiftSessionsRes.error || shiftSalesRes.error
    setErr(queryError ? msg(queryError) : '')
  }, [user])

  const scheduleRefresh = useCallback(() => {
    if (refreshQueued.current) return
    refreshQueued.current = true
    if (typeof window === 'undefined') {
      refreshQueued.current = false
      void loadData()
      return
    }

    requestAnimationFrame(() => {
      refreshQueued.current = false
      void loadData()
    })
  }, [loadData])

  useEffect(() => {
    if (user) {
      hydrateLocalSnapshot()
      void loadData()
    }
  }, [user, loadData, hydrateLocalSnapshot])

  useEffect(() => {
    if (!user) return
    const refresh = () => scheduleRefresh()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const channel = sb
      .channel(`employee-day-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, refresh)
      .subscribe()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      void sb.removeChannel(channel)
    }
  }, [user, scheduleRefresh])

  const endedSessions = useMemo(
    () => sessions.filter((s) => s.status === 'ended'),
    [sessions]
  )
  const recordedSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'cancelled'),
    [sessions]
  )
  const totalGames = useMemo(
    () => recordedSessions.reduce((acc, s) => acc + s.games_count, 0),
    [recordedSessions]
  )

  const paymentTotals = useMemo(() => {
    const byMethod = {
      cash: 0,
      telebirr: 0,
      cbe: 0,
    } as Record<string, number>

    for (const sale of sales) {
      if (!sale.payment_method) continue
      const key = sale.payment_method === 'cash' || sale.payment_method === 'telebirr' || sale.payment_method === 'cbe'
        ? sale.payment_method
        : 'cash'
      byMethod[key] += Number(sale.total)
    }

    for (const session of endedSessions) {
      if (!session.payment_method) continue
      const key = session.payment_method === 'cash' || session.payment_method === 'telebirr' || session.payment_method === 'cbe'
        ? session.payment_method
        : 'cash'
      byMethod[key] += Number(session.total_amount || 0)
    }

    return byMethod
  }, [sales, endedSessions])

  const snackRevenue = useCallback(
    (method?: string) =>
      sales
        .filter((s) => s.payment_method && (!method || s.payment_method === method))
        .reduce((acc, s) => acc + Number(s.total), 0),
    [sales]
  )

  const sessionRevenue = useCallback(
    (method?: string) =>
      endedSessions
        .filter((s) => !method || s.payment_method === method)
        .reduce((acc, s) => acc + (s.total_amount ?? 0), 0),
    [endedSessions]
  )

  const totalSum = useCallback(
    (method?: string) => sessionRevenue(method) + snackRevenue(method),
    [sessionRevenue, snackRevenue]
  )

  const runningValue = useMemo(
    () =>
      recordedSessions
        .filter((s) => s.status === 'open')
        .reduce((sum, s) => {
          const unpaidSnacks = sales
            .filter((sale) => sale.session_id === s.id && !sale.payment_method)
            .reduce((sub, sale) => sub + Number(sale.total), 0)
          return sum + s.games_count * s.price_snapshot + s.fifa_extra_charge + unpaidSnacks
        }, 0),
    [recordedSessions, sales]
  )

  const shiftCashToHandOver = useMemo(
    () =>
      shiftSessions.filter((s) => s.status === 'ended' && s.payment_method === 'cash')
        .reduce((sum, s) => sum + (s.total_amount || 0), 0) +
      shiftSales.filter((sale) => sale.payment_method === 'cash')
        .reduce((sum, sale) => sum + Number(sale.total), 0),
    [shiftSessions, shiftSales]
  )

  const sessionsByStation = useMemo(
    () =>
      Object.entries(
        sessions.reduce<Record<string, SessionRecord[]>>((acc, s) => {
          ; (acc[s.station_id] ??= []).push(s)
          return acc
        }, {})
      ),
    [sessions]
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

    if (error) {
      setErr(msg(error))
      setBusy(false)
    } else {
      setCashCounted('')
      setShiftNote('')
      await loadData()
      setBusy(false)
    }
  }

  if (loading && !hasLocalSnapshot) {
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
        <div className="grid grid-cols-3 gap-1.5 text-center sm:gap-2.5">
          {(['cash', 'telebirr', 'cbe'] as const).map((method) => (
            <div key={method} className="surface-card min-w-0 p-2.5 space-y-1 sm:p-3">
              <p className="truncate text-[10px] font-extrabold uppercase tracking-wider text-ink-muted sm:text-[11px]">
                {method === 'cbe' ? 'CBE' : t(method)}
              </p>
              <p className="truncate font-display text-xs font-bold text-ink sm:text-lg">
                {etb(totalSum(method))}
              </p>
            </div>
          ))}
        </div>

        {runningValue > 0 && (
          <div className="rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3 text-xs text-ink-muted">
            Running session value (not collected yet):{' '}
            <strong className="text-brand">{etb(runningValue)}</strong>
          </div>
        )}

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
                  <div key={s.id} className="flex flex-col gap-1 pt-1.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <span className="font-semibold text-ink">
                        {t('Session')} {idx + 1}
                      </span>
                      <span className="text-ink-muted ml-2">
                        · {new Date(s.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' · '}{s.games_count} {t('games')}
                        {s.payment_method && ` (${s.payment_method})`}
                      </span>
                      {s.status === 'open' && (
                        <span className="ml-2 rounded bg-brand/20 px-1 py-0.5 text-[10px] text-brand font-bold">
                          {t('running')}
                        </span>
                      )}
                    </div>
                    <span className="text-right">
                      <span className="block font-bold text-ink">
                        {s.status === 'open'
                          ? etb(
                            s.games_count * s.price_snapshot +
                            s.fifa_extra_charge +
                            sales
                              .filter((sale) => sale.session_id === s.id && !sale.payment_method)
                              .reduce((sum, sale) => sum + Number(sale.total), 0)
                          )
                          : etb(s.total_amount)}
                      </span>
                      <span className={`text-[10px] font-semibold ${s.status === 'open' ? 'text-warning' : 'text-ok'}`}>
                        {s.status === 'open' ? 'Running · not collected' : 'Collected'}
                      </span>
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
        {(shift?.status === 'open' || shift?.status === 'rejected') && (
          <form
            onSubmit={handleSubmitDay}
            className="surface-card-gold p-5 space-y-4 shadow-xl"
          >
            <div className="border-b border-line pb-3">
              <h3 className="font-display text-lg font-bold text-ink">{t('Close your day')}</h3>
              <p className="text-xs text-ink-muted leading-relaxed">
                {t('You should hand over')}{' '}
                <b className="text-brand font-display text-sm">{etb(shiftCashToHandOver)}</b>{' '}
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

            <ActionButton disabled={busy} className="btn btn-gold w-full">
              {busy ? 'Submitting…' : t('Submit day')}
            </ActionButton>
          </form>
        )}
      </div>
    </AppLayout>
  )
}
