'use client'

import { useCallback, useEffect, useState } from 'react'
import { sb, msg, etb } from '@/lib/supabase'

interface PendingShift {
  id: string
  expected_cash: number
  counted_cash: number
  variance: number
  note: string | null
  profiles: { full_name: string } | null
}

export default function PendingShifts() {
  const [shifts, setShifts] = useState<PendingShift[]>([])
  const [err, setErr] = useState('')
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await sb
      .from('shifts')
      .select('id, expected_cash, counted_cash, variance, note, profiles(full_name)')
      .eq('status', 'pending_verification')
    if (error) {
      setErr(msg(error))
      return
    }
    setShifts((data as unknown as PendingShift[]) || [])
  }, [])

  useEffect(() => {
    load()
    const channel = sb
      .channel('shifts-live-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shifts' }, () => load())
      .subscribe()
    return () => {
      sb.removeChannel(channel)
    }
  }, [load])

  const handleVerify = async (id: string, approve: boolean, note?: string) => {
    setBusy(true)
    setErr('')
    const { error } = await sb.rpc('verify_shift', {
      p_shift: id,
      p_approve: approve,
      p_note: note || (approve ? null : 'Sent back by owner for cash correction'),
    })
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setRejectId(null)
      setRejectReason('')
      load()
    }
  }

  if (shifts.length === 0 && !err) return null

  return (
    <section className="mb-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-ink flex items-center gap-2">
          <span>🔔</span>
          <span>Shifts Awaiting Cash Verification</span>
          <span className="rounded-full bg-brand/20 border border-brand/50 px-2 py-0.5 text-xs font-bold text-brand">
            {shifts.length}
          </span>
        </h2>
      </div>

      {err && (
        <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
          {err}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {shifts.map((s) => {
          const isMatch = s.variance === 0
          const isDeficit = s.variance < 0

          return (
            <div
              key={s.id}
              className="surface-card-gold p-4.5 space-y-3 relative overflow-hidden"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-bold text-base text-ink">
                    {s.profiles?.full_name ?? 'Employee'}
                  </p>
                  <p className="text-xs text-ink-muted">Submitted for closeout</p>
                </div>
                <span
                  className={`rounded-lg px-2.5 py-1 text-xs font-extrabold ${
                    isMatch
                      ? 'bg-ok/20 text-ok border border-ok/40'
                      : isDeficit
                      ? 'bg-bad/20 text-bad border border-bad/40'
                      : 'bg-warning/20 text-warning border border-warning/40'
                  }`}
                >
                  {isMatch ? 'Exact Match' : isDeficit ? 'Deficit' : 'Surplus'}
                </span>
              </div>

              {/* Cash breakdown grid */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-surface-elevated/80 p-3 text-xs">
                <div>
                  <p className="text-ink-dim">Expected Cash</p>
                  <p className="font-bold text-ink text-sm">{etb(s.expected_cash)}</p>
                </div>
                <div>
                  <p className="text-ink-dim">Counted Cash</p>
                  <p className="font-bold text-ink text-sm">{etb(s.counted_cash)}</p>
                </div>
                <div className="col-span-2 pt-1 border-t border-line/60 flex justify-between items-center">
                  <span className="text-ink-dim">Variance:</span>
                  <span
                    className={`font-display text-base font-bold ${
                      isMatch ? 'text-ok' : isDeficit ? 'text-bad' : 'text-warning'
                    }`}
                  >
                    {isMatch ? '0 ETB' : `${s.variance > 0 ? '+' : ''}${etb(s.variance)}`}
                  </span>
                </div>
              </div>

              {s.note && (
                <p className="rounded-lg bg-surface-elevated px-3 py-2 text-xs italic text-ink/70">
                  “{s.note}”
                </p>
              )}

              {/* Actions */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  disabled={busy}
                  onClick={() => setRejectId(s.id)}
                  className="btn btn-secondary text-xs text-bad hover:border-bad/50"
                >
                  Send Back
                </button>
                <button
                  disabled={busy}
                  onClick={() => handleVerify(s.id, true)}
                  className="btn btn-gold text-xs"
                >
                  Settle Shift
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reject Modal */}
      {rejectId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-xl font-bold text-ink">Send Shift Back</h3>
            <p className="text-xs text-ink-muted">
              Explain why this shift is being sent back so the employee can recount or correct it.
            </p>
            <input
              required
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for sending back (e.g. recount drawer)"
              className="inp text-sm"
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setRejectId(null)}
                className="btn btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleVerify(rejectId, false, rejectReason)}
                className="btn bg-bad text-white text-xs hover:bg-bad/80 font-bold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
