'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import { subMoney } from '@/lib/finance'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'

interface InventoryItem {
  id: string
  name: string
  sell_price: number
  cost_price: number
  track_stock: boolean
  stock_qty: number
  low_stock_threshold: number
  is_archived: boolean
}

export default function InventoryPage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [items, setItems] = useState<InventoryItem[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)

  // New item form
  const [newItem, setNewItem] = useState({
    name: '',
    sell_price: '',
    cost_price: '',
    track_stock: true,
    stock_qty: '0',
    low_stock_threshold: '5',
  })

  const hydrateLocalSnapshot = useCallback(() => {
    const snapItems = getLocalSnapshot<InventoryItem[]>('inventory_items')
    let hasAny = false
    if (snapItems.data) {
      setItems(snapItems.data)
      hasAny = true
    }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadInventory = useCallback(async () => {
    hydrateLocalSnapshot()
    const res = await sb
      .from('inventory_items')
      .select('*')
      .eq('is_archived', false)
      .order('name')

    if (res.error) {
      setErr(msg(res.error))
      return
    }

    const nextItems = (res.data as InventoryItem[]) || []
    setItems(nextItems)
    setLocalSnapshot('inventory_items', nextItems)
  }, [hydrateLocalSnapshot])

  useEffect(() => {
    hydrateLocalSnapshot()
    void loadInventory()
  }, [loadInventory, hydrateLocalSnapshot])

  const handleUpdate = async (id: string, field: keyof InventoryItem, value: unknown) => {
    setBusy(true)
    const { error } = await sb.from('inventory_items').update({ [field]: value }).eq('id', id)
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      loadInventory()
    }
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile?.zone_id) return
    setBusy(true)
    setErr('')

    const { error } = await sb.from('inventory_items').insert({
      zone_id: profile.zone_id,
      name: newItem.name.trim(),
      sell_price: Number(newItem.sell_price),
      cost_price: Number(newItem.cost_price || 0),
      track_stock: newItem.track_stock,
      stock_qty: Number(newItem.stock_qty || 0),
      low_stock_threshold: Number(newItem.low_stock_threshold || 5),
    })

    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setNewItem({
        name: '',
        sell_price: '',
        cost_price: '',
        track_stock: true,
        stock_qty: '0',
        low_stock_threshold: '5',
      })
      loadInventory()
    }
  }

  const lowStockItems = items.filter(
    (i) => i.track_stock && i.stock_qty <= i.low_stock_threshold
  )

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading inventory…</p>
          <p className="mt-1 text-xs text-ink-muted">Checking stock and catalog details.</p>
        </div>
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Inventory & Snacks"
      subtitle={`${items.length} items in catalog · ${lowStockItems.length} low stock warnings`}
      onRefresh={loadInventory}
    >
      <div className="space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Low Stock Warning Banner */}
        {lowStockItems.length > 0 && (
          <div className="rounded-2xl border border-warning/50 bg-warning/10 p-4 space-y-1">
            <div className="flex items-center gap-2 text-warning font-bold text-sm">
              <span>⚠️</span>
              <span>Low Inventory Alert ({lowStockItems.length} items)</span>
            </div>
            <p className="text-xs text-ink/80">
              {lowStockItems.map((i) => `${i.name} (${i.stock_qty} remaining)`).join(', ')}
            </p>
          </div>
        )}

        {/* Add New Snack Item Form */}
        <div className="surface-card p-5 space-y-4">
          <h2 className="font-display text-base font-bold text-ink">+ Add Catalog Item</h2>
          <form onSubmit={handleAddItem} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Item Name
                </label>
                <input
                  required
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  placeholder="e.g. Water 500ml, Cola, Chips"
                  className="inp text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Selling Price (ETB)
                </label>
                <input
                  required
                  type="number"
                  min="0"
                  step="any"
                  value={newItem.sell_price}
                  onChange={(e) => setNewItem({ ...newItem, sell_price: e.target.value })}
                  placeholder="0.00"
                  className="inp text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Cost Price (ETB)
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={newItem.cost_price}
                  onChange={(e) => setNewItem({ ...newItem, cost_price: e.target.value })}
                  placeholder="0.00"
                  className="inp text-xs"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                <input
                  type="checkbox"
                  checked={newItem.track_stock}
                  onChange={(e) => setNewItem({ ...newItem, track_stock: e.target.checked })}
                  className="h-4 w-4 rounded accent-brand"
                />
                <span>Track inventory stock count</span>
              </label>

              {newItem.track_stock && (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="0"
                    value={newItem.stock_qty}
                    onChange={(e) => setNewItem({ ...newItem, stock_qty: e.target.value })}
                    placeholder="Stock Qty"
                    className="inp !w-24 text-xs"
                  />
                  <input
                    type="number"
                    min="1"
                    value={newItem.low_stock_threshold}
                    onChange={(e) =>
                      setNewItem({ ...newItem, low_stock_threshold: e.target.value })
                    }
                    placeholder="Alert at"
                    className="inp !w-24 text-xs"
                  />
                </div>
              )}

              <ActionButton disabled={busy} className="btn btn-gold text-xs px-4">
                {busy ? 'Saving…' : 'Add to Menu'}
              </ActionButton>
            </div>
          </form>
        </div>

        {/* Inventory Items List */}
        <div className="space-y-3">
          <h2 className="font-display text-base font-bold text-ink">Catalog Items</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => {
              const margin = subMoney(item.sell_price, item.cost_price)
              const isLow = item.track_stock && item.stock_qty <= item.low_stock_threshold

              return (
                <div
                  key={item.id}
                  className={`surface-card p-4 space-y-3 transition-all ${isLow ? 'border-warning/50 bg-warning/5' : ''
                    }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-bold text-sm text-ink">{item.name}</h3>
                      <p className="text-[11px] text-ink-muted">
                        Margin: <b className="text-ok">+{etb(margin)}</b> per unit
                      </p>
                    </div>

                    <ActionButton
                      onClick={() =>
                        confirm(`Archive "${item.name}" from active menu?`) &&
                        handleUpdate(item.id, 'is_archived', true)
                      }
                      className="text-xs text-bad hover:underline font-semibold"
                    >
                      Archive
                    </ActionButton>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-[10px] text-ink-dim uppercase font-bold">
                        Sell Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={item.sell_price}
                        onBlur={(e) =>
                          Number(e.target.value) !== item.sell_price &&
                          handleUpdate(item.id, 'sell_price', Number(e.target.value))
                        }
                        className="inp text-xs font-bold text-brand h-9"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-ink-dim uppercase font-bold">
                        Cost Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        defaultValue={item.cost_price}
                        onBlur={(e) =>
                          Number(e.target.value) !== item.cost_price &&
                          handleUpdate(item.id, 'cost_price', Number(e.target.value))
                        }
                        className="inp text-xs h-9"
                      />
                    </div>
                  </div>

                  {item.track_stock && (
                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-line/60">
                      <div>
                        <label className="text-[10px] text-ink-dim uppercase font-bold">
                          In Stock
                        </label>
                        <input
                          type="number"
                          min="0"
                          defaultValue={item.stock_qty}
                          onBlur={(e) =>
                            Number(e.target.value) !== item.stock_qty &&
                            handleUpdate(item.id, 'stock_qty', Number(e.target.value))
                          }
                          className={`inp text-xs font-bold h-9 ${isLow ? 'text-warning border-warning' : ''
                            }`}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-ink-dim uppercase font-bold">
                          Alert At
                        </label>
                        <input
                          type="number"
                          min="1"
                          defaultValue={item.low_stock_threshold}
                          onBlur={(e) =>
                            Number(e.target.value) !== item.low_stock_threshold &&
                            handleUpdate(item.id, 'low_stock_threshold', Number(e.target.value))
                          }
                          className="inp text-xs h-9"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {items.length === 0 && !err && (
            <div className="surface-card p-10 text-center text-xs text-ink-muted">
              No inventory items yet. Add water, snacks, or energy drinks using the form above.
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
