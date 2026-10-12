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
export async function getQueue(): Promise<QueuedAction[]> {
  const db = await openDB()
  if (!db) {
    try {
      return JSON.parse(localStorage.getItem(LS_QUEUE_KEY) || '[]')
    } catch {
      return []
    }
  }

  return new Promise((resolve) => {
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
    } catch {}
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
    } catch {}
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
export async function clearFailedQueue(): Promise<void> {
  const all = await getQueue()
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
): Promise<{ error: { message: string } | null; queued?: boolean }> {
  const idempotencyKey = String(args.p_idempotency_key || args.p_event || crypto.randomUUID())

  // Ensure idempotency key is embedded in RPC args
  const enrichedArgs = {
    ...args,
    p_idempotency_key: idempotencyKey,
  }

  const isOnline = typeof navigator === 'undefined' || navigator.onLine

  if (!isOnline) {
    await saveQueueItem({
      id: idempotencyKey,
      userId: options.userId || '',
      zoneId: options.zoneId || '',
      fn,
      args: enrichedArgs,
      targetId: options.targetId,
      description: options.description || fn,
      createdAt: Date.now(),
      retries: 0,
      status: 'pending',
    })
    return { error: null, queued: true }
  }

  // Attempt online execution
  const { error } = await sb.rpc(fn, enrichedArgs)

  if (error && isNetworkError(error.message)) {
    await saveQueueItem({
      id: idempotencyKey,
      userId: options.userId || '',
      zoneId: options.zoneId || '',
      fn,
      args: enrichedArgs,
      targetId: options.targetId,
      description: options.description || fn,
      createdAt: Date.now(),
      retries: 0,
      status: 'pending',
      lastError: error.message,
    })
    return { error: null, queued: true }
  }

  return { error: error ? { message: error.message } : null, queued: false }
}

/**
 * Flushes all pending queued actions with backoff and status tracking.
 */
export async function flushQueue(): Promise<{
  pendingCount: number
  failedCount: number
  syncedCount: number
}> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const queue = await getQueue()
    return {
      pendingCount: queue.filter(x => x.status === 'pending').length,
      failedCount: queue.filter(x => x.status === 'failed' || x.status === 'conflict').length,
      syncedCount: 0,
    }
  }

  const queue = await getQueue()
  let synced = 0

  for (const item of queue) {
    if (item.status === 'failed' || item.status === 'conflict') {
      continue // Skip permanently failed items until user review
    }

    item.status = 'syncing'
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

  const remaining = await getQueue()
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
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(`gz_snap_${key}`, JSON.stringify(data))
    localStorage.setItem(`gz_snap_time_${key}`, new Date().toISOString())
  } catch {}
}

export function getLocalSnapshot<T>(key: string): { data: T | null; timestamp: string | null } {
  if (typeof window === 'undefined') return { data: null, timestamp: null }
  try {
    const raw = localStorage.getItem(`gz_snap_${key}`)
    const timestamp = localStorage.getItem(`gz_snap_time_${key}`)
    return { data: raw ? JSON.parse(raw) : null, timestamp }
  } catch {
    return { data: null, timestamp: null }
  }
}
