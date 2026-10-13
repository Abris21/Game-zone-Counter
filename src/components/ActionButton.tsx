'use client'

import React, { useEffect, useRef, useState } from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  feedbackMs?: number
  onError?: (error: unknown) => void
}

export default function ActionButton({
  children,
  disabled = false,
  loading = false,
  feedbackMs = 260,
  onClick,
  type,
  onError,
  ...props
}: Props) {
  const [pending, setPending] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const waitingForPromise = useRef(false)
  const busy = pending || loading
  const buttonType = type ?? (onClick ? 'button' : 'submit')

  useEffect(() => {
    if (disabled && pending && timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    } else if (!disabled && pending && !timer.current && !waitingForPromise.current) {
      setPending(false)
    }
  }, [disabled, pending])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const handleClick: React.MouseEventHandler<HTMLButtonElement> = (event) => {
    if (disabled || loading || pending) {
      event.preventDefault()
      return
    }

    if (buttonType === 'submit' && !onClick) {
      // Let the browser dispatch the form submit before disabling its submitter.
      timer.current = setTimeout(() => {
        setPending(true)
        timer.current = setTimeout(() => {
          timer.current = null
          setPending(false)
        }, 1200)
      }, 0)
      return
    }

    setPending(true)
    try {
      const result = onClick?.(event) as unknown
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        waitingForPromise.current = true
        Promise.resolve(result).then(
          () => {
            waitingForPromise.current = false
            setPending(false)
          },
          (error: unknown) => {
            waitingForPromise.current = false
            setPending(false)
            onError?.(error)
            if (!onError) console.error('Button action failed:', error)
          }
        )
      } else {
        timer.current = setTimeout(() => {
          timer.current = null
          setPending(false)
        }, feedbackMs)
      }
    } catch (error) {
      setPending(false)
      onError?.(error)
      if (!onError) console.error('Button action failed:', error)
    }
  }

  return (
    <button
      {...props}
      type={buttonType}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
    >
      {busy && (
        <span
          aria-hidden="true"
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      )}
      {children}
    </button>
  )
}
