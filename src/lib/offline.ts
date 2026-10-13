/**
 * Durable Offline Engine for Blackout Game Zone Counter.
 * Uses IndexedDB (with localStorage fallback) for persistent offline action queueing.
 * Includes unique idempotency keys, retry backoff, conflict detection, and audit states.
 */

import { sb } from './supabase'

export type ActionFunction =
  | 'start_session'
  | 'adjust_session'
  | 'pause_session'
  | 'resume_session'
  | 'apply_fifa_rule'
  | 'end_session_idempotent'
  | 'add_sale_idempotent'

export interface QueuedAction {
  id: string // unique idempotency key UUID
  userId: string
  zoneId: string
  fn: ActionFunction
  args: Record<string, unknown>
  targetId?: string // session or station ID
  description?: string
  createdAt: number
  retries: number
  status: 'pending' | 'syncing' | 'failed' | 'conflict'
  lastError?: string
}

const DB_NAME = 'gz_offline_db'
const DB_VERSION = 1
const STORE_QUEUE = 'action_queue'
const STORE_CACHE = 'local_cache'

const LS_QUEUE_KEY = 'gz_idb_fallback_queue'
const LS_CACHE_KEY = 'gz_idb_fallback_cache'
let localSnapshotScope: string | null = null
let lastQueuedAt = 0
let queueWriteChain: Promise<void> = Promise.resolve()

async function enqueueAction(item: Omit<QueuedAction, 'createdAt'>): Promise<void> {
  const write = queueWriteChain.then(async () => {
    const existing = await getQueue()
    const createdAt = Math.max(
      Date.now(),
      lastQueuedAt + 1,
      ...existing.map((queued) => queued.createdAt + 1)
    )
    lastQueuedAt = createdAt
    await saveQueueItem({ ...item, createdAt })
  })
  queueWriteChain = write.catch(() => undefined)
  return write
}

export function setLocalSnapshotScope(userId?: string | null, zoneId?: string | null): void {
  const nextScope = userId ? `${userId}:${zoneId || ''}` : null
  if (nextScope === localSnapshotScope) return
  localSnapshotScope = nextScope
  if (nextScope && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('gz-snapshot-scope-ready'))
  }
}

function scopedSnapshotKey(key: string): string | null {
  return localSnapshotScope
    ? `gz_snap_scope_${encodeURIComponent(localSnapshotScope)}_${key}`
    : null
}

const isNetworkError = (msg?: string) =>
  /fetch|network|load failed|offline|timeout|socket hang up/i.test(msg || '')

const isPermanentError = (msg?: string) =>
  /NOT_ALLOWED|COUNT_OUT_OF_RANGE|OUT_OF_STOCK|INVALID_INPUT/i.test(msg || '')

/**
 * Open IndexedDB connection with fallback handling.
 */
