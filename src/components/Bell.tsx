'use client'
import ActionButton from '@/components/ActionButton'

import { useCallback, useEffect, useState } from 'react'
import { sb } from '@/lib/supabase'

interface NotificationItem {
  id: string
  title: string
  body: string | null
  read_at: string | null
  created_at: string
}

export default function Bell() {
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const [perm, setPerm] = useState('default')

  const load = useCallback(async () => {
    const { data } = await sb
      .from('notifications')
      .select('id,title,body,read_at,created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setNotifications((data as NotificationItem[]) || [])
  }, [])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      setPerm(Notification.permission)
    }

    let cancelled = false
    let channel: ReturnType<typeof sb.channel> | null = null

    const subscribeToNotifications = async () => {
      const { data: { user } } = await sb.auth.getUser()
      if (!user || cancelled) return

      await load()
      if (cancelled) return

      const topic = `user-notifications:${user.id}`
      const staleChannel = sb.getChannels().find((candidate) => candidate.topic === `realtime:${topic}`)
      if (staleChannel) await sb.removeChannel(staleChannel)
      if (cancelled) return

      const nextChannel = sb.channel(topic)
      channel = nextChannel
      nextChannel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const newItem = payload.new as NotificationItem
            setNotifications((prev) => [newItem, ...prev])
            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification(newItem.title, {
                body: newItem.body ?? '',
                icon: '/logo.png',
              })
            }
          }
        )
        .subscribe()
    }

    void subscribeToNotifications()

    return () => {
      cancelled = true
      if (channel) void sb.removeChannel(channel)
    }
  }, [load])

  const unreadCount = notifications.filter((x) => !x.read_at).length

  const markAllRead = async () => {
    await sb
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .is('read_at', null)
    load()
  }

  const requestPhoneAlerts = async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const res = await Notification.requestPermission()
      setPerm(res)
    }
  }

  return (
    <div className="relative inline-block">
      <ActionButton
        aria-label={`Notifications, ${unreadCount} unread`}
        onClick={() => setOpen(!open)}
        className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface hover:border-brand/50 text-ink transition-colors"
      >
        <span className="text-base">🔔</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-bg shadow-glow-sm animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </ActionButton>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-h-96 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-line p-3.5 bg-surface-elevated/50">
            <h3 className="font-display text-sm font-bold text-ink">Notifications</h3>
            {unreadCount > 0 && (
              <ActionButton
                onClick={markAllRead}
                className="text-xs font-semibold text-brand hover:underline"
              >
                Mark all read
              </ActionButton>
            )}
          </div>

          {/* List */}
          <div className="max-h-72 overflow-y-auto divide-y divide-line/60">
            {notifications.map((item) => (
              <div
                key={item.id}
                className={`p-3.5 text-xs transition-colors hover:bg-surface-elevated ${!item.read_at ? 'bg-surface-elevated/40' : ''
                  }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className={`font-semibold text-ink ${!item.read_at ? 'text-brand' : ''}`}>
                    {item.title}
                  </p>
                  {!item.read_at && (
                    <span className="h-1.5 w-1.5 rounded-full bg-brand shrink-0 mt-1" />
                  )}
                </div>
                {item.body && <p className="mt-1 text-ink/70 leading-relaxed">{item.body}</p>}
                <p className="mt-1.5 text-[10px] text-ink/40">
                  {new Date(item.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            ))}

            {notifications.length === 0 && (
              <div className="p-8 text-center text-xs text-ink/50">
                <span>No alerts yet. Everything is quiet.</span>
              </div>
            )}
          </div>

          {/* Footer */}
          {typeof window !== 'undefined' && 'Notification' in window && perm === 'default' && (
            <div className="border-t border-line p-2 text-center bg-surface-elevated/40">
              <ActionButton
                onClick={requestPhoneAlerts}
                className="text-xs font-bold text-brand hover:underline"
              >
                Enable browser alerts
              </ActionButton>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
