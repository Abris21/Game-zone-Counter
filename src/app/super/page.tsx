'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, msg } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface GameZoneItem {
  id: string
  owner_id: string | null
  name: string
  status: 'active' | 'suspended'
  owner_approved: boolean
  max_employees: number
  max_stations: number
  created_at: string
  owner: { id: string; full_name: string; email: string; is_active: boolean } | null
  staff: { id: string; full_name: string; username: string | null; is_active: boolean }[]
}

interface OwnerEdit {
  zone_id: string
  owner_id: string
  zone_name: string
  full_name: string
  email: string
  max_employees: string
  max_stations: string
  temporary_password: string
}

interface StaffEdit {
  zone_id: string
  id: string
  full_name: string
  username: string
}

export default function SuperAdminPage() {
  const router = useRouter()
  const { user, profile, loading } = useAuthGuard(['super_admin'])

  const [zones, setZones] = useState<GameZoneItem[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)
  const [editingOwner, setEditingOwner] = useState<OwnerEdit | null>(null)
  const [editingStaff, setEditingStaff] = useState<StaffEdit | null>(null)

  const [newZone, setNewZone] = useState({
    zone_name: '',
    full_name: '',
    email: '',
    password: '',
    max_employees: '3',
    max_stations: '10',
  })

  const hydrateLocalSnapshot = useCallback(() => {
    const snapZones = getLocalSnapshot<GameZoneItem[]>('super_tenants_v2')
    let hasAny = false
    if (snapZones.data) {
      setZones(snapZones.data)
      hasAny = true
    }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadZones = useCallback(async () => {
    hydrateLocalSnapshot()
    setBusy(true)
    const result = await api({ action: 'list_tenants' })
    setBusy(false)
    if (result.error) {
      setErr(msg(result.error))
      return
    }

    const nextZones = (result.data?.tenants as GameZoneItem[]) || []
    setZones(nextZones)
    setLocalSnapshot('super_tenants_v2', nextZones)
  }, [hydrateLocalSnapshot])

  useEffect(() => {
    hydrateLocalSnapshot()
    void loadZones()
  }, [loadZones, hydrateLocalSnapshot])

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

  const handleOwnerAccess = async (z: GameZoneItem) => {
    setBusy(true)
    setErr('')
    const result = await api({
      action: 'set_owner_access',
      zone_id: z.id,
      active: z.status !== 'active',
    })
    setBusy(false)
    if (result.error) {
      setErr(msg(result.error))
    } else {
      await loadZones()
    }
  }

  const handleApproveOwner = async (zoneId: string) => {
    setBusy(true)
    setErr('')
    const result = await api({ action: 'approve_owner', zone_id: zoneId })
    setBusy(false)
    if (result.error) setErr(msg(result.error))
    else await loadZones()
  }

  const handleSaveOwner = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingOwner) return
    setBusy(true)
    setErr('')
    const { temporary_password, ...ownerDetails } = editingOwner
    const result = await api({ action: 'update_owner', ...ownerDetails })
    const passwordResult = !result.error && temporary_password.length >= 8
      ? await api({ action: 'reset_password', id: editingOwner.owner_id, password: temporary_password, reason: 'Super-admin owner password reset' })
      : null
    setBusy(false)
    if (result.error || passwordResult?.error) setErr(msg(result.error || passwordResult?.error))
    else {
      setEditingOwner(null)
      await loadZones()
    }
  }

  const handleDeleteOwner = async (tenant: GameZoneItem) => {
    if (!confirm(`Delete ${tenant.name} and revoke access for its owner and staff? Historical records will be retained.`)) return
    setBusy(true)
    setErr('')
    const result = await api({ action: 'delete_owner', zone_id: tenant.id })
    setBusy(false)
    if (result.error) setErr(msg(result.error))
    else await loadZones()
  }

  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingStaff) return
    setBusy(true)
    setErr('')
    const result = await api({ action: 'update_employee', ...editingStaff })
    setBusy(false)
    if (result.error) setErr(msg(result.error))
    else {
      setEditingStaff(null)
      await loadZones()
    }
  }

  const handleStaffAccess = async (staffId: string, active: boolean) => {
    setBusy(true)
    setErr('')
    const result = await api({ action: 'set_active', id: staffId, active })
    setBusy(false)
    if (result.error) setErr(msg(result.error))
    else await loadZones()
  }

  const handleDeleteStaff = async (tenantId: string, staffId: string, name: string) => {
    if (!confirm(`Delete ${name}'s staff account? Historical records will be retained.`)) return
    setBusy(true)
    setErr('')
    const result = await api({ action: 'delete_employee', id: staffId, zone_id: tenantId })
    setBusy(false)
    if (result.error) setErr(msg(result.error))
    else await loadZones()
  }

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading admin panel…</p>
          <p className="mt-1 text-xs text-ink-muted">Preparing tenant and system data.</p>
        </div>
      </div>
    )
  }

  const activeCount = zones.filter((z) => z.status === 'active' && z.owner_approved).length
  const pendingCount = zones.filter((z) => !z.owner_approved).length

  return (
    <AppLayout
      profile={profile}
      title="Platform Super-Admin"
      subtitle={`${zones.length} game zones · ${activeCount} active · ${pendingCount} awaiting approval`}
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

          <ActionButton disabled={busy} className="btn btn-gold w-full text-xs">
            {busy ? 'Provisioning…' : 'Create Game Zone & Owner'}
          </ActionButton>
        </form>

        {/* Game Zones List */}
        <div className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Registered Tenants</h2>
          <div className="grid gap-3">
            {zones.map((z) => (
              <article key={z.id} className="surface-card space-y-4 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-sm text-ink">{z.name}</h3>
                    <p className="mt-1 text-xs text-ink-muted">
                      {z.owner?.full_name || 'Owner missing'} · {z.owner?.email || 'No email'}
                    </p>
                    <p className="text-xs text-ink-muted">
                      Limit: {z.max_stations} units · {z.max_employees} staff · Registered {new Date(z.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${!z.owner_approved ? 'border-warning/40 bg-warning/20 text-warning' : z.status === 'active' ? 'border-ok/40 bg-ok/20 text-ok' : 'border-bad/40 bg-bad/20 text-bad'}`}>
                    {!z.owner_approved ? 'Pending approval' : z.status === 'active' ? 'Active' : 'Suspended'}
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-line/60 pt-3">
                  {!z.owner_approved ? (
                    <ActionButton disabled={busy} onClick={() => handleApproveOwner(z.id)} className="btn btn-gold text-xs">Approve & Grant Access</ActionButton>
                  ) : (
                    <ActionButton disabled={busy} onClick={() => handleOwnerAccess(z)} className={`btn text-xs ${z.status === 'active' ? 'btn-secondary text-bad hover:border-bad' : 'btn-gold'}`}>
                      {z.status === 'active' ? 'Suspend access' : 'Restore access'}
                    </ActionButton>
                  )}
                  <ActionButton disabled={busy || !z.owner} onClick={() => z.owner && setEditingOwner({ zone_id: z.id, owner_id: z.owner.id, zone_name: z.name, full_name: z.owner.full_name || '', email: z.owner.email || '', max_employees: String(z.max_employees), max_stations: String(z.max_stations), temporary_password: '' })} className="btn btn-secondary text-xs">Edit owner / zone</ActionButton>
                  <ActionButton disabled={busy || !z.owner} onClick={() => handleDeleteOwner(z)} className="btn btn-secondary text-xs text-bad">Delete owner</ActionButton>
                </div>

                <details className="border-t border-line/60 pt-3">
                  <summary className="cursor-pointer text-xs font-bold text-ink">Staff accounts ({z.staff.length})</summary>
                  <div className="mt-3 space-y-2">
                    {z.staff.map((staff) => (
                      <div key={staff.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-elevated p-2.5">
                        <div>
                          <p className="text-xs font-semibold text-ink">{staff.full_name || 'Unnamed employee'}</p>
                          <p className="text-[11px] text-ink-muted">@{staff.username || 'no username'} · {staff.is_active ? 'Active' : 'Inactive'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ActionButton disabled={busy} onClick={() => setEditingStaff({ zone_id: z.id, id: staff.id, full_name: staff.full_name || '', username: staff.username || '' })} className="text-xs font-semibold text-brand">Edit</ActionButton>
                          <ActionButton disabled={busy} onClick={() => handleStaffAccess(staff.id, !staff.is_active)} className={`text-xs font-semibold ${staff.is_active ? 'text-bad' : 'text-ok'}`}>{staff.is_active ? 'Deactivate' : 'Activate'}</ActionButton>
                          <ActionButton disabled={busy} onClick={() => handleDeleteStaff(z.id, staff.id, staff.full_name || 'this employee')} className="text-xs font-semibold text-bad">Delete</ActionButton>
                        </div>
                      </div>
                    ))}
                    {z.staff.length === 0 && <p className="text-xs text-ink-muted">No staff accounts for this zone.</p>}
                  </div>
                </details>
              </article>
            ))}

            {zones.length === 0 && (
              <div className="surface-card p-10 text-center text-xs text-ink-muted">
                No game zones provisioned yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {editingOwner && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form onSubmit={handleSaveOwner} className="w-full max-w-lg space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-ink">Edit owner and game zone</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-ink-muted">Owner full name<input required value={editingOwner.full_name} onChange={(e) => setEditingOwner({ ...editingOwner, full_name: e.target.value })} className="inp text-xs" /></label>
              <label className="space-y-1 text-xs text-ink-muted">Owner email<input required type="email" value={editingOwner.email} onChange={(e) => setEditingOwner({ ...editingOwner, email: e.target.value })} className="inp text-xs" /></label>
              <label className="space-y-1 text-xs text-ink-muted">Game zone name<input required value={editingOwner.zone_name} onChange={(e) => setEditingOwner({ ...editingOwner, zone_name: e.target.value })} className="inp text-xs" /></label>
              <label className="space-y-1 text-xs text-ink-muted">Staff limit<input required type="number" min="1" value={editingOwner.max_employees} onChange={(e) => setEditingOwner({ ...editingOwner, max_employees: e.target.value })} className="inp text-xs" /></label>
              <label className="space-y-1 text-xs text-ink-muted">Station limit<input required type="number" min="1" value={editingOwner.max_stations} onChange={(e) => setEditingOwner({ ...editingOwner, max_stations: e.target.value })} className="inp text-xs" /></label>
              <label className="space-y-1 text-xs text-ink-muted sm:col-span-2">Temporary password (optional, 8+ characters)<input type="password" minLength={8} autoComplete="new-password" value={editingOwner.temporary_password} onChange={(e) => setEditingOwner({ ...editingOwner, temporary_password: e.target.value })} className="inp text-xs" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton type="button" onClick={() => setEditingOwner(null)} className="btn btn-secondary text-xs">Cancel</ActionButton>
              <ActionButton type="submit" disabled={busy} className="btn btn-gold text-xs">Save details</ActionButton>
            </div>
          </form>
        </div>
      )}

      {editingStaff && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <form onSubmit={handleSaveStaff} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-5 shadow-2xl">
            <h2 className="font-display text-lg font-bold text-ink">Edit staff account</h2>
            <label className="block space-y-1 text-xs text-ink-muted">Full name<input required value={editingStaff.full_name} onChange={(e) => setEditingStaff({ ...editingStaff, full_name: e.target.value })} className="inp text-xs" /></label>
            <label className="block space-y-1 text-xs text-ink-muted">Username<input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" value={editingStaff.username} onChange={(e) => setEditingStaff({ ...editingStaff, username: e.target.value })} className="inp text-xs" /></label>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton type="button" onClick={() => setEditingStaff(null)} className="btn btn-secondary text-xs">Cancel</ActionButton>
              <ActionButton type="submit" disabled={busy} className="btn btn-gold text-xs">Save changes</ActionButton>
            </div>
          </form>
        </div>
      )}
    </AppLayout>
  )
}
