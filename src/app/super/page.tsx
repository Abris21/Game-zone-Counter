'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, api, msg } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'

interface GameZoneItem {
  id: string
  name: string
  status: 'active' | 'suspended'
  max_employees: number
  max_stations: number
  created_at: string
}

export default function SuperAdminPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuthGuard(['super_admin'])

  const [zones, setZones] = useState<GameZoneItem[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const [newZone, setNewZone] = useState({
    zone_name: '',
    full_name: '',
    email: '',
    password: '',
    max_employees: '3',
    max_stations: '10',
  })

  const loadZones = useCallback(async () => {
    setBusy(true)
    const { data, error } = await sb
      .from('game_zones')
      .select('id, name, status, max_employees, max_stations, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    setBusy(false)
    if (error) {
      setErr(msg(error))
      return
    }

    setZones((data as GameZoneItem[]) || [])
  }, [])

  useEffect(() => {
    loadZones()
  }, [loadZones])

  const handleCreateOwner = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    const res = await api({
      action: 'create_admin',
      ...newZone,
    })

    setBusy(false)
    if (res.error) {
      setErr(msg(res.error))
    } else {
      setNewZone({
        zone_name: '',
        full_name: '',
        email: '',
        password: '',
        max_employees: '3',
        max_stations: '10',
      })
      loadZones()
    }
  }

  const handleToggleZone = async (z: GameZoneItem) => {
    setBusy(true)
    const newStatus = z.status === 'active' ? 'suspended' : 'active'
    const { error } = await sb.from('game_zones').update({ status: newStatus }).eq('id', z.id)
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      loadZones()
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-ink">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  const activeCount = zones.filter((z) => z.status === 'active').length

  return (
    <AppLayout
      profile={profile}
      title="Platform Super-Admin"
      subtitle={`${zones.length} registered game zones · ${activeCount} active tenants`}
      onRefresh={loadZones}
    >
      <div className="max-w-3xl mx-auto space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Provision New Game Zone Form */}
        <form onSubmit={handleCreateOwner} className="surface-card p-5 space-y-4">
          <h2 className="font-display text-base font-bold text-ink">
            + Provision New Game Zone Tenant
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Game Zone Business Name
              </label>
              <input
                required
                value={newZone.zone_name}
                onChange={(e) => setNewZone({ ...newZone, zone_name: e.target.value })}
                placeholder="e.g. PlayStation Zone Bole"
                className="inp text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Owner Full Name
              </label>
              <input
                required
                value={newZone.full_name}
                onChange={(e) => setNewZone({ ...newZone, full_name: e.target.value })}
                placeholder="e.g. Solomon Desta"
                className="inp text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Owner Email (Login ID)
              </label>
              <input
                required
                type="email"
                value={newZone.email}
                onChange={(e) => setNewZone({ ...newZone, email: e.target.value })}
                placeholder="owner@business.com"
                className="inp text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Temporary Password (8+ chars)
              </label>
              <input
                required
                type="password"
                value={newZone.password}
                onChange={(e) => setNewZone({ ...newZone, password: e.target.value })}
                placeholder="Password"
                className="inp text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Max Employees Quota
              </label>
              <input
                required
                type="number"
                min="1"
                value={newZone.max_employees}
                onChange={(e) => setNewZone({ ...newZone, max_employees: e.target.value })}
                className="inp text-xs font-bold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                Max Stations Quota
              </label>
              <input
                required
                type="number"
                min="1"
                value={newZone.max_stations}
                onChange={(e) => setNewZone({ ...newZone, max_stations: e.target.value })}
                className="inp text-xs font-bold"
              />
            </div>
          </div>

          <button disabled={busy} className="btn btn-gold w-full text-xs">
            {busy ? 'Provisioning…' : 'Create Game Zone & Owner'}
          </button>
        </form>

        {/* Game Zones List */}
        <div className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Registered Tenants</h2>
          <div className="grid gap-3">
            {zones.map((z) => (
              <div
                key={z.id}
                className="surface-card p-4 flex items-center justify-between gap-3"
              >
                <div>
                  <h3 className="font-bold text-sm text-ink">{z.name}</h3>
                  <p className="text-xs text-ink-muted">
                    Limit: {z.max_stations} units · {z.max_employees} staff members · Registered{' '}
                    {new Date(z.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      z.status === 'active'
                        ? 'bg-ok/20 text-ok border border-ok/40'
                        : 'bg-bad/20 text-bad border border-bad/40'
                    }`}
                  >
                    {z.status === 'active' ? 'Active' : 'Suspended'}
                  </span>

                  <button
                    disabled={busy}
                    onClick={() => handleToggleZone(z)}
                    className={`btn text-xs py-1.5 px-3 ${
                      z.status === 'active'
                        ? 'btn-secondary text-bad hover:border-bad'
                        : 'btn-gold'
                    }`}
                  >
                    {z.status === 'active' ? 'Suspend' : 'Activate'}
                  </button>
                </div>
              </div>
            ))}

            {zones.length === 0 && (
              <div className="surface-card p-10 text-center text-xs text-ink-muted">
                No game zones provisioned yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
