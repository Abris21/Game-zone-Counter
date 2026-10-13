'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'

export const NAVIGATION_START_EVENT = 'gz:navigation-start'

export default function NavigationProgress() {
  const pathname = usePathname()
  const [navigation, setNavigation] = useState<{ from: string; target: string } | null>(null)

  useEffect(() => {
    const start = (event: Event) => {
      const nextPath = (event as CustomEvent<string>).detail
      if (nextPath && nextPath !== pathname) setNavigation({ from: pathname, target: nextPath })
    }
    window.addEventListener(NAVIGATION_START_EVENT, start)
    return () => window.removeEventListener(NAVIGATION_START_EVENT, start)
  }, [pathname])

  useEffect(() => {
    if (navigation && pathname !== navigation.from) setNavigation(null)
  }, [pathname, navigation])

  useEffect(() => {
    if (!navigation) return
    const timeout = window.setTimeout(() => setNavigation(null), 15_000)
    return () => window.clearTimeout(timeout)
  }, [navigation])

  if (!navigation) return null
  return (
    <div
      role="status"
      aria-label="Loading destination"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/90 backdrop-blur-sm"
    >
      <div className="flex flex-col items-center gap-3 text-ink-muted">
        <span className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        <span className="text-xs font-semibold">Loading screen…</span>
      </div>
    </div>
  )
}
