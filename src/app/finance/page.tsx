'use client'
import ActionButton from '@/components/ActionButton'

import React, { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import EthDate from '@/components/EthDate'
import { getLocalSnapshot, setLocalSnapshot } from '@/lib/offline'
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
  daily: { day: string; game_revenue: number; snack_revenue: number; snack_cost: number; expenses: number }[]
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

const formatDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const parsePositiveETB = (value: string): number | null => {
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 9_999_999_999.99) return null
  const cents = amount * 100
  if (Math.abs(cents - Math.round(cents)) > 1e-7) return null
  return Math.round(cents) / 100
}

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
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false)

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

  const hydrateLocalSnapshot = useCallback(() => {
    // v2 includes daily snack revenue and COGS; don't show older incomplete daily totals offline.
    const snapReport = getLocalSnapshot<ReportData>('finance_report_v2')
    const snapExpenses = getLocalSnapshot<Expense[]>('finance_expenses')
    const snapRecurring = getLocalSnapshot<RecurringExpense[]>('finance_recurring')
    const snapSnackStats = getLocalSnapshot<{ revenue: number; cost: number }>('finance_snack_stats')
    const snapEmployeeStats = getLocalSnapshot<typeof employeeStats>('finance_employee_stats')

    let hasAny = false
    if (snapReport.data) { setReport(snapReport.data); hasAny = true }
    if (snapExpenses.data) { setExpenses(snapExpenses.data); hasAny = true }
    if (snapRecurring.data) { setRecurring(snapRecurring.data); hasAny = true }
    if (snapSnackStats.data) { setSnackStats(snapSnackStats.data); hasAny = true }
    if (snapEmployeeStats.data) { setEmployeeStats(snapEmployeeStats.data); hasAny = true }
    setHasLocalSnapshot(hasAny)
    return hasAny
  }, [])

  const loadFinanceData = useCallback(async () => {
    if (!profile?.zone_id) return
    hydrateLocalSnapshot()
    setBusy(true)

    // Post due recurring expenses before reading the P&L.
    const recurringPostRes = await sb.rpc('post_recurring')

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
    if (profitRes.error || expRes.error || snackRes.error) {
      setErr(msg(profitRes.error || expRes.error || snackRes.error))
      return
    }

    const nextReport = profitRes.data as ReportData
    const hasDailyPnlFields = Array.isArray(nextReport?.daily)
      && nextReport.daily.length > 0
      && nextReport.daily.every((day) =>
        Number.isFinite(Number(day.game_revenue))
        && Number.isFinite(Number(day.snack_revenue))
        && Number.isFinite(Number(day.snack_cost))
        && Number.isFinite(Number(day.expenses))
      )
    if (!hasDailyPnlFields) {
      setErr('The finance database needs migration 018 before daily profit and loss can be shown accurately.')
      return
    }
    const nextExpenses = (expRes.data as Expense[]) || []
    const nextRecurring = (recRes.data as RecurringExpense[]) || []
    const nextSnackStats = (snackRes.data as { revenue: number; cost: number }) || { revenue: 0, cost: 0 }
    const nextEmployeeStats = (empRes.data as typeof employeeStats) || []

    const warnings = [
      recurringPostRes.error && `Could not post due recurring expenses: ${msg(recurringPostRes.error)}`,
      recRes.error && `Could not load recurring expense settings: ${msg(recRes.error)}`,
      empRes.error && `Could not load employee performance: ${msg(empRes.error)}`,
    ].filter(Boolean)
    setErr(warnings.join(' '))
    setReport(nextReport)
    setExpenses(nextExpenses)
    setRecurring(nextRecurring)
    setSnackStats(nextSnackStats)
    setEmployeeStats(nextEmployeeStats)
    setLocalSnapshot('finance_report_v2', nextReport)
    setLocalSnapshot('finance_expenses', nextExpenses)
    setLocalSnapshot('finance_recurring', nextRecurring)
    setLocalSnapshot('finance_snack_stats', nextSnackStats)
    setLocalSnapshot('finance_employee_stats', nextEmployeeStats)
  }, [profile?.zone_id, fromDate, toDate, hydrateLocalSnapshot])

  useEffect(() => {
    if (profile) {
      hydrateLocalSnapshot()
      void loadFinanceData()
    }
  }, [profile, loadFinanceData, hydrateLocalSnapshot])

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

  const maxDaily = Math.max(1, ...(report?.daily ?? []).flatMap((x) => [
    addMoney(x.game_revenue, x.snack_revenue),
    addMoney(x.snack_cost, x.expenses),
  ]))

  // CSV Export
  const exportCSV = () => {
    const rows = [
      ['Date', 'Game Revenue', 'Snack Revenue', 'Gross Revenue', 'Snack COGS', 'Operating Expenses', 'Net Profit'],
      ...(report?.daily ?? []).map((x) => {
        const gross = addMoney(x.game_revenue, x.snack_revenue)
        const costs = addMoney(x.snack_cost, x.expenses)
        return [x.day, x.game_revenue, x.snack_revenue, gross, x.snack_cost, x.expenses, subMoney(gross, costs)]
      }),
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

  if (loading && !hasLocalSnapshot) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4 text-ink">
        <div className="surface-card w-full max-w-sm p-6 text-center shadow-2xl shadow-brand/10">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-3 border-brand border-t-transparent" />
          <p className="font-display text-lg font-bold text-ink">Loading finance view…</p>
          <p className="mt-1 text-xs text-ink-muted">Gathering sales, costs, and report data.</p>
        </div>
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
          <ActionButton onClick={exportCSV} className="btn btn-secondary text-xs h-9 px-3"><span className="sm:hidden">CSV</span><span className="hidden sm:inline">Export CSV</span></ActionButton>
          <ActionButton onClick={exportPDF} className="btn btn-outline-gold text-xs h-9 px-3"><span className="sm:hidden">Print</span><span className="hidden sm:inline">Print Report</span></ActionButton>
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['today', 'Today'],
              ['week', 'This Week'],
              ['month', 'This Month'],
              ['custom', 'Custom'],
            ].map(([k, label]) => (
              <ActionButton
                key={k}
                onClick={() => {
                  setPeriod(k)
                  if (k !== 'custom') setDateRange(getRange(k))
                }}
                className={`btn text-xs font-bold py-2 ${period === k ? 'btn-gold' : 'btn-secondary text-ink-muted'
                  }`}
              >
                {label}
              </ActionButton>
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
            className={`surface-card p-4 space-y-1 ${netProfit >= 0 ? 'border-ok/50 bg-ok/5' : 'border-bad/50 bg-bad/5'
              }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">
              {netProfit >= 0 ? 'Net Operating Profit' : 'Net Operating Loss'}
            </p>
            <p
              className={`font-display text-2xl font-extrabold truncate ${netProfit >= 0 ? 'text-ok' : 'text-bad'
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
            <h3 className="font-display text-sm font-bold text-ink">Daily Revenue vs Total Costs</h3>
            <div className="max-h-60 overflow-y-auto space-y-2.5">
              {report!.daily.map((x) => (
                <div key={x.day} className="space-y-1 text-xs">
                  <div className="flex justify-between font-medium">
                    <span className="text-ink">{x.day}</span>
                    {(() => {
                      const revenue = addMoney(x.game_revenue, x.snack_revenue)
                      const costs = addMoney(x.snack_cost, x.expenses)
                      return (
                        <span className="flex flex-wrap justify-end gap-x-2 text-right">
                          <b className="text-brand">Revenue {etb(revenue)}</b>
                          <span className="text-bad">Costs {etb(costs)}</span>
                          <span className={subMoney(revenue, costs) >= 0 ? 'text-ok' : 'text-bad'}>
                            Net {etb(subMoney(revenue, costs))}
                          </span>
                        </span>
                      )
                    })()}
                  </div>
                  <div className="flex gap-1 h-2 rounded-full overflow-hidden bg-surface-elevated">
                    <div
                      className="bg-brand rounded-full transition-all"
                      style={{ width: `${(addMoney(x.game_revenue, x.snack_revenue) / maxDaily) * 100}%` }}
                    />
                    <div
                      className="bg-bad rounded-full transition-all"
                      style={{ width: `${(addMoney(x.snack_cost, x.expenses) / maxDaily) * 100}%` }}
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
                const amount = parsePositiveETB(newExp.amount)
                if (amount === null) {
                  setErr('Enter an expense amount greater than zero with no more than two decimal places.')
                  return
                }
                setErr('')
                handleAction(
                  sb.from('expenses').insert({
                    zone_id: profile!.zone_id,
                    category: newExp.category,
                    amount,
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
                min="0.01"
                max="9999999999.99"
                step="0.01"
                value={newExp.amount}
                onChange={(e) => setNewExp({ ...newExp, amount: e.target.value })}
                placeholder="Amount (ETB)"
                className="inp text-xs font-bold"
              />
              <input
                required
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
              <ActionButton disabled={busy} className="btn btn-gold col-span-2 text-xs">
                + Add Expense
              </ActionButton>
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
                    <ActionButton
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
                    </ActionButton>
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
                const amount = parsePositiveETB(newRec.amount)
                if (amount === null) {
                  setErr('Enter a recurring expense amount greater than zero with no more than two decimal places.')
                  return
                }
                setErr('')
                handleAction(
                  sb.from('recurring_expenses').insert({
                    zone_id: profile!.zone_id,
                    category: newRec.category,
                    amount,
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
                min="0.01"
                max="9999999999.99"
                step="0.01"
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
              <ActionButton disabled={busy} className="btn btn-gold col-span-3 text-xs">
                + Schedule Monthly Expense
              </ActionButton>
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
                  <ActionButton
                    onClick={() =>
                      handleAction(
                        sb.from('recurring_expenses').update({ is_active: false }).eq('id', rec.id)
                      )
                    }
                    className="text-bad hover:underline font-semibold"
                  >
                    Stop
                  </ActionButton>
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
