'use client'
import ActionButton from '@/components/ActionButton'

import { useEffect, useState } from 'react'
import { sb, msg, etb } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import { executeOrQueue } from '@/lib/offline'

interface MenuItem {
  id: string
  name: string
  sell_price: number
  track_stock: boolean
  stock_qty: number
}

export default function Snacks({
  session,
  onClose,
}: {
  session: string | null
  onClose: () => void
}) {
  const t = useT()
  const [menu, setMenu] = useState<MenuItem[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.resolve(sb.rpc('menu')).then(({ data, error }) => {
      if (error) setErr(msg(error))
      else setMenu((data as MenuItem[]) || [])
    }).catch((error: unknown) =>
      setErr(msg({ message: error instanceof Error ? error.message : String(error) }))
    )
  }, [])

  const total = menu.reduce((acc, item) => acc + (quantities[item.id] || 0) * item.sell_price, 0)

  const handleSubmit = async (method: string | null) => {
    setBusy(true)
    setErr('')
    const items = Object.entries(quantities)
      .filter(([, v]) => v > 0)
      .map(([item_id, qty]) => ({ item_id, qty }))

    if (items.length === 0) {
      setBusy(false)
      return
    }

    try {
      const { error } = await executeOrQueue(
        'add_sale_idempotent',
        {
          p_items: items,
          p_session: session,
          p_method: method,
        },
        {
          targetId: session || undefined,
          description: `Snack Sale: ${items.length} items (${total} ETB)`,
        }
      )

      if (error) {
        setErr(msg(error))
        return
      }
      onClose()
    } catch (error) {
      setErr(msg({ message: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-4 sm:items-center backdrop-blur-sm animate-in fade-in"
    >
      <div className="w-full max-w-md max-h-[88dvh] overflow-hidden flex flex-col rounded-3xl border border-line bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line p-4 sm:p-5 bg-surface-elevated/40">
          <div>
            <h3 className="font-display text-xl font-bold text-ink">
              {session ? t('Add snacks to session') : t('Snack sale')}
            </h3>
            <p className="text-xs text-ink-muted">
              {session ? 'Billed together at session checkout' : 'Instant walk-in counter sale'}
            </p>
          </div>
          <ActionButton
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted hover:text-ink"
          >
            ✕
          </ActionButton>
        </div>

        {/* Error Alert */}
        {err && (
          <div className="m-4 rounded-xl border border-bad/40 bg-bad/10 p-3 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Items Menu list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {menu.map((item) => {
            const qty = quantities[item.id] || 0
            const isOutOfStock = item.track_stock && item.stock_qty <= 0

            return (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-3 rounded-2xl border p-3 transition-colors ${
                  qty > 0
                    ? 'border-brand/50 bg-brand/5'
                    : 'border-line/70 bg-surface-elevated/40'
                } ${isOutOfStock ? 'opacity-50' : ''}`}
              >
                <div className="flex-1 truncate">
                  <p className="font-semibold text-sm text-ink truncate">{item.name}</p>
                  <p className="text-xs text-ink-muted">
                    <span className="font-bold text-brand">{etb(item.sell_price)}</span>
                    {item.track_stock && (
                      <span className={`ml-2 ${item.stock_qty <= 5 ? 'text-warning font-semibold' : ''}`}>
                        · {item.stock_qty} left
                      </span>
                    )}
                  </p>
                </div>

                {/* Counter controls */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <ActionButton
                    disabled={qty === 0 || busy}
                    onClick={() =>
                      setQuantities({ ...quantities, [item.id]: Math.max(0, qty - 1) })
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface text-base font-bold text-ink hover:border-brand/40 active:scale-95 disabled:opacity-30"
                  >
                    −
                  </ActionButton>
                  <span className="w-7 text-center font-bold text-sm text-ink">{qty}</span>
                  <ActionButton
                    disabled={isOutOfStock || qty >= (item.track_stock ? item.stock_qty : 50) || busy}
                    onClick={() =>
                      setQuantities({
                        ...quantities,
                        [item.id]: Math.min(item.track_stock ? item.stock_qty : 50, qty + 1),
                      })
                    }
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-base font-bold text-bg hover:bg-brand-hover active:scale-95 disabled:opacity-30"
                  >
                    +
                  </ActionButton>
                </div>
              </div>
            )
          })}

          {menu.length === 0 && !err && (
            <div className="p-8 text-center text-xs text-ink/50">
              {t('No snacks yet. Ask the owner to add items in Inventory.')}
            </div>
          )}
        </div>

        {/* Footer & Payment */}
        <div className="border-t border-line bg-surface-elevated/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-ink-muted">{t('Total')}</span>
            <span className="font-display text-2xl font-bold text-brand">{etb(total)}</span>
          </div>

          {session ? (
            <ActionButton
              disabled={total === 0 || busy}
              onClick={() => handleSubmit(null)}
              className="btn btn-gold w-full"
            >
              {busy ? 'Adding…' : t('Add to session')}
            </ActionButton>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink/60">{t('How did they pay?')}</p>
              <div className="grid grid-cols-3 gap-2">
                {(['cash', 'telebirr', 'cbe'] as const).map((method) => (
                  <ActionButton
                    key={method}
                    disabled={total === 0 || busy}
                    onClick={() => handleSubmit(method)}
                    className="btn btn-secondary text-xs uppercase tracking-wider font-bold hover:border-brand disabled:opacity-40"
                  >
                    {method === 'cbe' ? 'CBE' : t(method)}
                  </ActionButton>
                ))}
              </div>
            </div>
          )}

          <ActionButton onClick={onClose} className="btn btn-secondary w-full text-xs">
            {t('Cancel')}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
