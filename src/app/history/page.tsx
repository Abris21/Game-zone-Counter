'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import EthDate from '@/components/EthDate'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface SessionHistoryItem {
  id: string
  games_count: number
  total_amount: number | null
  payment_method: string | null
  status: string
  started_at: string
  employee_id: string
  stations: { name: string } | null
}

interface SaleHistoryItem {
  id: string
  total: number
  payment_method: string | null
  voided_at: string | null
  created_at: string
  employee_id: string
  session_id: string | null
}

interface ActionDialog {
  kind: 'edit_session' | 'void_session' | 'void_sale'
  id: string
  games: string
  method: string
  reason: string
}

const formatTime = (ts: string) =>
  new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export default function HistoryPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [date, setDate] = useState(new Date().toLocaleDateString('en-CA'))
  const [activeTab, setActiveTab] = useState<'sessions' | 'sales'>('sessions')
  const [sessions, setSessions] = useState<SessionHistoryItem[]>([])
  const [sales, setSales] = useState<SaleHistoryItem[]>([])
  const [employeeNames, setEmployeeNames] = useState<Record<string, string>>({})
  const [dialog, setDialog] = useState<ActionDialog | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)

  const hydrateLocalSnapshot = useCallback(() => {
    const snapSessions = getLocalSnapshot<SessionHistoryItem[]>('history_sessions')
    const snapSales = getLocalSnapshot<SaleHistoryItem[]>('history_sales')
    const snapEmployeeNames = getLocalSnapshot<Record<string, string>>('history_employee_names')
    let hasAny = false
    if (snapSessions.data) { setSessions(snapSessions.data); hasAny = true }
    if (snapSales.data) { setSales(snapSales.data); hasAny = true }
    if (snapEmployeeNames.data) { setEmployeeNames(snapEmployeeNames.data); hasAny = true }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadHistory = useCallback(async () => {
    hydrateLocalSnapshot()
    setBusy(true)
    const dayStart = new Date(date + 'T00:00:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayStart.getDate() + 1)

    const [sesRes, saleRes, profRes] = await Promise.all([
      sb
        .from('sessions')
        .select('id, games_count, total_amount, payment_method, status, started_at, employee_id, stations(name)')
        .in('status', ['ended', 'cancelled'])
        .gte('started_at', dayStart.toISOString())
        .lt('started_at', dayEnd.toISOString())
        .order('started_at', { ascending: false }),
      sb
        .from('sales')
        .select('id, total, payment_method, voided_at, created_at, employee_id, session_id')
        .not('payment_method', 'is', null)
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
      sb.from('profiles').select('id, full_name'),
    ])

    setBusy(false)
    if (sesRes.error || saleRes.error) {
      setErr(msg(sesRes.error || saleRes.error))
      return
    }

    const nextSessions = (sesRes.data as unknown as SessionHistoryItem[]) || []
    const nextSales = (saleRes.data as SaleHistoryItem[]) || []
    const nextEmployeeNames = Object.fromEntries(
      ((profRes.data || []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
    )
    setErr('')
    setSessions(nextSessions)
    setSales(nextSales)
    setEmployeeNames(nextEmployeeNames)
    setLocalSnapshot('history_sessions', nextSessions)
    setLocalSnapshot('history_sales', nextSales)
    setLocalSnapshot('history_employee_names', nextEmployeeNames)
  }, [date, hydrateLocalSnapshot])

  useEffect(() => {
    hydrateLocalSnapshot()
    void loadHistory()
  }, [loadHistory, hydrateLocalSnapshot])

  const handleConfirmAction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!dialog) return
    setBusy(true)
    setErr('')

    let rpcCall: PromiseLike<{ error: { message: string } | null }>

    if (dialog.kind === 'edit_session') {
      rpcCall = sb.rpc('edit_session', {
        p_session: dialog.id,
        p_games: Number(dialog.games),
        p_method: dialog.method,
        p_reason: dialog.reason.trim(),
      })
    } else if (dialog.kind === 'void_session') {
      rpcCall = sb.rpc('void_session', {
        p_session: dialog.id,
        p_reason: dialog.reason.trim(),
      })
    } else {
      rpcCall = sb.rpc('void_sale', {
        p_sale: dialog.id,
        p_reason: dialog.reason.trim(),
      })
    }

    const { error } = await rpcCall
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setDialog(null)
      loadHistory()
    }
  }

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading history…</p>
          <p className="mt-1 text-xs text-ink-muted">Fetching prior sessions and sales records.</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="History & Adjustments"
      subtitle="Audited session logs, sales history, manager corrections and void records"
      onRefresh={loadHistory}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Date Filter & Tab Switcher */}
        <div className="surface-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="inp text-xs !w-auto"
              />
              <EthDate iso={date} />
            </div>

            <div className="flex rounded-xl bg-surface-elevated p-1 border border-line">
              <ActionButton
                onClick={() => setActiveTab('sessions')}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${activeTab === 'sessions' ? 'bg-brand text-bg shadow-glow-sm' : 'text-ink-muted'
                  }`}
              >
                Sessions ({sessions.length})
              </ActionButton>
              <ActionButton
                onClick={() => setActiveTab('sales')}
                className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${activeTab === 'sales' ? 'bg-brand text-bg shadow-glow-sm' : 'text-ink-muted'
                  }`}
              >
                Snack Sales ({sales.length})
              </ActionButton>
            </div>
          </div>
        </div>

        {/* Sessions Tab */}
        {activeTab === 'sessions' ? (
          <div className="space-y-3">
            {sessions.map((s) => {
              const isVoided = s.status === 'cancelled'
              return (
                <div
                  key={s.id}
                  className={`surface-card p-4 space-y-2.5 transition-colors ${isVoided ? 'opacity-60 border-bad/30' : ''
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-sm text-ink">
                        {s.stations?.name ?? 'Console'}
                      </span>
                      <span className="text-xs text-ink-muted ml-2">
                        · {formatTime(s.started_at)}
                      </span>
                    </div>

                    <span
                      className={`font-display text-base font-bold ${isVoided ? 'text-bad line-through' : 'text-brand'
                        }`}
                    >
                      {isVoided ? 'Voided' : etb(s.total_amount)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <div>
                      <span>Logged by: {employeeNames[s.employee_id] ?? 'Employee'}</span>
                      <span className="ml-2">· {s.games_count} games</span>
                      {s.payment_method && (
                        <span className="ml-2 capitalize">· {s.payment_method}</span>
                      )}
                    </div>

                    {s.status === 'ended' && (
                      <div className="flex items-center gap-3">
                        <ActionButton
                          onClick={() =>
                            setDialog({
                              kind: 'edit_session',
                              id: s.id,
                              games: String(s.games_count),
                              method: s.payment_method || 'cash',
                              reason: '',
                            })
                          }
                          className="text-brand hover:underline font-semibold"
                        >
                          Edit
                        </ActionButton>
                        <ActionButton
                          onClick={() =>
                            setDialog({
                              kind: 'void_session',
                              id: s.id,
                              games: '',
                              method: '',
                              reason: '',
                            })
                          }
                          className="text-bad hover:underline font-semibold"
                        >
                          Void
                        </ActionButton>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {sessions.length === 0 && !busy && (
              <div className="surface-card p-10 text-center text-xs text-ink-muted">
                No session records found for {date}.
              </div>
            )}
          </div>
        ) : (
          /* Snack Sales Tab */
          <div className="space-y-3">
            {sales.map((sl) => {
              const isVoided = !!sl.voided_at
              return (
                <div
                  key={sl.id}
                  className={`surface-card p-4 space-y-2.5 transition-colors ${isVoided ? 'opacity-60 border-bad/30' : ''
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-bold text-sm text-ink">Snack Sale</span>
                      <span className="text-xs text-ink-muted ml-2">
                        · {formatTime(sl.created_at)}
                      </span>
                      {sl.session_id && (
                        <span className="ml-2 rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-brand">
                          Attached to Session
                        </span>
                      )}
                    </div>

                    <span
                      className={`font-display text-base font-bold ${isVoided ? 'text-bad line-through' : 'text-brand'
                        }`}
                    >
                      {isVoided ? 'Voided' : etb(sl.total)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs text-ink-muted">
                    <div>
                      <span>Sold by: {employeeNames[sl.employee_id] ?? 'Employee'}</span>
                      {sl.payment_method && (
                        <span className="ml-2 capitalize">· {sl.payment_method}</span>
                      )}
                    </div>

                    {!isVoided && (
                      <ActionButton
                        onClick={() =>
                          setDialog({
                            kind: 'void_sale',
                            id: sl.id,
                            games: '',
                            method: '',
                            reason: '',
                          })
                        }
                        className="text-bad hover:underline font-semibold"
                      >
                        Void Sale
                      </ActionButton>
                    )}
                  </div>
                </div>
              )
            })}

            {sales.length === 0 && !busy && (
              <div className="surface-card p-10 text-center text-xs text-ink-muted">
                No snack sales recorded on {date}.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit / Void Modal with Mandatory Reason */}
      {dialog && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-ink">
              {dialog.kind === 'edit_session'
                ? 'Edit Session'
                : dialog.kind === 'void_session'
                  ? 'Void Session'
                  : 'Void Snack Sale'}
            </h3>

            <form onSubmit={handleConfirmAction} className="space-y-3">
              {dialog.kind === 'edit_session' && (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-ink-muted mb-1">
                      Correct Games Count
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      max="200"
                      value={dialog.games}
                      onChange={(e) => setDialog({ ...dialog, games: e.target.value })}
                      className="inp text-sm font-bold"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-ink-muted mb-1">
                      Payment Method
                    </label>
                    <select
                      value={dialog.method}
                      onChange={(e) => setDialog({ ...dialog, method: e.target.value })}
                      className="inp text-xs"
                    >
                      <option value="cash">Cash</option>
                      <option value="telebirr">Telebirr</option>
                      <option value="cbe">CBE</option>
                    </select>
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Audit Reason (minimum 3 characters)
                </label>
                <input
                  required
                  minLength={3}
                  value={dialog.reason}
                  onChange={(e) => setDialog({ ...dialog, reason: e.target.value })}
                  placeholder="e.g. Customer disputed 1 game / recount"
                  className="inp text-xs"
                />
                <p className="mt-1 text-[11px] text-ink-dim">
                  This justification is permanently stored in the audit trail.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2">
                <ActionButton
                  type="button"
                  onClick={() => setDialog(null)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </ActionButton>
                <ActionButton disabled={busy} className="btn btn-gold text-xs">
                  {busy ? 'Saving…' : 'Confirm'}
                </ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
