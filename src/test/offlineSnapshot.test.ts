import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeOrQueue, getLocalSnapshot, getQueue, setLocalSnapshot, setLocalSnapshotScope } from '../lib/offline'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
let storage: Map<string, string>

beforeEach(() => {
    storage = new Map()
    Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { dispatchEvent: () => true },
    })
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        },
    })
    setLocalSnapshotScope(null)
})

afterEach(() => {
    setLocalSnapshotScope(null)
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('account-scoped local snapshots', () => {
    it('does not expose one user or zone snapshot to another', () => {
        setLocalSnapshotScope('user-a', 'zone-a')
        setLocalSnapshot('sessions', [{ id: 'session-a' }])

        setLocalSnapshotScope('user-b', 'zone-b')
        expect(getLocalSnapshot('sessions').data).toBeNull()
        setLocalSnapshot('sessions', [{ id: 'session-b' }])

        setLocalSnapshotScope('user-a', 'zone-a')
        expect(getLocalSnapshot('sessions').data).toEqual([{ id: 'session-a' }])
        setLocalSnapshotScope('user-b', 'zone-b')
        expect(getLocalSnapshot('sessions').data).toEqual([{ id: 'session-b' }])
    })

    it('does not read or write snapshots before an account is verified', () => {
        setLocalSnapshot('sessions', [{ id: 'unverified' }])
        expect(getLocalSnapshot('sessions').data).toBeNull()
        expect(storage.size).toBe(0)
    })

    it('returns queued actions only for the signed-in user and zone', async () => {
        storage.set('gz_idb_fallback_queue', JSON.stringify([
            { id: 'a', userId: 'user-a', zoneId: 'zone-a' },
            { id: 'b', userId: 'user-b', zoneId: 'zone-b' },
            { id: 'c', userId: 'user-a', zoneId: 'zone-c' },
        ]))

        const queue = await getQueue('user-a', 'zone-a')
        expect(queue.map((item) => item.id)).toEqual(['a'])
    })

    it('keeps an offline start ahead of counter increments for its session', async () => {
        await executeOrQueue('start_session', {
            p_station: 'station-a',
            p_session_id: 'session-a',
        }, { userId: 'user-a', zoneId: 'zone-a' })
        await executeOrQueue('adjust_session', {
            p_session: 'session-a',
            p_delta: 1,
            p_event: 'event-a',
        }, { userId: 'user-a', zoneId: 'zone-a' })

        const queue = await getQueue('user-a', 'zone-a')
        expect(queue.map((item) => item.fn)).toEqual(['start_session', 'adjust_session'])
        expect(queue[0].args.p_session_id).toBe(queue[1].args.p_session)
    })
})