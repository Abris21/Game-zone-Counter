'use client'

import { useEffect, useState } from 'react'
import { sb, msg } from '@/lib/supabase'

interface EmployeeProfile {
  id: string
  full_name: string
  username?: string
}

export default function HandOver({
  session,
  onClose,
}: {
  session: string
  onClose: () => void
}) {
  const [employees, setEmployees] = useState<EmployeeProfile[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ;(async () => {
      const {
        data: { user },
      } = await sb.auth.getUser()
      const q = await sb
        .from('profiles')
        .select('id, full_name, username')
        .eq('role', 'employee')
        .eq('is_active', true)
        .is('deleted_at', null)

      if (q.error) setErr(msg(q.error))
      setEmployees((q.data || []).filter((x) => x.id !== user?.id))
    })()
  }, [])

  const handleHandover = async (targetId: string) => {
    setBusy(true)
    setErr('')
    const { error } = await sb.rpc('handover_session', {
      p_session: session,
      p_to: targetId,
    })
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      onClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-line pb-3">
          <div>
            <h3 className="font-display text-xl font-bold text-ink">Hand Over Session</h3>
            <p className="text-xs text-ink-muted">
              Transfer games, snacks and cash to colleague's shift
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted hover:text-ink"
          >
            ✕
          </button>
        </div>

        {err && (
          <div className="rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
            {err}
          </div>
        )}

        <div className="space-y-2">
          {employees.map((emp) => (
            <button
              key={emp.id}
              disabled={busy}
              onClick={() => handleHandover(emp.id)}
              className="flex w-full items-center justify-between rounded-xl border border-line bg-surface-elevated p-3 text-sm font-semibold text-ink hover:border-brand/50 hover:bg-surface-elevated/80 transition-colors disabled:opacity-50"
            >
              <span>{emp.full_name}</span>
              <span className="text-xs text-brand font-medium">Select →</span>
            </button>
          ))}

          {employees.length === 0 && !err && (
            <p className="py-6 text-center text-xs text-ink-muted">
              No other active employees found in your game zone.
            </p>
          )}
        </div>

        <button onClick={onClose} className="btn btn-secondary w-full text-xs">
          Cancel
        </button>
      </div>
    </div>
  )
}
