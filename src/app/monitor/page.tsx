'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import PendingShifts from '@/components/PendingShifts'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface Station {
  id: string
  name: string
  kind: string
  price: number
}

interface LiveSession {
  id: string
  station_id: string
  employee_id: string
  started_at: string
  ended_at: string | null
  games_count: number
  price_snapshot: number
  status: string
  total_amount: number | null
  payment_method: string | null
  paused_at: string | null
  fifa_extra_charge: number
}

interface DaySale {
  employee_id: string
  total: number
  payment_method: string | null
  session_id: string | null
}

export default function MonitorPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [stations, setStations] = useState<Station[]>([])
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})
  const [daySales, setDaySales] = useState<DaySale[]>([])
  const [err, setErr] = useState('')
  const [liveConnected, setLiveConnected] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)
  const loadVersion = useRef(0)

  const hydrateLocalSnapshot = useCallback(() => {
    const snapStations = getLocalSnapshot<Station[]>('monitor_stations')
    const snapSessions = getLocalSnapshot<LiveSession[]>('monitor_sessions')
    const snapEmployees = getLocalSnapshot<Record<string, string>>('monitor_employee_names')
    const snapSales = getLocalSnapshot<DaySale[]>('monitor_day_sales')

    let hasAny = false
    if (snapStations.data) { setStations(snapStations.data); hasAny = true }
    if (snapSessions.data) { setSessions(snapSessions.data); hasAny = true }
    if (snapEmployees.data) { setEmployeeNames(snapEmployees.data); hasAny = true }
    if (snapSales.data) { setDaySales(snapSales.data); hasAny = true }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadData = useCallback(async () => {
    hydrateLocalSnapshot()
    const version = ++loadVersion.current
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    const [stRes, seRes, employeeRes, salesRes] = await Promise.all([
      sb.from('stations').select('id, name, kind, price').eq('is_archived', false).order('sort_order'),
      sb
        .from('sessions')
        .select('id, station_id, employee_id, started_at, ended_at, games_count, price_snapshot, status, total_amount, payment_method, paused_at, fifa_extra_charge')
        .or(`status.eq.open,and(started_at.gte.${today.toISOString()},started_at.lt.${tomorrow.toISOString()}),and(ended_at.gte.${today.toISOString()},ended_at.lt.${tomorrow.toISOString()})`),
      profile?.zone_id
        ? sb.from('profiles').select('id, full_name, username').eq('zone_id', profile.zone_id).in('role', ['employee', 'admin'])
        : Promise.resolve({ data: [], error: null }),
      sb
        .from('sales')
        .select('employee_id, total, payment_method, session_id')
        .gte('created_at', today.toISOString())
        .lt('created_at', tomorrow.toISOString())
        .is('voided_at', null),
    ])

    if (version !== loadVersion.current) return
    if (stRes.error || seRes.error || employeeRes.error || salesRes.error) {
      setErr(msg(stRes.error || seRes.error || employeeRes.error || salesRes.error))
      return
    }

    const nextStations = (stRes.data as Station[]) || []
    const nextSessions = (seRes.data as LiveSession[]) || []
    const nextEmployeeNames = Object.fromEntries(((employeeRes.data || []) as { id: string; full_name: string | null; username: string | null }[]).map((e) => [e.id, e.full_name || e.username || 'Employee']))
    const nextSales = (salesRes.data || []) as DaySale[]
    setStations(nextStations)
    setSessions(nextSessions)
    setEmployeeNames(nextEmployeeNames)
    setDaySales(nextSales)
    setLocalSnapshot('monitor_stations', nextStations)
    setLocalSnapshot('monitor_sessions', nextSessions)
    setLocalSnapshot('monitor_employee_names', nextEmployeeNames)
    setLocalSnapshot('monitor_day_sales', nextSales)
    setErr('')
  }, [profile?.zone_id, hydrateLocalSnapshot])

  useEffect(() => {
    hydrateLocalSnapshot()
    void loadData()
    const refresh = () => void loadData()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    const channel = sb
      .channel('monitor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, refresh)
      .subscribe((status) => {
        setLiveConnected(status === 'SUBSCRIBED')
      })
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      sb.removeChannel(channel)
    }
  }, [loadData])

  const endedSessions = sessions.filter((s) => s.status === 'ended')
  const totalCollected =
    endedSessions.reduce((acc, s) => acc + (s.total_amount ?? 0), 0) +
    daySales.filter((sale) => sale.payment_method).reduce((acc, sale) => acc + Number(sale.total), 0)
  const gamesToday = sessions
    .filter((s) => s.status !== 'cancelled')
    .reduce((sum, session) => sum + session.games_count, 0)

  const openSessions = sessions.filter((s) => s.status === 'open')
  const currentlyRunning = openSessions.reduce(
    (acc, s) => acc + s.games_count * s.price_snapshot + (s.fifa_extra_charge || 0),
    0
  )

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading floor monitor…</p>
          <p className="mt-1 text-xs text-ink-muted">Connecting live sessions and current sales.</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Live Floor"
      subtitle={liveConnected ? '⚡ Live Realtime floor connected' : 'Connecting realtime updates…'}
      onRefresh={loadData}
      action={
        <Link href="/counter" className="btn btn-outline-gold text-xs h-9 px-3 font-bold">
          🎮 Counter View
        </Link>
      }
    >
      <div className="space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Pending Shifts Verification Section */}
        <PendingShifts />

        {/* Live Metrics Row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <div className="surface-card-gold p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Collected Today
            </p>
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-brand truncate">
              {etb(totalCollected)}
            </p>
            <p className="text-[11px] text-ink-dim">{endedSessions.length} settled sessions</p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Games Recorded Today
            </p>
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-ink truncate">
              {gamesToday}
            </p>
            <p className="text-[11px] text-ink-dim">Across ended and running sessions</p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Running on Floor
            </p>
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-ink truncate">
              {etb(currentlyRunning)}
            </p>
            <p className="text-[11px] text-ink-dim">{openSessions.length} active consoles</p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Active Units
            </p>
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-ok">
              {openSessions.length}{' '}
              <span className="text-sm font-semibold text-ink-muted">/ {stations.length}</span>
            </p>
            <p className="text-[11px] text-ink-dim">
              {stations.length - openSessions.length} available
            </p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Floor Utilization
            </p>
            <p className="font-display text-2xl sm:text-3xl font-extrabold text-brand">
              {stations.length > 0
                ? `${Math.round((openSessions.length / stations.length) * 100)}%`
                : '0%'}
            </p>
            <p className="text-[11px] text-ink-dim">Current occupancy</p>
          </div>
        </div>

        {/* Detailed employee activity for the current business day */}
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Today by Staff</h2>
            <p className="text-xs text-ink-muted">Games, sessions and collected sales by staff member.</p>
          </div>
          {Array.from(new Set([
            ...sessions.filter((s) => s.status !== 'cancelled').map((s) => s.employee_id),
            ...daySales.map((sale) => sale.employee_id),
          ])).map((employeeId) => {
            const employeeSessions = sessions.filter((s) => s.employee_id === employeeId && s.status !== 'cancelled')
            const employeeSales = daySales.filter((sale) => sale.employee_id === employeeId)
            const games = employeeSessions.reduce((sum, s) => sum + s.games_count, 0)
            const collected =
              employeeSessions.filter((s) => s.status === 'ended').reduce((sum, s) => sum + (s.total_amount || 0), 0) +
              employeeSales.filter((sale) => sale.payment_method).reduce((sum, sale) => sum + Number(sale.total), 0)
            const running = employeeSessions.filter((s) => s.status === 'open')
              .reduce((sum, s) => sum + s.games_count * s.price_snapshot + s.fifa_extra_charge + employeeSales
                .filter((sale) => sale.session_id === s.id && !sale.payment_method)
                .reduce((subtotal, sale) => subtotal + Number(sale.total), 0), 0)

            return (
              <div key={employeeId} className="surface-card p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-ink">{employeeNames[employeeId] || 'Employee'}</h3>
                    <p className="text-xs text-ink-muted">{games} games · {employeeSessions.length} sessions</p>
                  </div>
                  <div className="text-right">
                    <p className="font-display font-bold text-brand">{etb(collected)} collected</p>
                    {running > 0 && <p className="text-[10px] text-warning">{etb(running)} still running</p>}
                  </div>
                </div>
                {employeeSessions.length > 0 ? (
                  <div className="divide-y divide-line/60">
                    {employeeSessions.map((session) => {
                      const station = stations.find((s) => s.id === session.station_id)
                      const value = session.status === 'ended'
                        ? session.total_amount || 0
                        : session.games_count * session.price_snapshot + session.fifa_extra_charge + employeeSales
                          .filter((sale) => sale.session_id === session.id && !sale.payment_method)
                          .reduce((sum, sale) => sum + Number(sale.total), 0)
                      return (
                        <div key={session.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                          <div>
                            <span className="font-semibold text-ink">{station?.name || 'Unit'}</span>
                            <span className="ml-2 text-ink-muted">
                              {new Date(session.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              {' · '}{session.games_count} games
                              {session.payment_method ? ` · ${session.payment_method}` : ''}
                            </span>
                            <span className={`ml-2 font-semibold ${session.status === 'open' ? 'text-warning' : 'text-ok'}`}>
                              {session.status === 'open' ? 'Running' : 'Ended'}
                            </span>
                          </div>
                          <span className="font-bold text-ink">{etb(value)}</span>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">Snack sales only</p>
                )}
                {employeeSales.length > 0 && (
                  <p className="text-xs text-ink-muted">
                    Snack sales collected: <strong className="text-ink">{etb(employeeSales.filter((sale) => sale.payment_method).reduce((sum, sale) => sum + Number(sale.total), 0))}</strong>
                  </p>
                )}
              </div>
            )
          })}
          {sessions.filter((s) => s.status !== 'cancelled').length === 0 && daySales.length === 0 && (
            <div className="surface-card p-6 text-center text-xs text-ink-muted">No employee activity recorded today.</div>
          )}
        </section>

        {/* Live Floor Stations Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-bold text-ink">Floor Stations Status</h2>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-ok" /> Free
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-brand" /> In Use
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-warning" /> Paused
              </span>
            </div>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {stations.map((u) => {
              const activeSession = openSessions.find((x) => x.station_id === u.id)
              const isPaused = !!activeSession?.paused_at

              return (
                <div
                  key={u.id}
                  className={`surface-card p-4.5 space-y-3 transition-all ${activeSession
                    ? isPaused
                      ? 'border-warning/50 bg-warning/5'
                      : 'border-brand/60 bg-brand/5 shadow-glow-sm'
                    : 'border-line/70'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-display text-base font-bold text-ink">{u.name}</p>
                      <p className="text-[10px] font-bold uppercase text-ink-dim tracking-wider">
                        {u.kind} · {etb(u.price)}/game
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${activeSession
                        ? isPaused
                          ? 'bg-warning/20 text-warning border border-warning/40'
                          : 'bg-brand/20 text-brand border border-brand/40'
                        : 'bg-ok/20 text-ok border border-ok/40'
                        }`}
                    >
                      {activeSession ? (isPaused ? 'Paused' : 'In Use') : 'Free'}
                    </span>
                  </div>

                  {activeSession ? (
                    <div className="rounded-2xl bg-surface-elevated/80 p-3 text-center space-y-0.5">
                      <p className="font-display text-4xl font-extrabold text-ink">
                        {activeSession.games_count}
                      </p>
                      <p className="text-xs font-bold text-brand">
                        {etb(
                          activeSession.games_count * activeSession.price_snapshot +
                          (activeSession.fifa_extra_charge || 0)
                        )}
                      </p>
                    </div>
                  ) : (
                    <div className="py-5 text-center text-xs font-semibold text-ok flex items-center justify-center gap-1.5">
                      <span>✓</span>
                      <span>Console Available</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {stations.length === 0 && (
            <div className="surface-card p-10 text-center text-xs text-ink-muted">
              No units added yet. Go to <Link href="/manage" className="text-brand underline">Units & Staff</Link> to configure your first console.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
