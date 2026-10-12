'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import EthDate from '@/components/EthDate'
import {
  calculateNetProfit,
  addMoney,
  subMoney,
  formatETB,
} from '@/lib/finance'

interface ReportData {
  revenue: number
  games: number
  expenses: number
  by_method: Record<string, number>
  by_kind: Record<string, number>
  by_category: Record<string, number>
  daily: { day: string; revenue: number; expenses: number }[]
}

interface Expense {
  id: string
  category: string
  amount: number
  expense_date: string
  note: string | null
}

interface RecurringExpense {
  id: string
  category: string
  amount: number
  day_of_month: number
}

const CATEGORIES = ['Rent', 'Electricity', 'Maintenance', 'Salary', 'Internet', 'Other']

const formatDate = (d: Date) => d.toLocaleDateString('en-CA')

const getRange = (period: string): [string, string] => {
  const now = new Date()
  if (period === 'today') {
    return [formatDate(now), formatDate(now)]
  }
  if (period === 'week') {
    const monday = new Date(now)
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    return [formatDate(monday), formatDate(now)]
  }
  if (period === 'month') {
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
    return [formatDate(firstDay), formatDate(now)]
  }
  return [formatDate(now), formatDate(now)]
}

export default function FinancePage() {
  const router = useRouter()
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'super_admin'])

  const [period, setPeriod] = useState('today')
  const [[fromDate, toDate], setDateRange] = useState<[string, string]>(getRange('today'))
  const [report, setReport] = useState<ReportData | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [recurring, setRecurring] = useState<RecurringExpense[]>([])
  const [snackStats, setSnackStats] = useState({ revenue: 0, cost: 0 })
  const [employeeStats, setEmployeeStats] = useState<
    {
      name: string
      games: number
      sessions: number
      game_revenue: number
      snack_revenue: number
    }[]
  >([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // New expense form state
  const [newExp, setNewExp] = useState({
    category: 'Rent',
    amount: '',
    expense_date: formatDate(new Date()),
    note: '',
  })

  // New recurring expense form state
  const [newRec, setNewRec] = useState({
    category: 'Rent',
    amount: '',
    day_of_month: '1',
  })

  const loadFinanceData = useCallback(async () => {
    if (!profile?.zone_id) return
    setBusy(true)

    // Run scheduled recurring expense generator
    await sb.rpc('post_recurring')

    const [profitRes, expRes, recRes, snackRes, empRes] = await Promise.all([
      sb.rpc('profit_report', { p_from: fromDate, p_to: toDate }),
      sb
        .from('expenses')
        .select('id, category, amount, expense_date, note')
        .is('deleted_at', null)
        .gte('expense_date', fromDate)
        .lte('expense_date', toDate)
        .order('expense_date', { ascending: false }),
      sb.from('recurring_expenses').select('id, category, amount, day_of_month').eq('is_active', true),
      sb.rpc('snack_report', { p_from: fromDate, p_to: toDate }),
      sb.rpc('employee_report', { p_from: fromDate, p_to: toDate }),
    ])

    setBusy(false)
    if (profitRes.error || expRes.error || recRes.error) {
      setErr(msg(profitRes.error || expRes.error || recRes.error))
      return
    }

    setErr('')
    setReport(profitRes.data as ReportData)
    setExpenses((expRes.data as Expense[]) || [])
    setRecurring((recRes.data as RecurringExpense[]) || [])
    setSnackStats(
      (snackRes.data as { revenue: number; cost: number }) || { revenue: 0, cost: 0 }
    )
    setEmployeeStats((empRes.data as typeof employeeStats) || [])
  }, [profile?.zone_id, fromDate, toDate])

  useEffect(() => {
    if (profile) loadFinanceData()
  }, [profile, loadFinanceData])

  const handleAction = async (promise: PromiseLike<{ error: { message: string } | null }>, cb?: () => void) => {
    setBusy(true)
    const { error } = await promise
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      cb?.()
      loadFinanceData()
    }
  }

  // Exact math calculations
  const gameRevenue = report?.revenue ?? 0
  const snackRevenue = snackStats.revenue
  const grossRevenue = addMoney(gameRevenue, snackRevenue)
  const snackCost = snackStats.cost
  const totalExpenses = report?.expenses ?? 0
  const netProfit = calculateNetProfit(gameRevenue, snackRevenue, snackCost, totalExpenses)

  const maxDaily = Math.max(1, ...(report?.daily ?? []).flatMap((x) => [x.revenue, x.expenses]))

  // CSV Export
  const exportCSV = () => {
    const rows = [
      ['Date', 'Revenue', 'Expenses', 'Net'],
      ...(report?.daily ?? []).map((x) => [
        x.day,
        x.revenue,
        x.expenses,
        subMoney(x.revenue, x.expenses),
      ]),
      [],
      ['Expense Date', 'Category', 'Amount', 'Note'],
      ...expenses.map((x) => [x.expense_date, x.category, x.amount, x.note ?? '']),
    ]

    const csvContent = rows
      .map((line) => line.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(','))
      .join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `blackout-finance-${fromDate}-${toDate}.csv`
    a.click()
  }

  // Print Report
  const exportPDF = () => {
    window.print()
  }

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg text-ink">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    )
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Financial Accounting"
      subtitle="Profit & loss statements, revenue breakdown, expense auditing and exports"
      onRefresh={loadFinanceData}
      action={
        <div className="flex items-center gap-2">
          <button onClick={exportCSV} className="btn btn-secondary text-xs h-9 px-3">
            📥 Export CSV
          </button>
          <button onClick={exportPDF} className="btn btn-outline-gold text-xs h-9 px-3">
            🖨️ Print Report
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Date Filter Tabs */}
        <div className="surface-card p-4 space-y-3">
          <div className="grid grid-cols-4 gap-2">
            {[
              ['today', 'Today'],
              ['week', 'This Week'],
              ['month', 'This Month'],
              ['custom', 'Custom'],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setPeriod(k)
                  if (k !== 'custom') setDateRange(getRange(k))
                }}
                className={`btn text-xs font-bold py-2 ${
                  period === k ? 'btn-gold' : 'btn-secondary text-ink-muted'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {period === 'custom' && (
            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line">
              <div>
                <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setDateRange([e.target.value, toDate])}
                  className="inp text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-ink-muted mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setDateRange([fromDate, e.target.value])}
                  className="inp text-xs"
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-ink-dim">
            <span>📅 {fromDate} to {toDate}</span>
            <EthDate iso={fromDate} />
          </div>
        </div>

        {/* P&L Financial Summary Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Game Sessions
            </p>
            <p className="font-display text-2xl font-extrabold text-ink truncate">
              {etb(gameRevenue)}
            </p>
            <p className="text-[11px] text-ink-dim">{report?.games ?? 0} games counted</p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Snacks & Drinks
            </p>
            <p className="font-display text-2xl font-extrabold text-brand truncate">
              {etb(snackRevenue)}
            </p>
            <p className="text-[11px] text-ink-dim">COGS: {etb(snackCost)}</p>
          </div>

          <div className="surface-card p-4 space-y-1">
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              Operating Expenses
            </p>
            <p className="font-display text-2xl font-extrabold text-bad truncate">
              {etb(totalExpenses)}
            </p>
            <p className="text-[11px] text-ink-dim">{expenses.length} expense items</p>
          </div>

          <div
            className={`surface-card p-4 space-y-1 ${
              netProfit >= 0 ? 'border-ok/50 bg-ok/5' : 'border-bad/50 bg-bad/5'
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              {netProfit >= 0 ? 'Net Operating Profit' : 'Net Operating Loss'}
            </p>
            <p
              className={`font-display text-2xl font-extrabold truncate ${
                netProfit >= 0 ? 'text-ok' : 'text-bad'
              }`}
            >
              {etb(Math.abs(netProfit))}
            </p>
            <p className="text-[11px] text-ink-dim">Gross: {etb(grossRevenue)}</p>
          </div>
        </div>

        {/* Revenue & Expense Breakdown Grids */}
        {report && (
          <div className="grid gap-3 sm:grid-cols-3">
            {/* By Payment Method */}
            <div className="surface-card p-4 space-y-2">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">
                By Payment Method
              </h3>
              <div className="space-y-1.5 divide-y divide-line/60">
                {Object.entries(report.by_method).map(([m, val]) => (
                  <div key={m} className="pt-1.5 flex justify-between text-xs">
                    <span className="capitalize font-medium text-ink">
                      {m === 'cbe' ? 'CBE Bank' : m}
                    </span>
                    <span className="font-bold text-ink">{etb(val)}</span>
                  </div>
                ))}
                {Object.keys(report.by_method).length === 0 && (
                  <p className="text-xs text-ink-dim pt-1">No collections recorded</p>
                )}
              </div>
            </div>

            {/* By Unit Kind */}
            <div className="surface-card p-4 space-y-2">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">
                By Console / Unit Type
              </h3>
              <div className="space-y-1.5 divide-y divide-line/60">
                {Object.entries(report.by_kind).map(([k, val]) => (
                  <div key={k} className="pt-1.5 flex justify-between text-xs">
                    <span className="uppercase font-medium text-ink">{k}</span>
                    <span className="font-bold text-ink">{etb(val)}</span>
                  </div>
                ))}
                {Object.keys(report.by_kind).length === 0 && (
                  <p className="text-xs text-ink-dim pt-1">No activity yet</p>
                )}
              </div>
            </div>

            {/* By Expense Category */}
            <div className="surface-card p-4 space-y-2">
              <h3 className="font-display text-xs font-bold uppercase tracking-wider text-brand">
                By Expense Category
              </h3>
              <div className="space-y-1.5 divide-y divide-line/60">
                {Object.entries(report.by_category).map(([c, val]) => (
                  <div key={c} className="pt-1.5 flex justify-between text-xs">
                    <span className="font-medium text-ink">{c}</span>
                    <span className="font-bold text-bad">{etb(val)}</span>
                  </div>
                ))}
                {Object.keys(report.by_category).length === 0 && (
                  <p className="text-xs text-ink-dim pt-1">Zero expenses logged</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Daily Financial Chart / Bars */}
        {(report?.daily.length ?? 0) > 1 && (
          <div className="surface-card p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-ink">Daily Revenue vs Expenses</h3>
            <div className="max-h-60 overflow-y-auto space-y-2.5">
              {report!.daily.map((x) => (
                <div key={x.day} className="space-y-1 text-xs">
                  <div className="flex justify-between font-medium">
                    <span className="text-ink">{x.day}</span>
                    <span>
                      <b className="text-brand">{etb(x.revenue)}</b> /{' '}
                      <span className="text-bad">{etb(x.expenses)}</span>
                    </span>
                  </div>
                  <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-surface-elevated">
                    <div
                      className="bg-brand rounded-full transition-all"
                      style={{ width: `${(x.revenue / maxDaily) * 100}%` }}
                    />
                    <div
                      className="bg-bad rounded-full transition-all"
                      style={{ width: `${(x.expenses / maxDaily) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Per-Employee Shift Performance */}
        {employeeStats.length > 0 && (
          <div className="surface-card p-5 space-y-3">
            <h3 className="font-display text-sm font-bold text-ink">Employee Shift Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="border-b border-line text-ink-dim font-bold uppercase">
                  <tr>
                    <th className="py-2">Staff Member</th>
                    <th className="py-2">Sessions</th>
                    <th className="py-2">Games</th>
                    <th className="py-2">Game Revenue</th>
                    <th className="py-2">Snack Revenue</th>
                    <th className="py-2 text-right">Total Generated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60">
                  {employeeStats.map((emp) => (
                    <tr key={emp.name} className="hover:bg-surface-elevated/40">
                      <td className="py-2.5 font-bold text-ink">{emp.name}</td>
                      <td className="py-2.5">{emp.sessions}</td>
                      <td className="py-2.5">{emp.games}</td>
                      <td className="py-2.5">{etb(emp.game_revenue)}</td>
                      <td className="py-2.5">{etb(emp.snack_revenue)}</td>
                      <td className="py-2.5 font-bold text-brand text-right">
                        {etb(addMoney(emp.game_revenue, emp.snack_revenue))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Expenses Management Section */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* One-time Expenses */}
          <div className="surface-card p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-ink">Record Operating Expense</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleAction(
                  sb.from('expenses').insert({
                    zone_id: profile!.zone_id,
                    category: newExp.category,
                    amount: Number(newExp.amount),
                    expense_date: newExp.expense_date,
                    note: newExp.note.trim() || null,
                  }),
                  () => setNewExp({ ...newExp, amount: '', note: '' })
                )
              }}
              className="grid grid-cols-2 gap-2"
            >
              <select
                value={newExp.category}
                onChange={(e) => setNewExp({ ...newExp, category: e.target.value })}
                className="inp text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={newExp.amount}
                onChange={(e) => setNewExp({ ...newExp, amount: e.target.value })}
                placeholder="Amount (ETB)"
                className="inp text-xs font-bold"
              />
              <input
                type="date"
                value={newExp.expense_date}
                onChange={(e) => setNewExp({ ...newExp, expense_date: e.target.value })}
                className="inp text-xs"
              />
              <input
                value={newExp.note}
                onChange={(e) => setNewExp({ ...newExp, note: e.target.value })}
                placeholder="Note / Receipt info"
                className="inp text-xs"
              />
              <button disabled={busy} className="btn btn-gold col-span-2 text-xs">
                + Add Expense
              </button>
            </form>

            <div className="max-h-60 overflow-y-auto space-y-2 divide-y divide-line/60">
              {expenses.map((exp) => (
                <div key={exp.id} className="pt-2 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-bold text-ink">{exp.category}</p>
                    <p className="text-[11px] text-ink-muted">
                      {exp.expense_date} {exp.note ? `· ${exp.note}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-bad">{etb(exp.amount)}</span>
                    <button
                      onClick={() =>
                        confirm('Delete this expense record?') &&
                        handleAction(
                          sb
                            .from('expenses')
                            .update({ deleted_at: new Date().toISOString() })
                            .eq('id', exp.id)
                        )
                      }
                      className="text-bad hover:underline"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
              {expenses.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-dim">No expenses in this period.</p>
              )}
            </div>
          </div>

          {/* Monthly Recurring Expenses */}
          <div className="surface-card p-5 space-y-4">
            <h3 className="font-display text-base font-bold text-ink">Monthly Recurring Expenses</h3>
            <p className="text-xs text-ink-muted leading-relaxed">
              Rent, internet, or scheduled bills automatically post on their set day of month.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault()
                handleAction(
                  sb.from('recurring_expenses').insert({
                    zone_id: profile!.zone_id,
                    category: newRec.category,
                    amount: Number(newRec.amount),
                    day_of_month: Number(newRec.day_of_month),
                  }),
                  () => setNewRec({ ...newRec, amount: '' })
                )
              }}
              className="grid grid-cols-3 gap-2"
            >
              <select
                value={newRec.category}
                onChange={(e) => setNewRec({ ...newRec, category: e.target.value })}
                className="inp text-xs"
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={newRec.amount}
                onChange={(e) => setNewRec({ ...newRec, amount: e.target.value })}
                placeholder="Amount (ETB)"
                className="inp text-xs font-bold"
              />
              <input
                required
                type="number"
                min="1"
                max="28"
                value={newRec.day_of_month}
                onChange={(e) => setNewRec({ ...newRec, day_of_month: e.target.value })}
                placeholder="Day 1-28"
                className="inp text-xs"
              />
              <button disabled={busy} className="btn btn-gold col-span-3 text-xs">
                + Schedule Monthly Expense
              </button>
            </form>

            <div className="space-y-2">
              {recurring.map((rec) => (
                <div
                  key={rec.id}
                  className="flex items-center justify-between rounded-xl border border-line bg-surface-elevated p-3 text-xs"
                >
                  <div>
                    <span className="font-bold text-ink">{rec.category}</span>
                    <span className="text-ink-muted ml-2">
                      · {etb(rec.amount)} on day {rec.day_of_month}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      handleAction(
                        sb.from('recurring_expenses').update({ is_active: false }).eq('id', rec.id)
                      )
                    }
                    className="text-bad hover:underline font-semibold"
                  >
                    Stop
                  </button>
                </div>
              ))}
              {recurring.length === 0 && (
                <p className="py-4 text-center text-xs text-ink-dim">
                  No monthly recurring expenses configured.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
