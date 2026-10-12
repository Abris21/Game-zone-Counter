'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import { executeOrQueue, getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'
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
  const [activeSnackSession, setActiveSnackSession] = useState<string | null | false>(false)
  const [activeHandoverSession, setActiveHandoverSession] = useState<string | null>(null)
  const [activeEndSession, setActiveEndSession] = useState<Session | null>(null)
  const [activeFifaSession, setActiveFifaSession] = useState<Session | null>(null)
  const [err, setErr] = useState('')

  const loadData = useCallback(async () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const snapSt = getLocalSnapshot<Station[]>('stations')
      const snapSe = getLocalSnapshot<Session[]>('sessions')
      const snapSn = getLocalSnapshot<Record<string, number>>('snackTotals')
      if (snapSt.data) setStations(snapSt.data)
      if (snapSe.data) setSessions(snapSe.data)
      if (snapSn.data) setSnackTotals(snapSn.data)
      return
    }

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [stRes, seRes] = await Promise.all([
      sb.from('stations').select('id, name, kind, price').eq('is_archived', false).order('sort_order'),
      sb.from('sessions').select('*').or(`status.eq.open,started_at.gte.${today.toISOString()}`),
    ])

    if (stRes.error || seRes.error) {
      setErr(msg(stRes.error || seRes.error))
      return
    }

    const stData = (stRes.data as Station[]) || []
    const seData = (seRes.data as Session[]) || []

    setStations(stData)
    setSessions(seData)
    setLocalSnapshot('stations', stData)
    setLocalSnapshot('sessions', seData)

    // Load active unpaid snack sales linked to open sessions
    const snackRes = await sb
      .from('sales')
      .select('session_id, total')
      .not('session_id', 'is', null)
      .is('payment_method', null)
      .is('voided_at', null)

    const totals = ((snackRes.data || []) as { session_id: string; total: number }[]).reduce(
      (acc, cur) => {
        acc[cur.session_id] = (acc[cur.session_id] || 0) + Number(cur.total)
        return acc
      },
      {} as Record<string, number>
    )

    setSnackTotals(totals)
    setLocalSnapshot('snackTotals', totals)
  }, [])

  useEffect(() => {
    loadData()
    const channel = sb
      .channel('counter-sessions')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => loadData())
      .subscribe()

    return () => {
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

  // Adjust games counter (+1 / -1) with optimistic UI
  const adjustCounter = (session: Session, delta: number) => {
    if (session.games_count + delta < 0 || session.games_count + delta > 200) return

    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, games_count: s.games_count + delta } : s))
    )

    runAction(() =>
      executeOrQueue(
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
    )
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

  const myEndedSessions = sessions.filter(
    (s) => s.employee_id === user?.id && s.status === 'ended'
  )
  const totalGamesDone = myEndedSessions.reduce((acc, s) => acc + s.games_count, 0)
  const totalMoneyCollected = myEndedSessions.reduce((acc, s) => acc + (s.total_amount ?? 0), 0)

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
      subtitle={`${totalGamesDone} ${t('games finished')} · ${etb(totalMoneyCollected)} collected`}
      onRefresh={loadData}
      action={
        <button
          onClick={() => setActiveSnackSession(null)}
          className="btn btn-outline-gold text-xs px-3 h-9 font-bold"
        >
          <span>🍿</span>
          <span className="hidden sm:inline">{t('Snack sale')}</span>
        </button>
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
              <div className="flex items-center gap-2 truncate">
                <span className="text-warning">↺</span>
                <span className="truncate">
                  {st?.name || 'Unit'} ended · {s.games_count} {t('games')}
                </span>
              </div>
              <button
                onClick={() =>
                  runAction(() => sb.rpc('reopen_session', { p_session: s.id }))
                }
                className="btn btn-gold text-xs h-8 px-3 shrink-0"
              >
                {t('Reopen')}
              </button>
            </div>
          )
        })}

        {/* Station Cards Grid */}
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
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
                className={`relative rounded-3xl border p-4.5 transition-all shadow-lg flex flex-col justify-between ${
                  openSession
                    ? isPaused
                      ? 'border-warning/50 bg-surface/90 ring-1 ring-warning/30'
                      : 'border-brand/60 bg-surface ring-1 ring-brand/40 shadow-glow-sm'
                    : 'border-line/70 bg-surface/60 hover:border-line'
                }`}
              >
                {/* Station header */}
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-elevated text-sm border border-line">
                        {st.kind === 'ps5' ? '🎮' : st.kind === 'ps4' ? '🕹️' : '🎱'}
                      </span>
                      <div>
                        <h2 className="font-display text-lg font-bold text-ink leading-tight">
                          {st.name}
                        </h2>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-ink-dim">
                          {st.kind.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          openSession
                            ? isPaused
                              ? 'bg-warning/20 text-warning border border-warning/40'
                              : 'bg-brand/20 text-brand border border-brand/40'
                            : 'bg-ok/20 text-ok border border-ok/40'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            openSession
                              ? isPaused
                                ? 'bg-warning'
                                : 'bg-brand animate-pulse'
                              : 'bg-ok'
                          }`}
                        />
                        {openSession ? (isPaused ? 'Paused' : t('In use')) : t('Free')}
                      </span>
                      <p className="mt-0.5 text-[11px] text-ink-muted">
                        {etb(st.price)}/{t('game')}
                      </p>
                    </div>
                  </div>

                  {/* Open Session Active Counter Display */}
                  {openSession ? (
                    <div className="py-4 text-center">
                      <div className="relative inline-block">
                        <span
                          className="font-display text-6xl sm:text-7xl font-extrabold text-ink tracking-tight select-none"
                          aria-live="polite"
                        >
                          {openSession.games_count}
                        </span>
                        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] uppercase font-bold tracking-widest text-ink-muted">
                          {t('games')}
                        </span>
                      </div>

                      {/* Current bill total & snack badges */}
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-xs">
                        <span className="font-display font-extrabold text-brand text-sm">
                          {etb(currentTotal)}
                        </span>
                        {snacksSum > 0 && (
                          <span className="rounded-md bg-surface-elevated px-1.5 py-0.5 text-[10px] text-ink-muted border border-line">
                            +{etb(snacksSum)} snacks
                          </span>
                        )}
                        {fifaCharge > 0 && (
                          <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[10px] text-brand border border-brand/30">
                            +{etb(fifaCharge)} FIFA
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-ink-dim">
                      Ready for next players
                    </div>
                  )}
                </div>

                {/* Counter Actions */}
                <div className="pt-2 border-t border-line/60">
                  {!openSession ? (
                    <button
                      onClick={() =>
                        runAction(() =>
                          executeOrQueue(
                            'start_session' as any,
                            { p_station: st.id },
                            {
                              userId: user?.id,
                              zoneId: profile?.zone_id || '',
                              targetId: st.id,
                              description: `Start ${st.name}`,
                            }
                          )
                        )
                      }
                      className="btn btn-gold w-full"
                    >
                      <span>▶</span>
                      <span>{t('Start session')}</span>
                    </button>
                  ) : (
                    <div className="space-y-2">
                      {/* Big Quick Touch Adjust Buttons */}
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          aria-label="Remove one game"
                          onClick={() => adjustCounter(openSession, -1)}
                          className="btn btn-secondary text-2xl font-black h-13 active:bg-bad/20"
                        >
                          −
                        </button>
                        <button
                          onClick={() => setActiveEndSession(openSession)}
                          className="btn border border-brand/60 bg-brand/10 text-brand font-bold text-xs hover:bg-brand/20"
                        >
                          {t('End')}
                        </button>
                        <button
                          aria-label="Add one game"
                          onClick={() => adjustCounter(openSession, 1)}
                          className="btn btn-gold text-2xl font-black h-13"
                        >
                          +
                        </button>
                      </div>

                      {/* Micro actions: Snacks, Pause, FIFA rules, Handover */}
                      <div className="grid grid-cols-3 gap-1 text-[11px]">
                        <button
                          onClick={() => setActiveSnackSession(openSession.id)}
                          className="rounded-lg border border-line bg-surface-elevated py-1.5 px-1 font-semibold text-ink-muted hover:border-brand/40 hover:text-ink transition-colors truncate"
                        >
                          🍿 {t('Add snacks')}
                        </button>
                        <button
                          onClick={() => togglePause(openSession)}
                          className={`rounded-lg border py-1.5 px-1 font-semibold transition-colors truncate ${
                            isPaused
                              ? 'border-warning bg-warning/20 text-warning font-bold'
                              : 'border-line bg-surface-elevated text-ink-muted hover:border-brand/40'
                          }`}
                        >
                          {isPaused ? '▶ Resume' : '⏸ Pause'}
                        </button>
                        <button
                          onClick={() => setActiveFifaSession(openSession)}
                          className={`rounded-lg border py-1.5 px-1 font-semibold transition-colors truncate ${
                            openSession.fifa_extra_time_applied || openSession.fifa_penalties_applied
                              ? 'border-brand bg-brand/20 text-brand'
                              : 'border-line bg-surface-elevated text-ink-muted hover:border-brand/40'
                          }`}
                        >
                          ⚽ FIFA Tie
                        </button>
                      </div>

                      <div className="pt-1 flex items-center justify-between text-[11px] text-ink-dim">
                        <button
                          onClick={() => setActiveHandoverSession(openSession.id)}
                          className="hover:text-brand underline"
                        >
                          {t('Hand over to a colleague')}
                        </button>
                        {openSession.employee_id !== user?.id && (
                          <span className="text-[10px] text-warning italic">
                            Started by colleague
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
              <button
                onClick={() => setActiveEndSession(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted"
              >
                ✕
              </button>
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
                  <button
                    key={method}
                    onClick={() => confirmEndSession(method)}
                    className="btn btn-secondary text-xs uppercase font-extrabold tracking-wider hover:border-brand hover:text-brand"
                  >
                    {method === 'cbe' ? 'CBE' : t(method)}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => setActiveEndSession(null)}
              className="btn btn-secondary w-full text-xs text-ink-dim"
            >
              {t('Keep counting')}
            </button>
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
              <button
                onClick={() => applyFifaTieBreak(activeFifaSession, 'extra_time')}
                className="btn btn-secondary w-full justify-between text-xs"
              >
                <span>⏱ Extra Time</span>
                <span className="text-brand font-bold">Apply Rule →</span>
              </button>
              <button
                onClick={() => applyFifaTieBreak(activeFifaSession, 'penalties')}
                className="btn btn-secondary w-full justify-between text-xs"
              >
                <span>🥅 Penalty Shootout</span>
                <span className="text-brand font-bold">Apply Rule →</span>
              </button>
            </div>
            <button
              onClick={() => setActiveFifaSession(null)}
              className="btn btn-secondary w-full text-xs"
            >
              Cancel
            </button>
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
