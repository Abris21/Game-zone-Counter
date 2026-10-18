'use client'
import ActionButton from '@/components/ActionButton'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useRouter } from 'next/navigation'
import { sb } from '@/lib/supabase'
import { Profile, GameZone } from '@/lib/auth'
import { PlayStationSymbolsRow, ControllerIcon, TrophyIcon } from './PlayStationIcons'
import Bell from './Bell'
import { useI18n, useT } from '@/lib/i18n'
import NetBanner from './NetBanner'
import ThemeToggle from './ThemeToggle'
import { NAVIGATION_START_EVENT } from './NavigationProgress'

/** Compact connectivity badge shown in the header bar (spec requirement 4.1) */
function ConnectivityBadge() {
  const [status, setStatus] = useState<'online' | 'offline' | 'syncing'>('online')

  useEffect(() => {
    function update() {
      setStatus(navigator.onLine ? 'online' : 'offline')
    }
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    // Listen for sync-pending custom events from NetBanner / offline queue
    const onSync = () => setStatus('syncing')
    const onSynced = () => setStatus(navigator.onLine ? 'online' : 'offline')
    window.addEventListener('gz-sync-pending', onSync)
    window.addEventListener('gz-sync-done', onSynced)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
      window.removeEventListener('gz-sync-pending', onSync)
      window.removeEventListener('gz-sync-done', onSynced)
    }
  }, [])

  const dot = status === 'online' ? 'bg-ok animate-pulse' :
    status === 'syncing' ? 'bg-warning animate-pulse' : 'bg-bad'
  const label = status === 'online' ? 'Online' : status === 'syncing' ? 'Sync Pending' : 'Offline'
  const cls = status === 'online' ? 'badge-online' :
    status === 'syncing' ? 'badge-online badge-syncing' : 'badge-online badge-offline'

  return (
    <span id="connectivity-badge" className={cls}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

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
    { href: '/account', label: 'Account', icon: '👤' },
  ]

  const superAdminLinks = [
    { href: '/super', label: 'Game Zones', icon: '🏢' },
    { href: '/audit', label: 'Audit Log', icon: '🛡️' },
    { href: '/account', label: 'Account', icon: '👤' },
  ]

  const links =
    role === 'super_admin' ? superAdminLinks : role === 'admin' ? adminLinks : employeeLinks

  // Prime every destination in the current user's menu while the current
  // screen is open, so a click can transition without waiting to fetch route code.
  useEffect(() => {
    links.forEach(({ href }) => router.prefetch(href))
  }, [role, router])

  useEffect(() => {
    const refreshScopedData = () => onRefresh?.()
    window.addEventListener('gz-snapshot-scope-ready', refreshScopedData)
    return () => window.removeEventListener('gz-snapshot-scope-ready', refreshScopedData)
  }, [onRefresh])

  const handleSignOut = async () => {
    await sb.auth.signOut()
    router.replace('/login')
  }

  const startNavigation = (href: string) => {
    window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: href }))
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:border-r lg:border-line lg:bg-surface/90 lg:backdrop-blur-md">
        {/* Brand header */}
        <div className="flex flex-col gap-2 p-5 border-b border-line">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-line bg-[#080B11] shadow-glow-sm">
                <Image src="/logo.png" alt="Gamezone Counter" fill sizes="40px" className="object-cover" priority />
              </div>
              <div>
                <h2 className="font-display text-base font-extrabold tracking-tight text-ink leading-tight">
                  GAMEZONE
                </h2>
                <p className="text-[10px] uppercase font-bold tracking-widest text-brand">
                  Counter
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
                prefetch
                onMouseEnter={() => router.prefetch(item.href)}
                onClick={() => startNavigation(item.href)}
                className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all ${active
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
            <ActionButton
              onClick={() => setLang(lang === 'am' ? 'en' : 'am')}
              className="rounded-lg border border-line bg-surface-elevated px-2 py-1 text-xs font-bold text-ink hover:border-brand transition-colors"
              title="Switch language"
            >
              {lang === 'am' ? 'EN' : 'አማ'}
            </ActionButton>
          </div>

          <ActionButton
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-elevated/60 py-2 text-xs font-semibold text-ink-muted hover:border-bad/40 hover:text-bad transition-colors"
          >
            <span>🚪</span>
            <span>{t('Sign out')}</span>
          </ActionButton>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-6">
        {/* Top Header */}
        <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center justify-between gap-2 border-b border-line bg-bg/90 px-4 py-2 backdrop-blur-md lg:px-8">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            {/* Mobile menu button */}
            <ActionButton
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink lg:hidden"
              aria-label="Toggle navigation menu"
            >
              <span className="text-lg">☰</span>
            </ActionButton>

            <div className="min-w-0">
              {zone?.name && role === 'admin' && (
                <p className="max-w-[45vw] truncate text-[10px] font-bold uppercase tracking-wider text-brand sm:max-w-none">
                  {zone.name}
                </p>
              )}
              <h1 className="truncate font-display text-lg font-bold leading-tight text-ink sm:text-2xl">
                {title}
              </h1>
              {subtitle && <p className="hidden truncate text-xs text-ink-muted sm:block">{subtitle}</p>}
            </div>
          </div>

          {/* Right header controls */}
          <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-3">
            {/* Connectivity badge — spec requirement 4.1 */}
            <div className="hidden sm:block"><ConnectivityBadge /></div>
            <Bell />
            {/* Theme toggle — spec requirement 4.4 */}
            <ThemeToggle compact />
            <ActionButton
              onClick={() => setLang(lang === 'am' ? 'en' : 'am')}
              className="lg:hidden rounded-xl border border-line bg-surface px-2.5 py-1.5 text-xs font-bold text-brand"
            >
              {lang === 'am' ? 'EN' : 'አማ'}
            </ActionButton>
          </div>
          {action && (
            <div className="order-3 flex w-full items-center justify-end sm:order-none sm:ml-2 sm:w-auto">
              {action}
            </div>
          )}
        </header>

        {/* Mobile slide-down navigation drawer */}
        {mobileMenuOpen && (
          <div className="border-b border-line bg-surface p-4 lg:hidden animate-in slide-in-from-top-2">
            <nav className="grid grid-cols-2 gap-2">
              {links.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch
                  onTouchStart={() => router.prefetch(item.href)}
                  onClick={() => {
                    startNavigation(item.href)
                    setMobileMenuOpen(false)
                  }}
                  className={`flex items-center gap-2 rounded-xl p-3 text-sm font-semibold ${pathname === item.href
                    ? 'bg-brand/20 border border-brand/50 text-brand'
                    : 'border border-line bg-surface-elevated text-ink'
                    }`}
                >
                  <span>{item.icon}</span>
                  <span className="truncate">{item.label}</span>
                </Link>
              ))}
            </nav>
            <ActionButton
              onClick={handleSignOut}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-bad/30 bg-bad/10 py-2.5 text-xs font-bold text-bad"
            >
              <span>🚪</span>
              <span>{t('Sign out')}</span>
            </ActionButton>
          </div>
        )}

        {/* Page body */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-6xl w-full mx-auto">
          <NetBanner
            onSynced={() => onRefresh?.()}
            userId={profile?.id}
            zoneId={profile?.zone_id}
          />
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation Bar (Ultra-responsive for mobile phone counters) */}
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-40 flex h-[calc(4rem+env(safe-area-inset-bottom))] items-center justify-around border-t border-line bg-surface/95 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden"
      >
        {(role === 'employee'
          ? [
            { href: '/counter', label: t('Today'), icon: '🎮' },
            { href: '/counter/day', label: t('My day'), icon: '📊' },
            { href: '/tournaments', label: 'Brackets', icon: '🏆' },
            { href: '/account', label: t('Account'), icon: '👤' },
          ]
          : role === 'super_admin'
            ? superAdminLinks
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
              prefetch
              onTouchStart={() => router.prefetch(item.href)}
              onClick={() => startNavigation(item.href)}
              className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1 px-1 text-xs font-semibold transition-colors ${active ? 'text-brand' : 'text-ink-muted hover:text-ink'
                }`}
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="max-w-full truncate text-[10px] tracking-tight">{item.label}</span>
              {active && <span className="h-1 w-3 rounded-full bg-brand" />}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
