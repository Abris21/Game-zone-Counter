'use client'

import { useEffect, useState, useCallback } from 'react'
import { flushQueue, getQueue, clearFailedQueue, QueuedAction } from '@/lib/offline'

export default function NetBanner({ onSynced }: { onSynced: () => void }) {
  const [online, setOnline] = useState(true)
  const [pendingCount, setPendingCount] = useState(0)
  const [failedCount, setFailedCount] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [failedItems, setFailedItems] = useState<QueuedAction[]>([])
  const [showFailedDetails, setShowFailedDetails] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)

  const checkSync = useCallback(async () => {
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true
    setOnline(isOnline)

    const queue = await getQueue()
    const pending = queue.filter((x) => x.status === 'pending' || x.status === 'syncing')
    const failed = queue.filter((x) => x.status === 'failed' || x.status === 'conflict')

    setPendingCount(pending.length)
    setFailedCount(failed.length)
    setFailedItems(failed)

    if (typeof window !== 'undefined') {
      setLastSynced(localStorage.getItem('gz_last_synced'))
    }

    if (isOnline && pending.length > 0 && !syncing) {
      setSyncing(true)
      const res = await flushQueue()
      setSyncing(false)
      if (res.syncedCount > 0) {
        onSynced()
      }
      setPendingCount(res.pendingCount)
      setFailedCount(res.failedCount)
    }
  }, [onSynced, syncing])

  useEffect(() => {
    checkSync()
    const interval = setInterval(checkSync, 5000)
    window.addEventListener('online', checkSync)
    window.addEventListener('offline', checkSync)

    return () => {
      clearInterval(interval)
      window.removeEventListener('online', checkSync)
      window.removeEventListener('offline', checkSync)
    }
  }, [checkSync])

  const handleManualRetry = async () => {
    setSyncing(true)
    const res = await flushQueue()
    setSyncing(false)
    if (res.syncedCount > 0) {
      onSynced()
    }
    setPendingCount(res.pendingCount)
    setFailedCount(res.failedCount)
  }

  const handleClearFailed = async () => {
    await clearFailedQueue()
    setFailedCount(0)
    setFailedItems([])
    setShowFailedDetails(false)
  }

  if (online && pendingCount === 0 && failedCount === 0) {
    return null
  }

  return (
    <div className="mb-4 space-y-2">
      {/* Main Connection & Sync Bar */}
      <div
        role="status"
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-3.5 text-xs sm:text-sm font-medium shadow-md backdrop-blur-md transition-all ${
          !online
            ? 'border-warning/50 bg-warning/10 text-warning'
            : failedCount > 0
            ? 'border-bad/50 bg-bad/10 text-bad'
            : 'border-brand/40 bg-surface/90 text-brand'
        }`}
      >
        <div className="flex items-center gap-2.5">
          {!online ? (
            <span className="flex h-2.5 w-2.5 rounded-full bg-warning animate-pulse" />
          ) : syncing ? (
            <span className="flex h-2.5 w-2.5 rounded-full bg-brand animate-ping" />
          ) : failedCount > 0 ? (
            <span className="flex h-2.5 w-2.5 rounded-full bg-bad" />
          ) : (
            <span className="flex h-2.5 w-2.5 rounded-full bg-ok" />
          )}

          <div>
            {!online && (
              <p>
                <b>Offline Mode:</b> Session counting and ending will save locally. {pendingCount} action(s) queued.
              </p>
            )}
            {online && syncing && (
              <p>
                <b>Synchronizing:</b> Syncing {pendingCount} saved action(s) to server…
              </p>
            )}
            {online && !syncing && failedCount > 0 && (
              <p>
                <b>Sync Alert:</b> {failedCount} action(s) encountered conflict or could not be verified.
              </p>
            )}
            {online && !syncing && pendingCount > 0 && failedCount === 0 && (
              <p>
                {pendingCount} action(s) waiting for server sync.
              </p>
            )}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          {failedCount > 0 && (
            <>
              <button
                onClick={() => setShowFailedDetails(!showFailedDetails)}
                className="underline hover:text-ink transition-colors font-semibold"
              >
                {showFailedDetails ? 'Hide details' : 'Review'}
              </button>
              <button
                onClick={handleClearFailed}
                className="rounded-lg border border-bad/40 px-2 py-1 text-xs hover:bg-bad/20 transition-colors"
              >
                Dismiss
              </button>
            </>
          )}

          {online && (pendingCount > 0 || failedCount > 0) && (
            <button
              onClick={handleManualRetry}
              disabled={syncing}
              className="rounded-lg bg-brand px-2.5 py-1 text-xs font-bold text-bg hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Retry now'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded conflict / failure details drawer */}
      {showFailedDetails && failedItems.length > 0 && (
        <div className="rounded-xl border border-bad/40 bg-surface p-3 text-xs space-y-2">
          <p className="font-bold text-ink">Conflicted or Failed Operations:</p>
          <div className="max-h-40 overflow-y-auto space-y-1.5 divide-y divide-line">
            {failedItems.map((item) => (
              <div key={item.id} className="pt-1.5 flex justify-between items-center text-ink-muted">
                <div>
                  <p className="font-semibold text-ink capitalize">{item.fn.replace(/_/g, ' ')}</p>
                  <p className="text-[11px] text-bad">{item.lastError || 'Server rejected changes'}</p>
                </div>
                <span className="text-[10px] text-ink/40">
                  {new Date(item.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
