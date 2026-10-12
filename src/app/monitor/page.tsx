'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import PendingShifts from '@/components/PendingShifts'

interface Station {
  id: string
  name: string
  kind: string
  price: number
}

interface LiveSession {
  station_id: string
  games_count: number
  price_snapshot: number
  status: string
  total_amount: number | null
  paused_at: string | null
  fifa_extra_charge: number
}

export default function MonitorPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [stations, setStations] = useState<Station[]>([])
  const [sessions, setSessions] = useState<LiveSession[]>([])
  const [err, setErr] = useState('')
  const [liveConnected, setLiveConnected] = useState(false)

  const loadData = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [stRes, seRes] = await Promise.all([
      sb.from('stations').select('id, name, kind, price').eq('is_archived', false).order('sort_order'),
      sb
        .from('sessions')
        .select('station_id, games_count, price_snapshot, status, total_amount, paused_at, fifa_extra_charge')
        .or(`status.eq.open,started_at.gte.${today.toISOString()}`),
    ])

    if (stRes.error || seRes.error) {
      setErr(msg(stRes.error || seRes.error))
      return
    }

    setStations((stRes.data as Station[]) || [])
    setSessions((seRes.data as LiveSession[]) || [])
  }, [])

  useEffect(() => {
    loadData()
    const channel = sb
      .channel('monitor-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => loadData())
      .subscribe((status) => {
        setLiveConnected(status === 'SUBSCRIBED')
      })

    return () => {
      sb.removeChannel(channel)
    }
  }, [loadData])

  const endedSessions = sessions.filter((s) => s.status === 'ended')
  const totalCollected = endedSessions.reduce((acc, s) => acc + (s.total_amount ?? 0), 0)

  const openSessions = sessions.filter((s) => s.status === 'open')
  const currentlyRunning = openSessions.reduce(
    (acc, s) => acc + s.games_count * s.price_snapshot + (s.fifa_extra_charge || 0),
    0
  )

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  className={`surface-card p-4.5 space-y-3 transition-all ${
                    activeSession
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
                      className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        activeSession
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
