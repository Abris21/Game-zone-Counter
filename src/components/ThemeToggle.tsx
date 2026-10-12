'use client'

import React, { useEffect, useState } from 'react'

/** Reads the persisted theme. Defaults to 'dark' to match spec. */
function getStoredTheme(): 'dark' | 'light' {
  if (typeof window === 'undefined') return 'dark'
  try {
    return (localStorage.getItem('gz-theme') as 'dark' | 'light') || 'dark'
  } catch {
    return 'dark'
  }
}

/** Applies the theme class to <html> and saves the preference. */
function applyTheme(theme: 'dark' | 'light') {
  const root = document.documentElement
  root.classList.remove('dark', 'light')
  root.classList.add(theme)
  try {
    localStorage.setItem('gz-theme', theme)
  } catch {
    // ignore
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const stored = getStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setThemeState(next)
  }

  return { theme, toggleTheme }
}

interface ThemeToggleProps {
  /** Render as icon-only compact button (for header) or with label */
  compact?: boolean
}

export default function ThemeToggle({ compact = true }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      id="theme-toggle"
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      onClick={toggleTheme}
      className={`
        flex items-center justify-center rounded-xl border border-line bg-surface transition-all
        hover:border-brand/50 hover:bg-surface-elevated active:scale-95
        ${compact ? 'h-9 w-9 text-base' : 'h-9 gap-1.5 px-3 text-xs font-semibold'}
      `}
    >
      {theme === 'dark' ? (
        <>
          <span aria-hidden>☀️</span>
          {!compact && <span className="text-ink-muted">Light</span>}
        </>
      ) : (
        <>
          <span aria-hidden>🌙</span>
          {!compact && <span className="text-ink-muted">Dark</span>}
        </>
      )}
    </button>
  )
}
