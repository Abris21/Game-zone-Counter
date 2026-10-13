'use client'

import ActionButton from '@/components/ActionButton'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import { executeOrQueue, getLocalSnapshot, getQueue, setLocalSnapshot } from '@/lib/offline'
import { useT } from '@/lib/i18n'
import AppLayout from '@/components/AppLayout'
import Snacks from '@/components/Snacks'
import HandOver from '@/components/HandOver'
import { ControllerIcon, PsCross, PsTriangle, PsCircle, PsSquare } from '@/components/PlayStationIcons'

interface Station {
  id: string
  name: string
  kind: string
  price: number
}

interface Session {
  id: string
  station_id: string
  employee_id: string
  games_count: number
  price_snapshot: number
  started_at: string
  status: string
  total_amount: number | null
  ended_at: string | null
  paused_at: string | null
  fifa_extra_charge: number
  fifa_extra_time_applied: boolean
  fifa_penalties_applied: boolean
}

export default function CounterPage() {
  const router = useRouter()
  const t = useT()
  const { user, profile, zone, loading } = useAuthGuard(['employee', 'admin'])

  const [stations, setStations] = useState<Station[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [snackTotals, setSnackTotals] = useState<Record<string, number>>({})
  const [todaySnackRevenue, setTodaySnackRevenue] = useState(0)
  const [activeSnackSession, setActiveSnackSession] = useState<string | null | false>(false)
  const [activeHandoverSession, setActiveHandoverSession] = useState<string | null>(null)
  const [activeEndSession, setActiveEndSession] = useState<Session | null>(null)
  const [activeFifaSession, setActiveFifaSession] = useState<Session | null>(null)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)
  const [err, setErr] = useState('')
  const sessionCounts = useRef<Record<string, number>>({})
  const pendingAdjustments = useRef<Record<string, number>>({})
  const adjustQueues = useRef<Record<string, Promise<void>>>({})
  const loadVersion = useRef(0)
  const closedSessionIds = useRef<Set<string>>(new Set())

  const hydrateLocalSnapshot = useCallback(() => {
    const snapSt = getLocalSnapshot<Station[]>('stations')
    const snapSe = getLocalSnapshot<Session[]>('sessions')
    const snapSn = getLocalSnapshot<Record<string, number>>('snackTotals')
    const snapRevenue = getLocalSnapshot<number>('todaySnackRevenue')

    let hasAny = false
    if (snapSt.data) {
      setStations(snapSt.data)
      hasAny = true
    }
    if (snapSe.data) {
      const cachedSessions = snapSe.data.map((session) => {
        const games_count = sessionCounts.current[session.id] ?? session.games_count
        sessionCounts.current[session.id] = games_count
        return { ...session, games_count }
      })
      setSessions(cachedSessions)
      hasAny = true
    }
    if (snapSn.data) {
      setSnackTotals(snapSn.data)
      hasAny = true
    }
    if (snapRevenue.data != null) {
      setTodaySnackRevenue(snapRevenue.data)
      hasAny = true
    }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadData = useCallback(async () => {
    const version = ++loadVersion.current
    const localHasData = hydrateLocalSnapshot()
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [stRes, seRes, queuedActions] = await Promise.all([
      sb.from('stations').select('id, name, kind, price').eq('is_archived', false).order('sort_order'),
      sb.from('sessions').select('*').or(`status.eq.open,and(started_at.gte.${today.toISOString()},started_at.lt.${tomorrow.toISOString()}),and(ended_at.gte.${today.toISOString()},ended_at.lt.${tomorrow.toISOString()})`),
      user?.id && profile?.zone_id ? getQueue(user.id, profile.zone_id) : Promise.resolve([]),
    ])

    if (stRes.error || seRes.error) {
      if (version !== loadVersion.current) return
      setErr(msg(stRes.error || seRes.error))
      return
    }

    if (version !== loadVersion.current) return

    const stData = (stRes.data as Station[]) || []
    const queuedGameDeltas = new Map<string, number>()
    for (const action of queuedActions) {
      if (
        action.fn === 'adjust_session' &&
        (action.status === 'pending' || action.status === 'syncing')
      ) {
        const sessionId = String(action.args.p_session || '')
        const delta = Number(action.args.p_delta)
        if (sessionId && Number.isInteger(delta)) {
          queuedGameDeltas.set(sessionId, (queuedGameDeltas.get(sessionId) || 0) + delta)
        }
      }
    }

    const seData = ((seRes.data as Session[]) || []).map((session) => {
      const games_count = session.games_count +
        (pendingAdjustments.current[session.id] || 0) +
        (queuedGameDeltas.get(session.id) || 0)
      sessionCounts.current[session.id] = games_count
      if (session.status === 'open') closedSessionIds.current.delete(session.id)
      else closedSessionIds.current.add(session.id)
      return { ...session, games_count }
    })

    const queuedStartIds = new Set(
      queuedActions
        .filter((action) => action.fn === 'start_session' && (action.status === 'pending' || action.status === 'syncing'))
        .map((action) => String(action.args.p_session_id || ''))
        .filter(Boolean)
    )
    const serverSessionIds = new Set(seData.map((session) => session.id))
    const cachedSessions = getLocalSnapshot<Session[]>('sessions').data || []
    const queuedSessions = cachedSessions.filter((session) =>
      queuedStartIds.has(session.id) && !serverSessionIds.has(session.id) && session.status === 'open'
    )
    for (const session of queuedSessions) sessionCounts.current[session.id] = session.games_count
    const visibleSessions = [...seData, ...queuedSessions]

    setStations(stData)
    setSessions(visibleSessions)
    setLocalSnapshot('stations', stData)
    setLocalSnapshot('sessions', visibleSessions)

    // Load unpaid sales for active sessions and paid sales for today's total.
    const [snackRes, paidTodayRes] = await Promise.all([
      sb
        .from('sales')
        .select('session_id, total')
        .not('session_id', 'is', null)
        .is('payment_method', null)
        .is('voided_at', null),
      sb
        .from('sales')
        .select('total')
        .gte('created_at', today.toISOString())
        .lt('created_at', tomorrow.toISOString())
        .not('payment_method', 'is', null)
        .is('voided_at', null),
    ])

    if (version !== loadVersion.current) return
    if (snackRes.error || paidTodayRes.error) {
      setErr(msg(snackRes.error || paidTodayRes.error))
      return
    }

    const totals = ((snackRes.data || []) as { session_id: string; total: number }[]).reduce(
      (acc, cur) => {
        acc[cur.session_id] = (acc[cur.session_id] || 0) + Number(cur.total)
        return acc
      },
      {} as Record<string, number>
    )

    setSnackTotals(totals)
    const paidTotal = ((paidTodayRes.data || []) as { total: number }[]).reduce(
      (sum, sale) => sum + Number(sale.total),
      0
    )
    setTodaySnackRevenue(paidTotal)
    setLocalSnapshot('todaySnackRevenue', paidTotal)
    setLocalSnapshot('snackTotals', totals)
  }, [profile?.zone_id, user?.id, hydrateLocalSnapshot])

  useEffect(() => {
    hydrateLocalSnapshot()
    void loadData()
    const refresh = () => void loadData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const channel = sb
      .channel('counter-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, refresh)
      .subscribe()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sb.removeChannel(channel)
    }
  }, [loadData])

  const runAction = async (
    fn: () => PromiseLike<{ error: { message: string } | null } | { error: any } | void>
  ) => {
    setErr('')
    const res = await fn()
    if (res && res.error) setErr(msg(res.error))
    await loadData()
  }

  const startSession = async (station: Station) => {
    const sessionId = crypto.randomUUID()
    const optimisticSession: Session = {
      id: sessionId,
      station_id: station.id,
      employee_id: user?.id || '',
      games_count: 0,
      price_snapshot: station.price,
      started_at: new Date().toISOString(),
      status: 'open',
      total_amount: null,
      ended_at: null,
      paused_at: null,
      fifa_extra_charge: 0,
      fifa_extra_time_applied: false,
      fifa_penalties_applied: false,
    }

    setErr('')
    const result = await executeOrQueue(
      'start_session',
      { p_station: station.id, p_session_id: sessionId },
      {
        userId: user?.id,
        zoneId: profile?.zone_id || '',
        targetId: station.id,
        description: `Start ${station.name}`,
      }
    )

    if (result.error) {
      setErr(msg(result.error))
      await loadData()
      return
    }

    if (result.queued) {
      sessionCounts.current[sessionId] = 0
      setSessions((previous) => {
        const next = [...previous.filter((session) => session.station_id !== station.id), optimisticSession]
        setLocalSnapshot('sessions', next)
        return next
      })
      return
    }

    await loadData()
  }

  // Adjust games counter (+1 / -1) with optimistic UI
  const adjustCounter = (session: Session, delta: number) => {
    if (closedSessionIds.current.has(session.id)) {
      void loadData()
      return
    }
    const current = sessionCounts.current[session.id] ?? session.games_count
    const next = current + delta
    if (next < 0 || next > 200) return

    sessionCounts.current[session.id] = next
    pendingAdjustments.current[session.id] = (pendingAdjustments.current[session.id] || 0) + delta
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, games_count: next } : s))
    )
    const cachedSessions = getLocalSnapshot<Session[]>('sessions').data
    if (cachedSessions) {
      setLocalSnapshot(
        'sessions',
        cachedSessions.map((s) => (s.id === session.id ? { ...s, games_count: next } : s))
      )
    }

    const previous = adjustQueues.current[session.id] || Promise.resolve()
    const action = previous.then(async () => {
      setErr('')
      const result = await executeOrQueue(
        'adjust_session',
        {
          p_session: session.id,
          p_delta: delta,
          p_event: crypto.randomUUID(),
        },
        {
          userId: user?.id,
          zoneId: profile?.zone_id || '',
          targetId: session.id,
          description: `${delta > 0 ? '+1' : '-1'} Game`,
        }
      )

      pendingAdjustments.current[session.id] =
        (pendingAdjustments.current[session.id] || 0) - delta
      if (result.error) {
        if (/SESSION_ALREADY_ENDED|This session has already ended/i.test(result.error.message)) {
          closedSessionIds.current.add(session.id)
        } else {
          setErr(msg(result.error))
        }
        await loadData()
        return
      }

      if (typeof result.data === 'number') {
        const visibleCount = result.data + (pendingAdjustments.current[session.id] || 0)
        sessionCounts.current[session.id] = visibleCount
        setSessions((prev) =>
          prev.map((s) => (s.id === session.id ? { ...s, games_count: visibleCount } : s))
        )
      }

      // A queued offline adjustment stays visible until the queue syncs and the
      // realtime subscription refreshes the authoritative session row.
      if (!result.queued) await loadData()
    })
    adjustQueues.current[session.id] = action
  }

  // Pause / Resume Session
  const togglePause = (session: Session) => {
    const isPaused = !!session.paused_at
    const fn = isPaused ? 'resume_session' : 'pause_session'

    setSessions((prev) =>
      prev.map((s) =>
        s.id === session.id
          ? { ...s, paused_at: isPaused ? null : new Date().toISOString() }
          : s
      )
    )

    runAction(() =>
      executeOrQueue(fn, { p_session: session.id }, {
        userId: user?.id,
        zoneId: profile?.zone_id || '',
        targetId: session.id,
        description: isPaused ? 'Resume Session' : 'Pause Session',
      })
    )
  }

  // Apply FIFA Rule (Extra Time or Penalties)
  const applyFifaTieBreak = async (session: Session, ruleType: 'extra_time' | 'penalties') => {
    setActiveFifaSession(null)
    runAction(() =>
      executeOrQueue(
        'apply_fifa_rule',
        {
          p_session: session.id,
          p_rule: ruleType,
        },
        {
          userId: user?.id,
          zoneId: profile?.zone_id || '',
          targetId: session.id,
          description: `FIFA ${ruleType.replace('_', ' ')}`,
        }
      )
    )
  }

  // End Session with payment method
  const confirmEndSession = async (method: string) => {
    if (!activeEndSession) return
    const s = activeEndSession
    setActiveEndSession(null)

    // Optimistic update
    setSessions((prev) =>
      prev.map((x) =>
        x.id === s.id
          ? {
            ...x,
            status: 'ended',
            total_amount: s.games_count * s.price_snapshot + (s.fifa_extra_charge || 0),
            ended_at: new Date().toISOString(),
          }
          : x
      )
    )

    await runAction(() =>
      executeOrQueue(
        'end_session_idempotent',
        {
          p_session: s.id,
          p_method: method,
          p_idempotency_key: crypto.randomUUID(),
        },
        {
          userId: user?.id,
          zoneId: profile?.zone_id || '',
          targetId: s.id,
          description: `End Session (${method})`,
        }
      )
    )
  }

  const myTodaySessions = sessions.filter(
    (s) => s.employee_id === user?.id && s.status !== 'cancelled'
  )
  const totalGamesDone = myTodaySessions.reduce((acc, s) => acc + s.games_count, 0)
  const myEndedSessions = myTodaySessions.filter((s) => s.status === 'ended')
  const totalMoneyCollected =
    myEndedSessions.reduce((acc, s) => acc + (s.total_amount ?? 0), 0) + todaySnackRevenue

  // Reopen window check
  const reopenWindowMs = (zone?.max_employees ? 5 : 5) * 60 * 1000
  const recentEnded = sessions.filter(
    (s) =>
      s.employee_id === user?.id &&
      s.status === 'ended' &&
      s.ended_at &&
      Date.now() - new Date(s.ended_at).getTime() < reopenWindowMs
  )

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-ink">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          <p className="text-xs font-semibold text-ink-muted">Loading live zone…</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title={t('Today')}
      subtitle={`${totalGamesDone} ${t('games')} · ${etb(totalMoneyCollected)} collected`}
      onRefresh={loadData}
      action={
        <ActionButton
          onClick={() => setActiveSnackSession(null)}
          className="btn btn-outline-gold text-xs px-3 h-9 font-bold"
        >
          <span>🍿</span>
          <span className="hidden sm:inline">{t('Snack sale')}</span>
        </ActionButton>
      }
    >
      <div className="space-y-5">
        {/* Error notification banner */}
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Reopen Session Quick Banner */}
        {recentEnded.map((s) => {
          const st = stations.find((x) => x.id === s.station_id)
          return (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 text-xs font-semibold"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-warning">↺</span>
                <span className="break-words">
                  {st?.name || 'Unit'} ended · {s.games_count} {t('games')}
                </span>
              </div>
              <ActionButton
                onClick={() =>
                  runAction(() => sb.rpc('reopen_session', { p_session: s.id }))
                }
                className="btn btn-gold text-xs h-8 px-3 shrink-0"
              >
                {t('Reopen')}
              </ActionButton>
            </div>
          )
        })}

        {/* Station Cards Grid */}
        <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3.5 lg:grid-cols-3">
          {stations.map((st) => {
            const openSession = sessions.find(
              (s) => s.station_id === st.id && s.status === 'open'
            )
            const isPaused = !!openSession?.paused_at
            const snacksSum = openSession ? snackTotals[openSession.id] || 0 : 0
            const fifaCharge = openSession?.fifa_extra_charge || 0
            const currentTotal = openSession
              ? openSession.games_count * openSession.price_snapshot + snacksSum + fifaCharge
              : 0

            return (
              <section
                key={st.id}
                className={`relative flex flex-col justify-between rounded-2xl border p-2.5 shadow-lg transition-all min-[420px]:p-3 sm:rounded-3xl sm:p-4.5 ${openSession
                  ? isPaused
                    ? 'border-warning/50 bg-surface/90 ring-1 ring-warning/30'
                    : 'border-brand/60 bg-surface ring-1 ring-brand/40 shadow-glow-sm'
                  : 'border-line/70 bg-surface/60 hover:border-line'
                  }`}
              >
                {/* Station header */}
                <div>
                  <div className={`flex gap-1.5 sm:gap-2 ${openSession ? 'flex-col sm:flex-row sm:items-start sm:justify-between' : 'items-start justify-between'}`}>
                    <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-elevated text-xs sm:h-7 sm:w-7 sm:text-sm">
                        {st.kind === 'ps5' ? '🎮' : st.kind === 'ps4' ? '🕹️' : '🎱'}
                      </span>
                      <div className="min-w-0">
                        <h2 className="min-w-0 break-words font-display text-sm font-bold leading-tight text-ink sm:text-lg">
                          {st.name}
                        </h2>
                        <span className="text-[9px] font-extrabold uppercase tracking-wider text-ink-dim sm:text-[10px]">
                          {st.kind.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className={openSession ? 'flex w-full items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end sm:gap-0' : 'shrink-0 text-right'}>
                      <span
                        className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:gap-1.5 sm:px-2.5 sm:text-[11px] ${openSession
                          ? isPaused
                            ? 'bg-warning/20 text-warning border border-warning/40'
                            : 'bg-brand/20 text-brand border border-brand/40'
                          : 'bg-ok/20 text-ok border border-ok/40'
                          }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${openSession
                            ? isPaused
                              ? 'bg-warning'
                              : 'bg-brand animate-pulse'
                            : 'bg-ok'
                            }`}
                        />
                        {openSession ? (isPaused ? 'Paused' : t('In use')) : t('Free')}
                      </span>
                      <p className={`${openSession ? 'mt-0' : 'mt-0.5'} text-[10px] text-ink-muted sm:text-[11px]`}>
                        {etb(st.price)}/{t('game')}
                      </p>
                    </div>
                  </div>

                  {/* Open Session Active Counter Display */}
                  {openSession ? (
                    <div className="py-3 text-center sm:py-4">
                      <div className="relative inline-block">
                        <span
                          className="select-none font-display text-5xl font-extrabold tracking-tight text-ink sm:text-7xl"
                          aria-live="polite"
                        >
                          {openSession.games_count}
                        </span>
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] uppercase font-bold tracking-widest text-ink-muted">
                          {t('games')}
                        </span>
                      </div>

                      {/* Current bill total & snack badges */}
                      <div className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-1.5 text-xs sm:mt-3">
                        <span className="max-w-full break-words font-display text-sm font-extrabold leading-tight text-brand">
                          {etb(currentTotal)}
                        </span>
                        {snacksSum > 0 && (
                          <span className="max-w-full break-words rounded-md border border-line bg-surface-elevated px-1.5 py-0.5 text-[10px] leading-tight text-ink-muted">
                            +{etb(snacksSum)} snacks
                          </span>
                        )}
                        {fifaCharge > 0 && (
                          <span className="max-w-full break-words rounded-md border border-brand/30 bg-brand/10 px-1.5 py-0.5 text-[10px] leading-tight text-brand">
                            +{etb(fifaCharge)} FIFA
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="break-words py-5 text-center text-[11px] leading-snug text-ink-dim sm:py-8 sm:text-xs">
                      Ready for next players
                    </div>
                  )}
                </div>

                {/* Counter Actions */}
                <div className="border-t border-line/60 pt-2">
                  {!openSession ? (
                    <ActionButton
                      onClick={() => startSession(st)}
                      className="btn btn-gold w-full"
                    >
                      <span>▶</span>
                      <span className="min-w-0 break-words text-center leading-tight">{t('Start session')}</span>
                    </ActionButton>
                  ) : (
                    <div className="space-y-2">
                      {/* Big Quick Touch Adjust Buttons */}
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2">
                        <ActionButton
                          feedbackMs={110}
                          aria-label="Remove one game"
                          onClick={() => adjustCounter(openSession, -1)}
                          className="btn btn-secondary h-12 min-w-0 px-1 text-2xl font-black active:bg-bad/20 sm:h-13"
                        >
                          −
                        </ActionButton>
                        <ActionButton
                          feedbackMs={110}
                          aria-label="Add one game"
                          onClick={() => adjustCounter(openSession, 1)}
                          className="btn btn-gold h-12 min-w-0 px-1 text-2xl font-black sm:h-13"
                        >
                          +
                        </ActionButton>
                        <ActionButton
                          onClick={() => setActiveEndSession(openSession)}
                          className="btn col-span-2 min-w-0 px-1 text-[10px] font-bold text-brand border border-brand/60 bg-brand/10 hover:bg-brand/20 sm:col-span-1 sm:text-xs"
                        >
                          <span className="min-w-0 break-words text-center leading-tight">{t('End')}</span>
                        </ActionButton>
                      </div>

                      {/* Micro actions: Snacks, Pause, FIFA rules, Handover */}
                      <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-3 sm:gap-1 sm:text-[11px]">
                        <ActionButton
                          onClick={() => setActiveSnackSession(openSession.id)}
                          className="flex min-h-10 flex-col items-center justify-center whitespace-normal break-words rounded-lg border border-line bg-surface-elevated px-1 py-1.5 text-center font-semibold leading-tight text-ink-muted transition-colors hover:border-brand/40 hover:text-ink"
                        >
                          🍿 {t('Add snacks')}
                        </ActionButton>
                        <ActionButton
                          onClick={() => togglePause(openSession)}
                          className={`flex min-h-10 flex-col items-center justify-center whitespace-normal break-words rounded-lg border px-1 py-1.5 text-center font-semibold leading-tight transition-colors ${isPaused
                            ? 'border-warning bg-warning/20 text-warning font-bold'
                            : 'border-line bg-surface-elevated text-ink-muted hover:border-brand/40'
                            }`}
                        >
                          {isPaused ? '▶ Resume' : '⏸ Pause'}
                        </ActionButton>
                        <ActionButton
                          onClick={() => setActiveFifaSession(openSession)}
                          className={`col-span-2 flex min-h-10 flex-col items-center justify-center whitespace-normal break-words rounded-lg border px-1 py-1.5 text-center font-semibold leading-tight transition-colors sm:col-span-1 ${openSession.fifa_extra_time_applied || openSession.fifa_penalties_applied
                            ? 'border-brand bg-brand/20 text-brand'
                            : 'border-line bg-surface-elevated text-ink-muted hover:border-brand/40'
                            }`}
                        >
                          ⚽ FIFA Tie
                        </ActionButton>
                      </div>

                      <div className="flex flex-col items-start gap-1 pt-1 text-[11px] text-ink-dim sm:flex-row sm:items-center sm:justify-between">
                        <ActionButton
                          onClick={() => setActiveHandoverSession(openSession.id)}
                          className="hover:text-brand underline"
                        >
                          <span className="block max-w-full whitespace-normal break-words text-left leading-tight">{t('Hand over to a colleague')}</span>
                        </ActionButton>
                        {openSession.employee_id !== user?.id && (
                          <span className="text-[10px] text-warning italic">
                            <span className="block max-w-full whitespace-normal break-words leading-tight">Started by colleague</span>
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>

        {stations.length === 0 && !err && (
          <div className="surface-card p-12 text-center text-ink-muted">
            <p className="text-base font-bold text-ink">No gaming stations configured yet</p>
            <p className="mt-1 text-xs">
              {t('No units yet. Ask your manager to add stations in Settings.')}
            </p>
          </div>
        )}
      </div>

      {/* End Session Payment Modal */}
      {activeEndSession && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center backdrop-blur-sm animate-in fade-in"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div>
                <h3 className="font-display text-xl font-bold text-ink">{t('End session')}</h3>
                <p className="text-xs text-ink-muted">
                  {stations.find((x) => x.id === activeEndSession.station_id)?.name}
                </p>
              </div>
              <ActionButton
                onClick={() => setActiveEndSession(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted"
              >
                ✕
              </ActionButton>
            </div>

            {/* Bill Summary */}
            <div className="rounded-2xl border border-line bg-surface-elevated p-3.5 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span>
                  {activeEndSession.games_count} {t('games')} × {etb(activeEndSession.price_snapshot)}
                </span>
                <span className="font-bold">
                  {etb(activeEndSession.games_count * activeEndSession.price_snapshot)}
                </span>
              </div>
              {(snackTotals[activeEndSession.id] || 0) > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <span>Snacks & drinks</span>
                  <span className="font-bold text-brand">
                    +{etb(snackTotals[activeEndSession.id])}
                  </span>
                </div>
              )}
              {activeEndSession.fifa_extra_charge > 0 && (
                <div className="flex justify-between text-ink-muted">
                  <span>FIFA Extra Time / Penalties</span>
                  <span className="font-bold text-brand">
                    +{etb(activeEndSession.fifa_extra_charge)}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-line flex justify-between items-baseline text-sm">
                <span className="font-bold text-ink">Total Due:</span>
                <span className="font-display text-2xl font-extrabold text-brand">
                  {etb(
                    activeEndSession.games_count * activeEndSession.price_snapshot +
                    (snackTotals[activeEndSession.id] || 0) +
                    (activeEndSession.fifa_extra_charge || 0)
                  )}
                </span>
              </div>
            </div>

            {activeEndSession.games_count === 0 && !(snackTotals[activeEndSession.id] > 0) && (
              <p className="text-xs text-ink-muted">
                {t('No games counted. This will cancel the session.')}
              </p>
            )}

            {/* Payment Methods */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink-muted">{t('How did they pay?')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'telebirr', 'cbe'] as const).map((method) => (
                  <ActionButton
                    key={method}
                    onClick={() => confirmEndSession(method)}
                    className="btn btn-secondary text-xs uppercase font-extrabold tracking-wider hover:border-brand hover:text-brand"
                  >
                    {method === 'cbe' ? 'CBE' : t(method)}
                  </ActionButton>
                ))}
              </div>
            </div>

            <ActionButton
              onClick={() => setActiveEndSession(null)}
              className="btn btn-secondary w-full text-xs text-ink-dim"
            >
              {t('Keep counting')}
            </ActionButton>
          </div>
        </div>
      )}

      {/* FIFA Tie-Break Rule Modal */}
      {activeFifaSession && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-xl font-bold text-ink">FIFA Tie-Break Extra Charge</h3>
            <p className="text-xs text-ink-muted">
              Select tied match extension according to your game zone rules:
            </p>
            <div className="space-y-2">
              <ActionButton
                onClick={() => applyFifaTieBreak(activeFifaSession, 'extra_time')}
                className="btn btn-secondary w-full justify-between text-xs"
              >
                <span>⏱ Extra Time</span>
                <span className="text-brand font-bold">Apply Rule →</span>
              </ActionButton>
              <ActionButton
                onClick={() => applyFifaTieBreak(activeFifaSession, 'penalties')}
                className="btn btn-secondary w-full justify-between text-xs"
              >
                <span>🥅 Penalty Shootout</span>
                <span className="text-brand font-bold">Apply Rule →</span>
              </ActionButton>
            </div>
            <ActionButton
              onClick={() => setActiveFifaSession(null)}
              className="btn btn-secondary w-full text-xs"
            >
              Cancel
            </ActionButton>
          </div>
        </div>
      )}

      {/* Sub-modals */}
      {activeHandoverSession && (
        <HandOver
          session={activeHandoverSession}
          onClose={() => {
            setActiveHandoverSession(null)
            loadData()
          }}
        />
      )}
      {activeSnackSession !== false && (
        <Snacks
          session={activeSnackSession}
          onClose={() => {
            setActiveSnackSession(false)
            loadData()
          }}
        />
      )}
    </AppLayout>
  )
}
