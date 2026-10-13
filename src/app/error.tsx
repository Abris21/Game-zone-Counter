'use client'

import { useEffect } from 'react'
import ActionButton from '@/components/ActionButton'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Application route error:', error)
  }, [error])

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8 text-ink">
      <section role="alert" className="surface-card w-full max-w-md space-y-4 p-6 text-center">
        <h1 className="font-display text-xl font-bold">This page hit a problem</h1>
        <p className="text-sm text-ink-muted">
          Try loading the page again. If the problem continues, contact your zone administrator.
        </p>
        {error.digest && <p className="text-[11px] text-ink-dim">Reference: {error.digest}</p>}
        <ActionButton type="button" onClick={reset} className="btn btn-gold min-h-11 w-full">
          Try again
        </ActionButton>
      </section>
    </main>
  )
}