function openDB(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = (e) => {
        const db = (e.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_QUEUE)) {
          db.createObjectStore(STORE_QUEUE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(STORE_CACHE)) {
          db.createObjectStore(STORE_CACHE, { keyPath: 'key' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Reads all queued actions from storage.
 */
export async function getQueue(userId?: string, zoneId?: string | null): Promise<QueuedAction[]> {
  const db = await openDB()
  let queue: QueuedAction[]
  if (!db) {
    try {
      queue = JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || '[]')
    } catch {
      queue = []
    }
  } else {
    queue = await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_QUEUE, 'readonly')
        const store = tx.objectStore(STORE_QUEUE)
        const req = store.getAll()
        req.onsuccess = () => resolve((req.result as QueuedAction[]) || [])
        req.onerror = () => resolve([])
      } catch {
        resolve([])
      }
    })
  }

  return (userId === undefined
    ? queue
    : queue.filter((item) => item.userId === userId && (!zoneId || item.zoneId === zoneId)))
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/**
 * Writes or updates an action in the queue.
 */
export async function saveQueueItem(item: QueuedAction): Promise<void> {
  const db = await openDB()
  if (!db) {
    try {
      const queue = (await getQueue()).filter(x => x.id !== item.id)
      queue.push(item)
      localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(queue))
    } catch { }
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_QUEUE, 'readwrite')
      const store = tx.objectStore(STORE_QUEUE)
      store.put(item)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Removes an action from the queue.
 */
export async function removeQueueItem(id: string): Promise<void> {
  const db = await openDB()
  if (!db) {
    try {
      const queue = (await getQueue()).filter(x => x.id !== id)
      localStorage.setItem(LS_QUEUE_KEY, JSON.stringify(queue))
    } catch { }
    return
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_QUEUE, 'readwrite')
      const store = tx.objectStore(STORE_QUEUE)
      store.delete(id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Clears all permanently failed/conflict actions.
 */
export async function clearFailedQueue(userId: string, zoneId: string): Promise<void> {
  const all = await getQueue(userId, zoneId)
  for (const item of all) {
    if (item.status === 'failed' || item.status === 'conflict') {
      await removeQueueItem(item.id)
    }
  }
}

/**
 * Executes an operation online or enqueues it if offline.
 */
export async function executeOrQueue(
  fn: ActionFunction,
  args: Record<string, unknown>,
  options: {
    userId?: string
    zoneId?: string
    targetId?: string
    description?: string
  } = {}
): Promise<{ error: { message: string } | null; queued?: boolean; data?: unknown }> {
  const idempotencyKey = String(args.p_idempotency_key || args.p_event || crypto.randomUUID())

  // Only RPCs that declare this parameter should receive it. Other operations
  // (such as adjust_session) have their own event-level idempotency arguments.
  const acceptsIdempotencyKey =
    fn === 'start_session' || fn === 'end_session_idempotent' || fn === 'add_sale_idempotent'
  const enrichedArgs = acceptsIdempotencyKey
    ? { ...args, p_idempotency_key: idempotencyKey }
    : args

  const isOnline = typeof navigator === 'undefined' || navigator.onLine

  if (!isOnline) {
    if (!options.userId || !options.zoneId) {
      return { error: { message: 'NOT_ALLOWED' }, queued: false }
    }
    await enqueueAction({
      id: idempotencyKey,
      userId: options.userId || '',
      zoneId: options.zoneId || '',
      fn,
      args: enrichedArgs,
      targetId: options.targetId,
      description: options.description || fn,
      retries: 0,
      status: 'pending',
    })
    return { error: null, queued: true }
  }

  // Attempt online execution
  const { data, error } = await sb.rpc(fn, enrichedArgs)

  if (error && isNetworkError(error.message)) {
    if (!options.userId || !options.zoneId) {
      return { error: { message: 'NOT_ALLOWED' }, queued: false }
    }
    await enqueueAction({
      id: idempotencyKey,
      userId: options.userId || '',
      zoneId: options.zoneId || '',
      fn,
      args: enrichedArgs,
      targetId: options.targetId,
      description: options.description || fn,
      retries: 0,
      status: 'pending',
      lastError: error.message,
    })
    return { error: null, queued: true }
  }

  return { error: error ? { message: error.message } : null, queued: false, data }
}

/**
 * Flushes all pending queued actions with backoff and status tracking.
 */
export async function flushQueue(
  userId?: string,
  zoneId?: string | null,
  retryConflicts: boolean | 'unit_busy' = false
): Promise<{
  pendingCount: number
  failedCount: number
  syncedCount: number
}> {
  if (!userId || !zoneId) return { pendingCount: 0, failedCount: 0, syncedCount: 0 }

  const queue = await getQueue(userId, zoneId)
  const counts = (items: QueuedAction[]) => ({
    pendingCount: items.filter((item) => item.status === 'pending').length,
    failedCount: items.filter((item) => item.status === 'failed' || item.status === 'conflict').length,
    syncedCount: 0,
  })

  if (typeof navigator !== 'undefined' && !navigator.onLine) return counts(queue)

  const { data: { user }, error: authError } = await sb.auth.getUser()
  if (authError || !user || user.id !== userId) return counts(queue)

  const { data: profile, error: profileError } = await sb
    .from('profiles')
    .select('zone_id, is_active, deleted_at')
    .eq('id', userId)
    .single()
  if (profileError || !profile?.is_active || profile.deleted_at || profile.zone_id !== zoneId) {
    return counts(queue)
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) return counts(queue)
  let synced = 0
  const blockedSessionIds = new Set<string>()
  const unitBusyStartIds = new Set<string>()
  const unitBusySessionIds = new Set<string>()
  if (retryConflicts === 'unit_busy') {
    for (const item of queue) {
      if (item.fn === 'start_session' && /UNIT_BUSY/.test(item.lastError || '')) {
        unitBusyStartIds.add(item.id)
        const offlineSessionId = String(item.args.p_session_id || '')
        if (offlineSessionId) unitBusySessionIds.add(offlineSessionId)
      }
    }
  }

  for (const item of queue) {
    const sessionId = String(item.args.p_session || '')
    if (sessionId && blockedSessionIds.has(sessionId)) {
      item.status = 'conflict'
      item.lastError = 'The queued session did not start; this action was not synced.'
      await saveQueueItem(item)
      continue
    }

    if (item.status === 'failed' || item.status === 'conflict') {
      const targetedBusyRetry = retryConflicts === 'unit_busy' && (
        unitBusyStartIds.has(item.id) ||
        (sessionId && unitBusySessionIds.has(sessionId))
      )
      if (!retryConflicts || (retryConflicts === 'unit_busy' && !targetedBusyRetry)) continue
    }

    item.status = 'syncing'
    item.lastError = undefined
    item.retries += 1
    await saveQueueItem(item)

    const { error } = await sb.rpc(item.fn, item.args)

    if (!error) {
      await removeQueueItem(item.id)
      synced += 1
    } else if (isNetworkError(error.message)) {
      // Revert status to pending and stop flushing
      item.status = 'pending'
      item.lastError = error.message
      await saveQueueItem(item)
      break
    } else if (/SESSION_ALREADY_ENDED/.test(error.message)) {
      // Benign conflict: session was already settled or closed
      await removeQueueItem(item.id)
      synced += 1
    } else if (/UNIT_BUSY/.test(error.message)) {
      item.status = 'conflict'
      item.lastError = 'UNIT_BUSY: This station already has an active session.'
      await saveQueueItem(item)

      const offlineSessionId = String(item.args.p_session_id || '')
      if (item.fn === 'start_session' && offlineSessionId) {
        blockedSessionIds.add(offlineSessionId)
        for (const dependent of queue) {
          if (dependent.args.p_session === offlineSessionId && dependent.status === 'pending') {
            dependent.status = 'conflict'
            dependent.lastError = 'The queued session did not start because the station is already in use.'
            await saveQueueItem(dependent)
          }
        }
      }
    } else if (isPermanentError(error.message) || item.retries > 5) {
      item.status = 'failed'
      item.lastError = error.message
      await saveQueueItem(item)
    } else {
      item.status = 'conflict'
      item.lastError = error.message
      await saveQueueItem(item)
    }
  }

  const remaining = await getQueue(userId, zoneId)
  const pendingCount = remaining.filter(x => x.status === 'pending').length
  const failedCount = remaining.filter(x => x.status === 'failed' || x.status === 'conflict').length

  if (typeof window !== 'undefined' && synced > 0) {
    localStorage.setItem('gz_last_synced', new Date().toISOString())
  }

  return { pendingCount, failedCount, syncedCount: synced }
}

/**
 * Local cache snapshot methods.
 */
export function setLocalSnapshot<T>(key: string, data: T): void {
  const storageKey = scopedSnapshotKey(key)
  if (typeof window === 'undefined' || !storageKey) return
  try {
    localStorage.setItem(storageKey, JSON.stringify(data))
    localStorage.setItem(`${storageKey}_time`, new Date().toISOString())
  } catch { }
}

export function getLocalSnapshot<T>(key: string): { data: T | null; timestamp: string | null } {
  const storageKey = scopedSnapshotKey(key)
  if (typeof window === 'undefined' || !storageKey) return { data: null, timestamp: null }
  try {
    const raw = localStorage.getItem(storageKey)
    const timestamp = localStorage.getItem(`${storageKey}_time`)
    return { data: raw ? JSON.parse(raw) : null, timestamp }
  } catch {
    return { data: null, timestamp: null }
  }
}
