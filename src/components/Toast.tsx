'use client'
import ActionButton from '@/components/ActionButton'

import React, { createContext, useContext, useState, useCallback } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: string
  title?: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, title?: string) => void
  success: (message: string, title?: string) => void
  error: (message: string, title?: string) => void
  warning: (message: string, title?: string) => void
  info: (message: string, title?: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const addToast = useCallback(
    (message: string, type: ToastType = 'info', title?: string) => {
      const id = crypto.randomUUID()
      setToasts((prev) => [...prev, { id, message, type, title }])
      setTimeout(() => {
        removeToast(id)
      }, 4500)
    },
    [removeToast]
  )

  const value: ToastContextValue = {
    toast: addToast,
    success: (msg, title) => addToast(msg, 'success', title),
    error: (msg, title) => addToast(msg, 'error', title),
    warning: (msg, title) => addToast(msg, 'warning', title),
    info: (msg, title) => addToast(msg, 'info', title),
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast Overlay Container */}
      <div
        aria-live="polite"
        className="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2 px-4 sm:bottom-6 sm:left-auto sm:right-6 sm:translate-x-0 sm:px-0 max-w-sm w-full pointer-events-none"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border p-4 shadow-xl backdrop-blur-md transition-all animate-in fade-in slide-in-from-bottom-2 ${
              t.type === 'success'
                ? 'border-ok/40 bg-surface/95 text-ink'
                : t.type === 'error'
                ? 'border-bad/40 bg-surface/95 text-ink'
                : t.type === 'warning'
                ? 'border-warning/40 bg-surface/95 text-ink'
                : 'border-brand/40 bg-surface/95 text-ink'
            }`}
          >
            <div className="mt-0.5 shrink-0">
              {t.type === 'success' && <span className="text-ok text-lg">✓</span>}
              {t.type === 'error' && <span className="text-bad text-lg">✕</span>}
              {t.type === 'warning' && <span className="text-warning text-lg">⚠</span>}
              {t.type === 'info' && <span className="text-brand text-lg">ℹ</span>}
            </div>
            <div className="flex-1 text-sm">
              {t.title && <p className="font-bold text-ink">{t.title}</p>}
              <p className="text-ink/80">{t.message}</p>
            </div>
            <ActionButton
              onClick={() => removeToast(t.id)}
              className="text-xs text-ink/40 hover:text-ink transition-colors"
              aria-label="Close notification"
            >
              ✕
            </ActionButton>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    return {
      toast: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    }
  }
  return context
}
