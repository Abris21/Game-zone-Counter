'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'

interface AuditLogItem {
  id: string
  user_id: string
  action: string
  entity: string
  reason: string | null
  previous_state: unknown
  new_state: unknown
  created_at: string
}

export default function AuditPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [userNames, setUserNames] = useState<Record<string, string>>({})
  const [filterAction, setFilterAction] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const loadAuditLogs = useCallback(async () => {
    setBusy(true)
    const [logRes, profRes] = await Promise.all([
      sb
        .from('audit_logs')
        .select('id, user_id, action, entity, reason, previous_state, new_state, created_at')
        .order('created_at', { ascending: false })
        .limit(250),
      sb.from('profiles').select('id, full_name'),
    ])

    setBusy(false)
    if (logRes.error) {
      setErr(msg(logRes.error))
      return
    }

    setLogs((logRes.data as AuditLogItem[]) || [])
    setUserNames(
      Object.fromEntries(
        ((profRes.data || []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name])
      )
    )
  }, [])

  useEffect(() => {
    loadAuditLogs()
  }, [loadAuditLogs])

  const filteredLogs = logs.filter((l) =>
    filterAction ? l.action.toLowerCase().includes(filterAction.toLowerCase()) : true
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
      title="Audit Trail"
      subtitle="Immutable security logs for financial changes, session voids and system configuration"
      onRefresh={loadAuditLogs}
    >
      <div className="max-w-3xl mx-auto space-y-5">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Filter bar */}
        <div className="surface-card p-4 flex items-center justify-between gap-3">
          <input
            value={filterAction}
            onChange={(e) => setFilterAction(e.target.value)}
            placeholder="Search action or entity (e.g. edit_session, void_sale, close_shift)"
            className="inp text-xs"
          />
          <span className="text-xs text-ink-muted whitespace-nowrap font-bold">
            {filteredLogs.length} events
          </span>
        </div>

        {/* Logs list */}
        <div className="space-y-3">
          {filteredLogs.map((item) => (
            <details
              key={item.id}
              className="surface-card p-4 transition-colors group space-y-2 cursor-pointer"
            >
              <summary className="flex items-center justify-between list-none">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-elevated text-xs border border-line">
                    🛡️
                  </span>
                  <div>
                    <p className="font-bold text-sm text-ink capitalize">
                      {item.action.replace(/_/g, ' ')}
                    </p>
                    <p className="text-xs text-ink-muted">
                      By <b className="text-brand">{userNames[item.user_id] ?? 'System'}</b> ·{' '}
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>

                <span className="text-xs text-ink-dim group-open:rotate-180 transition-transform">
                  ▼
                </span>
              </summary>

              {item.reason && (
                <div className="mt-2 rounded-xl bg-surface-elevated p-3 border border-line text-xs">
                  <span className="font-bold text-brand">Justification:</span> “{item.reason}”
                </div>
              )}

              <div className="mt-2 rounded-xl bg-black/50 p-3 border border-line text-[11px] overflow-x-auto font-mono text-ink-muted">
                <p className="text-[10px] uppercase font-bold text-ink-dim mb-1">State Diff Payload:</p>
                <pre>{JSON.stringify({ before: item.previous_state, after: item.new_state }, null, 2)}</pre>
              </div>
            </details>
          ))}

          {filteredLogs.length === 0 && !busy && (
            <div className="surface-card p-10 text-center text-xs text-ink-muted">
              No audit logs match the current criteria.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
