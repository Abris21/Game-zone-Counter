'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, api, msg } from '@/lib/supabase'
import { useAuthGuard, ROLE_HOMES, UserRole } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import Prefs from '@/components/Prefs'

export default function AccountPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard()

  const [name, setName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [isForced, setIsForced] = useState(false)
  const [okMsg, setOkMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsForced(window.location.search.includes('force=1'))
    }
    if (profile?.full_name) {
      setName(profile.full_name)
    }
  }, [profile])

  const notify = (ok: string, error = '') => {
    setOkMsg(ok)
    setErr(error)
  }

  const reauthenticate = async (pw: string) => {
    if (!user?.email) return false
    const { error } = await sb.auth.signInWithPassword({
      email: user.email,
      password: pw,
    })
    return !error
  }

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await sb.rpc('update_profile', { p_name: name })
    setBusy(false)
    if (error) {
      notify('', msg(error))
    } else {
      notify('Full name updated successfully.')
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      return notify('', 'New password must be 8 or more characters.')
    }

    setBusy(true)
    const valid = await reauthenticate(currentPassword)
    if (!valid) {
      setBusy(false)
      return notify('', 'Current password is incorrect.')
    }

    const { error } = await sb.auth.updateUser({ password: newPassword })
    setBusy(false)
    if (error) {
      notify('', error.message)
    } else {
      setCurrentPassword('')
      setNewPassword('')
      await sb.rpc('clear_must_change')
      if (isForced) {
        const home = ROLE_HOMES[profile?.role as UserRole] || '/counter'
        router.replace(home)
      } else {
        notify('Password updated successfully.')
      }
    }
  }

  const handleDeleteZone = async (e: React.FormEvent) => {
    e.preventDefault()
    if (deleteConfirm !== 'DELETE') {
      return notify('', 'Type DELETE in capital letters to confirm.')
    }

    setBusy(true)
    const valid = await reauthenticate(deletePassword)
    if (!valid) {
      setBusy(false)
      return notify('', 'Password is incorrect.')
    }

    const res = await api({ action: 'delete_self' })
    setBusy(false)
    if (res.error) {
      notify('', msg(res.error))
    } else {
      await sb.auth.signOut()
      router.replace('/login')
    }
  }

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
      title="Account Settings"
      subtitle="Manage profile identity, security credentials and language preferences"
    >
      <div className="max-w-xl mx-auto space-y-6">
        {isForced && (
          <div className="rounded-2xl border border-brand/50 bg-brand/10 p-4 text-xs font-semibold text-brand">
            ⚠️ Please set a new personal password before accessing the system.
          </div>
        )}

        {okMsg && (
          <div role="status" className="rounded-2xl border border-ok/40 bg-ok/10 p-3.5 text-xs text-ok">
            ✓ {okMsg}
          </div>
        )}
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Profile Card */}
        <form onSubmit={handleSaveName} className="surface-card p-5 space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Personal Profile</h2>
          <div className="space-y-1">
            <label className="block text-xs font-semibold text-ink-muted">Full Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="inp text-sm"
            />
          </div>
          <div className="flex items-center justify-between text-xs text-ink-dim pt-1">
            <span>Role: <b className="capitalize text-brand">{profile?.role.replace('_', ' ')}</b></span>
            {user?.email && <span>{user.email}</span>}
          </div>
          <button disabled={busy} className="btn btn-gold text-xs">
            Save Name
          </button>
        </form>

        {/* Change Password */}
        <form onSubmit={handleChangePassword} className="surface-card p-5 space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Security & Password</h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">
                Current Password
              </label>
              <input
                required
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="inp text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-ink-muted mb-1">
                New Password (8+ characters)
              </label>
              <input
                required
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="inp text-sm"
              />
            </div>
          </div>
          <button disabled={busy} className="btn btn-gold text-xs">
            Update Password
          </button>
        </form>

        {/* Preferences: Language & Calendar */}
        <Prefs />

        {/* Sign Out Everywhere */}
        <div className="surface-card p-5 space-y-2">
          <h2 className="font-display text-base font-bold text-ink">Device Sessions</h2>
          <p className="text-xs text-ink-muted">
            Revoke all active logins and refresh tokens across all mobile and desktop devices.
          </p>
          <button
            onClick={async () => {
              await sb.auth.signOut({ scope: 'global' })
              router.replace('/login')
            }}
            className="btn btn-secondary text-xs text-ink-muted hover:border-bad/40 hover:text-bad"
          >
            Sign Out on All Devices
          </button>
        </div>

        {/* Danger Zone for Owners */}
        {profile?.role === 'admin' && (
          <form
            onSubmit={handleDeleteZone}
            className="rounded-2xl border border-bad/40 bg-bad/5 p-5 space-y-3"
          >
            <h2 className="font-display text-base font-bold text-bad">Zone Danger Zone</h2>
            <p className="text-xs text-ink-muted leading-relaxed">
              Permanently suspends this game zone and deactivates all employee accounts. Make sure to export your financial reports first.
            </p>
            <div className="space-y-2">
              <input
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder="Type DELETE to confirm"
                className="inp text-xs border-bad/40"
              />
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Your account password"
                className="inp text-xs border-bad/40"
              />
            </div>
            <button className="btn bg-bad text-white text-xs hover:bg-bad/80 font-bold w-full">
              Close & Deactivate Game Zone
            </button>
          </form>
        )}
      </div>
    </AppLayout>
  )
}
