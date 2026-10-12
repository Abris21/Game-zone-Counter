'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { sb } from '@/lib/supabase'
import { Profile, GameZone } from '@/lib/auth'
import { PlayStationSymbolsRow, ControllerIcon, TrophyIcon } from './PlayStationIcons'
import Bell from './Bell'
import { useI18n, useT } from '@/lib/i18n'
import NetBanner from './NetBanner'

interface AppLayoutProps {
  children: React.ReactNode
  profile?: Profile | null
  zone?: GameZone | null
  title?: string
  subtitle?: string
  action?: React.ReactNode
  onRefresh?: () => void
}

export default function AppLayout({
  children,
  profile,
  zone,
  title,
  subtitle,
  action,
  onRefresh,
}: AppLayoutProps) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useT()
  const { lang, setLang } = useI18n()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const role = profile?.role || 'employee'

  const employeeLinks = [
    { href: '/counter', label: t('Today'), icon: '🎮' },
    { href: '/counter/day', label: t('My day'), icon: '📊' },
    { href: '/tournaments', label: 'Tournaments', icon: '🏆' },
    { href: '/account', label: t('Account'), icon: '👤' },
  ]

  const adminLinks = [
    { href: '/monitor', label: 'Live Floor', icon: '🎮' },
    { href: '/tournaments', label: 'Tournaments', icon: '🏆' },
    { href: '/finance', label: 'Finance & P&L', icon: '💰' },
    { href: '/inventory', label: 'Inventory & Snacks', icon: '🍿' },
    { href: '/manage', label: 'Units & Staff', icon: '👥' },
    { href: '/history', label: 'History & Voids', icon: '📜' },
    { href: '/settings', label: 'Zone Rules', icon: '⚙️' },
    { href: '/audit', label: 'Audit Log', icon: '🛡️' },
    { href: '/account', label: 'Account', icon: '👤' },
  ]

  const superAdminLinks = [
    { href: '/super', label: 'Game Zones', icon: '🏢' },
    { href: '/account', label: 'Account', icon: '👤' },
  ]

  const links =
    role === 'super_admin' ? superAdminLinks : role === 'admin' ? adminLinks : employeeLinks

  const handleSignOut = async () => {
    await sb.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-line lg:bg-surface/90 lg:backdrop-blur-md">
        {/* Brand header */}
        <div className="flex flex-col gap-2 p-5 border-b border-line">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand via-amber-400 to-yellow-600 text-bg shadow-glow-sm font-bold text-lg">
                B
              </div>
              <div>
                <h2 className="font-display text-base font-extrabold tracking-tight text-ink leading-tight">
                  BLACKOUT
                </h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-brand">
                  Game Zone
                </p>
              </div>
            </div>
            <PlayStationSymbolsRow />
          </div>

          {zone?.name && (
            <div className="mt-1 flex items-center justify-between rounded-lg bg-bg/60 px-2.5 py-1.5 border border-line/60 text-xs">
              <span className="font-medium text-ink/80 truncate max-w-[130px]">{zone.name}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-ok">
                <span className="h-1.5 w-1.5 rounded-full bg-ok animate-pulse" />
                Live
              </span>
            </div>
          )}
        </div>

        {/* Navigation list */}
        <nav className="flex-1 space-y-1.5 p-3 overflow-y-auto">
          {links.map((item) => {
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${
                  active
                    ? 'bg-gradient-to-r from-brand/20 to-brand/5 border border-brand/40 text-brand shadow-glow-sm'
                    : 'text-ink-muted hover:bg-surface-elevated hover:text-ink'
                }`}
              >
                <span className="text-base">{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* User profile footer */}
        <div className="border-t border-line p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="truncate">
              <p className="text-xs font-bold text-ink truncate">
                {profile?.full_name || 'Active User'}
              </p>
              <p className="text-[11px] capitalize text-brand font-medium">
                {role.replace('_', ' ')}
              </p>
            </div>
            <button
              onClick={() => setLang(lang === 'am' ? 'en' : 'am')}
              className="rounded-lg border border-line bg-surface-elevated px-2 py-1 text-xs font-bold text-ink hover:border-brand transition-colors"
              title="Switch language"
            >
              {lang === 'am' ? 'EN' : 'አማ'}
            </button>
          </div>

          <button
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-elevated/60 py-2 text-xs font-semibold text-ink-muted hover:border-bad/40 hover:text-bad transition-colors"
          >
            <span>🚪</span>
            <span>{t('Sign out')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-6">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-bg/90 px-4 backdrop-blur-md lg:px-8">
          <div className="flex items-center gap-3">
            {/* Mobile menu button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink lg:hidden"
              aria-label="Toggle navigation menu"
            >
              <span className="text-lg">☰</span>
            </button>

            <div>
              <h1 className="font-display text-lg font-bold sm:text-2xl text-ink leading-tight">
                {title}
              </h1>
              {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
            </div>
          </div>

          {/* Right header controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            {action}
            <Bell />
            <button
              onClick={() => setLang(lang === 'am' ? 'en' : 'am')}
              className="lg:hidden rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-brand"
            >
              {lang === 'am' ? 'EN' : 'አማ'}
            </button>
          </div>
        </header>

        {/* Mobile slide-down navigation drawer */}
        {mobileMenuOpen && (
          <div className="border-b border-line bg-surface p-4 lg:hidden animate-in slide-in-from-top-2">
            <nav className="grid grid-cols-2 gap-2">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${
                    pathname === item.href
                      ? 'bg-brand/20 border border-brand/50 text-brand'
                      : 'border border-line bg-surface-elevated text-ink'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </nav>
            <button
              onClick={handleSignOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-bad/30 bg-bad/10 py-2.5 text-xs font-bold text-bad"
            >
              <span>🚪</span>
              <span>{t('Sign out')}</span>
            </button>
          </div>
        )}

        {/* Page body */}
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-6xl w-full mx-auto">
          <NetBanner onSynced={() => onRefresh?.()} />
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Ultra-responsive for mobile phone counters) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-line bg-surface/95 px-2 backdrop-blur-lg lg:hidden"
      >
        {(role === 'employee'
          ? [
              { href: '/counter', label: t('Today'), icon: '🎮' },
              { href: '/counter/day', label: t('My day'), icon: '📊' },
              { href: '/tournaments', label: 'Brackets', icon: '🏆' },
              { href: '/account', label: t('Account'), icon: '👤' },
            ]
          : [
              { href: '/monitor', label: 'Floor', icon: '🎮' },
              { href: '/tournaments', label: 'Tournaments', icon: '🏆' },
              { href: '/finance', label: 'Finance', icon: '💰' },
              { href: '/inventory', label: 'Snacks', icon: '🍿' },
              { href: '/manage', label: 'Staff', icon: '👥' },
            ]
        ).map((item) => {
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center justify-center gap-0.5 py-1 px-2 text-xs font-semibold transition-colors ${
                active ? 'text-brand' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="text-[10px] tracking-tight truncate">{item.label}</span>
              {active && <span className="h-1 w-3 rounded-full bg-brand" />}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
