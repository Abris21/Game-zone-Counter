'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, api, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface Station {
  id: string
  name: string
  kind: string
  price: number
  price_override: number | null
}

interface Employee {
  id: string
  full_name: string
  username: string
  is_active: boolean
}

interface StationEdit {
  id: string
  name: string
  kind: string
  price: string
}

interface EmployeeEdit {
  id: string
  full_name: string
  username: string
}

export default function ManagePage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [stations, setStations] = useState<Station[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [typePrices, setTypePrices] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingStation, setEditingStation] = useState<StationEdit | null>(null)
  const [editingEmployee, setEditingEmployee] = useState<EmployeeEdit | null>(null)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)

  // New unit form
  const [newStation, setNewStation] = useState({
    kind: 'ps5',
    name: '',
    price: '',
  })

  // New employee form
  const [newEmp, setNewEmp] = useState({
    username: '',
    full_name: '',
    password: '',
  })

  // Password reset modal state
  const [resetEmp, setResetEmp] = useState<Employee | null>(null)
  const [newPassword, setNewPassword] = useState('')

  const hydrateLocalSnapshot = useCallback(() => {
    const snapStations = getLocalSnapshot<Station[]>('manage_stations')
    const snapEmployees = getLocalSnapshot<Employee[]>('manage_employees')
    const snapTypePrices = getLocalSnapshot<Record<string, number>>('manage_type_prices')

    let hasAny = false
    if (snapStations.data) { setStations(snapStations.data); hasAny = true }
    if (snapEmployees.data) { setEmployees(snapEmployees.data); hasAny = true }
    if (snapTypePrices.data) { setTypePrices(snapTypePrices.data); hasAny = true }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadData = useCallback(async () => {
    if (!profile?.zone_id) return
    hydrateLocalSnapshot()
    setBusy(true)

    const [stRes, empRes, upRes] = await Promise.all([
      sb
        .from('stations')
        .select('id, name, kind, price, price_override')
        .eq('is_archived', false)
        .order('sort_order'),
      sb
        .from('profiles')
        .select('id, full_name, username, is_active')
        .eq('role', 'employee')
        .is('deleted_at', null),
      sb.from('unit_prices').select('kind, price'),
    ])

    setBusy(false)
    if (stRes.error || empRes.error) {
      setErr(msg(stRes.error || empRes.error))
      return
    }

    const nextStations = (stRes.data as Station[]) || []
    const nextEmployees = (empRes.data as Employee[]) || []
    const nextTypePrices = Object.fromEntries(
      ((upRes.data || []) as { kind: string; price: number }[]).map((x) => [x.kind, Number(x.price)])
    )
    setStations(nextStations)
    setEmployees(nextEmployees)
    setTypePrices(nextTypePrices)
    setLocalSnapshot('manage_stations', nextStations)
    setLocalSnapshot('manage_employees', nextEmployees)
    setLocalSnapshot('manage_type_prices', nextTypePrices)
  }, [profile?.zone_id, hydrateLocalSnapshot])

  useEffect(() => {
    if (profile) {
      hydrateLocalSnapshot()
      void loadData()
    }
  }, [profile, loadData, hydrateLocalSnapshot])

  const handleAction = async (
    promise: PromiseLike<{ error: { message: string } | null }>,
    cb?: () => void
  ) => {
    setBusy(true)
    const { error } = await promise
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      cb?.()
      await loadData()
    }
  }

  // Create Unit
  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.zone_id) return

    handleAction(
      sb.from('stations').insert({
        zone_id: profile.zone_id,
        kind: newStation.kind,
        name: newStation.name.trim(),
        price: Number(newStation.price || typePrices[newStation.kind] || 0),
        price_override: newStation.price === '' ? null : Number(newStation.price),
        sort_order: stations.length + 1,
      }),
      () => setNewStation({ kind: 'ps5', name: '', price: '' })
    )
  }

  // Create Employee
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    const res = await api({
      action: 'create_employee',
      username: newEmp.username.trim().toLowerCase(),
      full_name: newEmp.full_name.trim(),
      password: newEmp.password,
    })

    setBusy(false)
    if (res.error) {
      setErr(msg(res.error))
    } else {
      setNewEmp({ username: '', full_name: '', password: '' })
      loadData()
    }
  }

  // Reset Employee Password
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resetEmp) return

    setBusy(true)
    setErr('')
    const res = await api({
      action: 'reset_password',
      id: resetEmp.id,
      password: newPassword,
    })

    setBusy(false)
    if (res.error) {
      setErr(msg(res.error))
    } else {
      setResetEmp(null)
      setNewPassword('')
      loadData()
    }
  }

  // Toggle Employee Active State
  const handleToggleActive = (emp: Employee) => {
    return handleAction(
      api({
        action: 'set_active',
        id: emp.id,
        active: !emp.is_active,
      })
    )
  }

  const handleSaveStation = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingStation) return
    const { id, name, kind, price } = editingStation
    const amount = Number(price)
    if (!name.trim() || !Number.isFinite(amount) || amount < 0) {
      setErr('Enter a station name and a valid non-negative price.')
      return
    }
    handleAction(
      sb.from('stations').update({
        name: name.trim(),
        kind,
        price: amount,
        price_override: amount,
      }).eq('id', id),
      () => setEditingStation(null)
    )
  }

  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEmployee) return
    setBusy(true)
    setErr('')
    const res = await api({
      action: 'update_employee',
      id: editingEmployee.id,
      username: editingEmployee.username.trim().toLowerCase(),
      full_name: editingEmployee.full_name.trim(),
    })
    setBusy(false)
    if (res.error) setErr(msg(res.error))
    else {
      setEditingEmployee(null)
      await loadData()
    }
  }

  const handleDeleteEmployee = async (emp: Employee) => {
    if (!confirm(`Delete ${emp.full_name}'s account? They will lose access, and their historical records will be kept.`)) return
    setBusy(true)
    setErr('')
    const res = await api({ action: 'delete_employee', id: emp.id })
    setBusy(false)
    if (res.error) setErr(msg(res.error))
    else await loadData()
  }

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading management view…</p>
          <p className="mt-1 text-xs text-ink-muted">Pulling station and employee data.</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Units & Staff Management"
      subtitle="Configure console hardware, default pricing and employee access accounts"
      onRefresh={loadData}
    >
      <div className="space-y-8">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Global Price by Unit Type */}
        <section className="surface-card p-5 space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Default Price per Game by Type</h2>
            <p className="text-xs text-ink-muted">
              Applies to all units of that type unless an individual unit has its own custom price override.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['ps5', 'PlayStation 5'],
              ['ps4', 'PlayStation 4'],
              ['pool', 'Billiards / Pool'],
            ].map(([k, label]) => (
              <div key={k} className="rounded-2xl border border-line bg-surface-elevated p-3 space-y-1">
                <label className="text-[11px] font-bold uppercase text-ink-dim tracking-wider block">
                  {label}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0"
                    key={`${k}-${typePrices[k]}`}
                    defaultValue={typePrices[k] ?? ''}
                    onBlur={(e) =>
                      e.target.value !== '' &&
                      Number(e.target.value) !== typePrices[k] &&
                      handleAction(
                        sb.from('unit_prices').upsert(
                          {
                            zone_id: profile!.zone_id,
                            kind: k,
                            price: Number(e.target.value),
                          },
                          { onConflict: 'zone_id,kind' }
                        )
                      )
                    }
                    className="inp text-sm font-bold text-brand h-9"
                  />
                  <span className="text-xs text-ink-muted font-bold">ETB</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Individual Gaming Units */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-base font-bold text-ink">Gaming Consoles & Stations</h2>
              <p className="text-xs text-ink-muted">
                {stations.length} units active · Limit: {zone?.max_stations || 10}
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {stations.map((s) => (
              <div
                key={s.id}
                className="surface-card p-4 space-y-3 flex flex-col justify-between"
              >
                <div className="flex items-start justify-between">
                  <div>
                    {editingStation?.id === s.id ? (
                      <form onSubmit={handleSaveStation} className="space-y-2">
                        <input
                          required
                          aria-label="Station name"
                          value={editingStation.name}
                          onChange={(e) => setEditingStation({ ...editingStation, name: e.target.value })}
                          className="inp h-8 text-xs"
                        />
                        <div className="flex gap-2">
                          <select
                            aria-label="Station type"
                            value={editingStation.kind}
                            onChange={(e) => setEditingStation({ ...editingStation, kind: e.target.value })}
                            className="inp h-8 text-xs"
                          >
                            <option value="ps5">PS5</option>
                            <option value="ps4">PS4</option>
                            <option value="pool">Pool</option>
                            <option value="other">Other</option>
                          </select>
                          <input
                            required
                            type="number"
                            min="0"
                            aria-label="Price per game"
                            value={editingStation.price}
                            onChange={(e) => setEditingStation({ ...editingStation, price: e.target.value })}
                            className="inp h-8 text-xs"
                          />
                        </div>
                        <div className="flex gap-2">
                          <ActionButton type="submit" disabled={busy} className="btn btn-gold h-8 min-h-8 px-3 text-xs">
                            Save Changes
                          </ActionButton>
                          <ActionButton type="button" onClick={() => setEditingStation(null)} className="btn btn-secondary h-8 min-h-8 px-3 text-xs">
                            Cancel
                          </ActionButton>
                        </div>
                      </form>
                    ) : (
                      <>
                        <h3 className="font-display text-base font-bold text-ink">{s.name}</h3>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                          {s.kind.toUpperCase()} ·{' '}
                          {s.price_override != null ? 'Custom Unit Price' : 'Default Type Price'}
                        </p>
                      </>
                    )}
                  </div>
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-elevated text-xs border border-line">
                    🎮
                  </span>
                </div>

                <div className={`flex items-center gap-2 pt-2 border-t border-line/60 ${editingStation?.id === s.id ? 'hidden' : ''}`}>
                  <div className="flex-1">
                    <label className="text-[10px] text-ink-dim uppercase font-bold">Price / Game</label>
                    <input
                      type="number"
                      min="0"
                      defaultValue={s.price}
                      onBlur={(e) =>
                        e.target.value !== '' &&
                        Number(e.target.value) !== s.price &&
                        handleAction(
                          sb
                            .from('stations')
                            .update({ price_override: Number(e.target.value) })
                            .eq('id', s.id)
                        )
                      }
                      className="inp text-xs font-bold text-brand h-8"
                    />
                  </div>

                  {s.price_override != null && (
                    <ActionButton
                      onClick={() =>
                        handleAction(
                          sb.from('stations').update({ price_override: null }).eq('id', s.id)
                        )
                      }
                      className="text-[11px] text-brand hover:underline mt-3 shrink-0"
                    >
                      Use Type Price
                    </ActionButton>
                  )}

                  <ActionButton
                    disabled={busy}
                    onClick={() => setEditingStation({ id: s.id, name: s.name, kind: s.kind, price: String(s.price) })}
                    className="text-xs text-brand hover:underline mt-3 shrink-0"
                  >
                    Edit
                  </ActionButton>

                  <ActionButton
                    onClick={() =>
                      confirm(`Delete ${s.name} from active units? Past records will remain intact.`) &&
                      handleAction(
                        sb.from('stations').update({ is_archived: true }).eq('id', s.id)
                      )
                    }
                    className="text-xs text-bad hover:underline mt-3 shrink-0"
                  >
                    Delete
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>

          {/* Add Unit Form */}
          <form
            onSubmit={handleAddUnit}
            className="surface-card p-4.5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold text-ink">+ Add Console Station</h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <select
                value={newStation.kind}
                onChange={(e) => setNewStation({ ...newStation, kind: e.target.value })}
                className="inp text-xs"
              >
                <option value="ps5">PlayStation 5</option>
                <option value="ps4">PlayStation 4</option>
                <option value="pool">Billiards / Pool</option>
              </select>

              <input
                required
                value={newStation.name}
                onChange={(e) => setNewStation({ ...newStation, name: e.target.value })}
                placeholder="Station Name (e.g. PS5-1, PS5-VIP)"
                className="inp text-xs sm:col-span-2"
              />

              <input
                type="number"
                min="0"
                value={newStation.price}
                onChange={(e) => setNewStation({ ...newStation, price: e.target.value })}
                placeholder="Own price (optional)"
                className="inp text-xs"
              />
            </div>
            <ActionButton disabled={busy} className="btn btn-gold text-xs">
              + Add Console Station
            </ActionButton>
          </form>
        </section>

        {/* Staff & Employee Accounts */}
        <section className="space-y-4">
          <div>
            <h2 className="font-display text-base font-bold text-ink">Employee Counter Accounts</h2>
            <p className="text-xs text-ink-muted">
              {employees.length} employees registered · Limit: {zone?.max_employees || 3}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {employees.map((emp) => (
              <div
                key={emp.id}
                className="surface-card p-4 space-y-3 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-sm text-ink">{emp.full_name}</h3>
                      <p className="text-xs text-ink-dim">@{emp.username}</p>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${emp.is_active
                        ? 'bg-ok/20 text-ok border border-ok/40'
                        : 'bg-bad/20 text-bad border border-bad/40'
                        }`}
                    >
                      {emp.is_active ? 'Active' : 'Deactivated'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-line/60 flex items-center justify-between text-xs">
                  <ActionButton
                    onClick={() => setEditingEmployee({ id: emp.id, full_name: emp.full_name, username: emp.username })}
                    className="text-brand hover:underline font-semibold"
                  >
                    Edit
                  </ActionButton>
                  <ActionButton
                    onClick={() => {
                      setResetEmp(emp)
                      setNewPassword('')
                    }}
                    className="text-brand hover:underline font-semibold"
                  >
                    Reset Password
                  </ActionButton>

                  <ActionButton
                    onClick={() => handleToggleActive(emp)}
                    className={`font-semibold hover:underline ${emp.is_active ? 'text-bad' : 'text-ok'
                      }`}
                  >
                    {emp.is_active ? 'Deactivate' : 'Activate'}
                  </ActionButton>
                  <ActionButton
                    onClick={() => handleDeleteEmployee(emp)}
                    className="font-semibold text-bad hover:underline"
                  >
                    Delete
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>

          {/* Add Employee Form */}
          <form
            onSubmit={handleAddEmployee}
            className="surface-card p-4.5 space-y-3"
          >
            <h3 className="font-display text-sm font-bold text-ink">+ Create Employee Login</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                required
                value={newEmp.full_name}
                onChange={(e) => setNewEmp({ ...newEmp, full_name: e.target.value })}
                placeholder="Full Name (e.g. Alazar Mengistu)"
                className="inp text-xs"
              />
              <input
                required
                value={newEmp.username}
                onChange={(e) => setNewEmp({ ...newEmp, username: e.target.value })}
                placeholder="Username (e.g. alazar)"
                autoComplete="off"
                className="inp text-xs"
              />
              <input
                required
                type="password"
                value={newEmp.password}
                onChange={(e) => setNewEmp({ ...newEmp, password: e.target.value })}
                placeholder="Password (8+ chars)"
                autoComplete="new-password"
                className="inp text-xs"
              />
            </div>
            <ActionButton disabled={busy} className="btn btn-gold text-xs">
              Create Employee Login
            </ActionButton>
          </form>
        </section>
      </div>

      {/* Password Reset Modal */}
      {resetEmp && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-ink">
              Reset Password for {resetEmp.full_name}
            </h3>
            <p className="text-xs text-ink-muted">
              Enter a temporary password. The employee will be prompted to change it upon first login.
            </p>
            <form onSubmit={handleResetPassword} className="space-y-3">
              <input
                required
                type="password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (8+ chars)"
                className="inp text-xs"
              />
              <div className="grid grid-cols-2 gap-2">
                <ActionButton
                  type="button"
                  onClick={() => setResetEmp(null)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </ActionButton>
                <ActionButton disabled={busy} className="btn btn-gold text-xs">
                  Save Password
                </ActionButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingEmployee && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <form onSubmit={handleSaveEmployee} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <h3 className="font-display text-lg font-bold text-ink">Edit Employee</h3>
            <label className="block space-y-1 text-xs text-ink-muted">
              <span>Full name</span>
              <input required value={editingEmployee.full_name} onChange={(e) => setEditingEmployee({ ...editingEmployee, full_name: e.target.value })} className="inp text-xs" />
            </label>
            <label className="block space-y-1 text-xs text-ink-muted">
              <span>Username</span>
              <input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9._-]+" value={editingEmployee.username} onChange={(e) => setEditingEmployee({ ...editingEmployee, username: e.target.value })} className="inp text-xs" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <ActionButton type="button" onClick={() => setEditingEmployee(null)} className="btn btn-secondary text-xs">Cancel</ActionButton>
              <ActionButton type="submit" disabled={busy} className="btn btn-gold text-xs">Save Changes</ActionButton>
            </div>
          </form>
        </div>
      )}
    </AppLayout>
  )
}
