'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { sb, msg, etb } from '@/lib/supabase'
import { useAuthGuard } from '@/lib/auth'
import AppLayout from '@/components/AppLayout'
import { getRoundTitle, calculateTournamentAccounting } from '@/lib/tournamentBrackets'
import { TrophyIcon } from '@/components/PlayStationIcons'

interface Tournament {
  id: string
  name: string
  description: string | null
  game: string
  kind: string
  format: string
  max_players: number
  entry_fee: number
  prize_pool: number
  organizer_expenses: number
  status: 'draft' | 'registration_open' | 'in_progress' | 'completed' | 'cancelled'
  rules: string | null
  starts_at: string | null
  winner_id: string | null
  created_at: string
}

interface Participant {
  id: string
  name: string
  phone: string | null
  seed: number | null
  payment_status: 'unpaid' | 'paid' | 'refunded'
  payment_method: string | null
  registered_at: string
}

interface Match {
  id: string
  round: number
  match_number: number
  player1_id: string | null
  player2_id: string | null
  score1: number | null
  score2: number | null
  winner_id: string | null
  status: 'pending' | 'in_progress' | 'completed' | 'walkover'
  next_match_id: string | null
  next_match_slot: number | null
}

export default function TournamentsPage() {
  const { user, profile, zone, loading } = useAuthGuard(['admin', 'employee', 'super_admin'])

  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [selectedTourn, setSelectedTourn] = useState<Tournament | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [matches, setMatches] = useState<Match[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  // Creation modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newTourn, setNewTourn] = useState({
    name: '',
    game: 'EA FC 25 / FIFA',
    kind: 'ps5',
    max_players: '16',
    entry_fee: '100',
    prize_pool: '1200',
    organizer_expenses: '200',
    rules: 'Single elimination, 6-minute halves. Tied games go to extra time and penalties.',
  })

  // Player registration state
  const [showRegisterModal, setShowRegisterModal] = useState(false)
  const [newPlayer, setNewPlayer] = useState({
    name: '',
    phone: '',
    paid: true,
    method: 'cash',
  })

  // Match score modal state
  const [activeMatch, setActiveMatch] = useState<Match | null>(null)
  const [score1, setScore1] = useState('0')
  const [score2, setScore2] = useState('0')
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [isWalkover, setIsWalkover] = useState(false)

  const isOwner = profile?.role === 'admin' || profile?.role === 'super_admin'

  const loadTournaments = useCallback(async () => {
    const { data, error } = await sb
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      setErr(msg(error))
      return
    }

    const list = (data as Tournament[]) || []
    setTournaments(list)
    if (list.length > 0 && !selectedTourn) {
      setSelectedTourn(list[0])
    }
  }, [selectedTourn])

  const loadTournamentDetails = useCallback(async (tournId: string) => {
    const [pRes, mRes] = await Promise.all([
      sb
        .from('tournament_participants')
        .select('*')
        .eq('tournament_id', tournId)
        .order('seed', { ascending: true }),
      sb
        .from('tournament_matches')
        .select('*')
        .eq('tournament_id', tournId)
        .order('round', { ascending: true })
        .order('match_number', { ascending: true }),
    ])

    if (pRes.error || mRes.error) {
      setErr(msg(pRes.error || mRes.error))
      return
    }

    setParticipants((pRes.data as Participant[]) || [])
    setMatches((mRes.data as Match[]) || [])
  }, [])

  useEffect(() => {
    loadTournaments()
  }, [loadTournaments])

  useEffect(() => {
    if (selectedTourn) {
      loadTournamentDetails(selectedTourn.id)
    }
  }, [selectedTourn, loadTournamentDetails])

  // Create new tournament
  const handleCreateTournament = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr('')

    if (!zone?.id) {
      setErr('Game zone context missing.')
      setBusy(false)
      return
    }

    const { data, error } = await sb
      .from('tournaments')
      .insert({
        zone_id: zone.id,
        name: newTourn.name.trim(),
        game: newTourn.game.trim(),
        kind: newTourn.kind,
        format: 'single_elimination',
        max_players: Math.max(4, Number(newTourn.max_players) || 16),
        entry_fee: Math.max(0, Number(newTourn.entry_fee) || 0),
        prize_pool: Math.max(0, Number(newTourn.prize_pool) || 0),
        organizer_expenses: Math.max(0, Number(newTourn.organizer_expenses) || 0),
        rules: newTourn.rules.trim() || null,
        status: 'registration_open',
      })
      .select()
      .single()

    setBusy(false)
    if (error || !data) {
      setErr(msg(error))
    } else {
      setShowCreateModal(false)
      setNewTourn({
        name: '',
        game: 'EA FC 25 / FIFA',
        kind: 'ps5',
        max_players: '16',
        entry_fee: '100',
        prize_pool: '1200',
        organizer_expenses: '200',
        rules: 'Single elimination. 6-minute halves.',
      })
      setSelectedTourn(data as Tournament)
      loadTournaments()
    }
  }

  // Register player
  const handleRegisterPlayer = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedTourn) return
    setBusy(true)
    setErr('')

    const { error } = await sb.rpc('register_tournament_player', {
      p_tournament: selectedTourn.id,
      p_name: newPlayer.name.trim(),
      p_phone: newPlayer.phone.trim() || null,
      p_paid: newPlayer.paid,
      p_method: newPlayer.paid ? newPlayer.method : null,
    })

    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setShowRegisterModal(false)
      setNewPlayer({ name: '', phone: '', paid: true, method: 'cash' })
      loadTournamentDetails(selectedTourn.id)
    }
  }

  // Generate Bracket
  const handleGenerateBracket = async () => {
    if (!selectedTourn) return
    if (!confirm('Start tournament and generate elimination bracket?')) return

    setBusy(true)
    setErr('')
    const { error } = await sb.rpc('generate_tournament_bracket', {
      p_tournament: selectedTourn.id,
    })
    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      loadTournaments()
      loadTournamentDetails(selectedTourn.id)
    }
  }

  // Submit Match Result
  const handleRecordResult = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeMatch || !winnerId) return

    setBusy(true)
    setErr('')
    const { error } = await sb.rpc('record_match_result', {
      p_match: activeMatch.id,
      p_score1: Number(score1),
      p_score2: Number(score2),
      p_winner: winnerId,
      p_walkover: isWalkover,
    })

    setBusy(false)
    if (error) {
      setErr(msg(error))
    } else {
      setActiveMatch(null)
      loadTournamentDetails(selectedTourn!.id)
    }
  }

  // Financial accounting calculation
  const paidCount = participants.filter((p) => p.payment_status === 'paid').length
  const financials = selectedTourn
    ? calculateTournamentAccounting(
        selectedTourn.entry_fee,
        paidCount,
        selectedTourn.prize_pool,
        selectedTourn.organizer_expenses
      )
    : { grossRevenue: 0, netProfit: 0, isProfitable: true }

  // Group matches by round for bracket
  const rounds = Array.from(new Set(matches.map((m) => m.round))).sort((a, b) => a - b)
  const totalRounds = rounds.length

  const getPlayerName = (id: string | null) => {
    if (!id) return 'TBD'
    return participants.find((p) => p.id === id)?.name || 'Unknown'
  }

  return (
    <AppLayout
      profile={profile}
      zone={zone}
      title="Tournament Hub"
      subtitle="Competitive brackets, entry fees, player rosters and prize accounting"
      onRefresh={() => {
        loadTournaments()
        if (selectedTourn) loadTournamentDetails(selectedTourn.id)
      }}
      action={
        isOwner && (
          <button
            onClick={() => setShowCreateModal(true)}
            className="btn btn-gold text-xs h-9 px-3 font-bold"
          >
            <span>+</span>
            <span>Create Tournament</span>
          </button>
        )
      }
    >
      <div className="space-y-6">
        {err && (
          <div role="alert" className="rounded-2xl border border-bad/40 bg-bad/10 p-3.5 text-xs text-bad">
            {err}
          </div>
        )}

        {/* Tournament Selector Pill Tabs */}
        {tournaments.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            {tournaments.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTourn(t)}
                className={`rounded-2xl border px-4 py-2 text-xs font-bold whitespace-nowrap transition-all ${
                  selectedTourn?.id === t.id
                    ? 'border-brand bg-brand/15 text-brand shadow-glow-sm'
                    : 'border-line bg-surface text-ink-muted hover:text-ink'
                }`}
              >
                <span>{t.name}</span>
                <span
                  className={`ml-2 text-[10px] px-1.5 py-0.5 rounded-full ${
                    t.status === 'completed'
                      ? 'bg-ok/20 text-ok'
                      : t.status === 'in_progress'
                      ? 'bg-brand/20 text-brand'
                      : 'bg-surface-elevated text-ink-dim'
                  }`}
                >
                  {t.status.replace('_', ' ')}
                </span>
              </button>
            ))}
          </div>
        )}

        {selectedTourn ? (
          <div className="space-y-6">
            {/* Tournament Overview Card */}
            <div className="surface-card p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/10 text-brand border border-brand/30">
                      🏆
                    </span>
                    <h2 className="font-display text-xl sm:text-2xl font-bold text-ink">
                      {selectedTourn.name}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {selectedTourn.game} · {selectedTourn.kind.toUpperCase()} · Max {selectedTourn.max_players} Players
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-xl px-3 py-1 text-xs font-extrabold uppercase tracking-wider ${
                      selectedTourn.status === 'completed'
                        ? 'bg-ok/20 text-ok border border-ok/40'
                        : selectedTourn.status === 'in_progress'
                        ? 'bg-brand/20 text-brand border border-brand/40 animate-pulse'
                        : 'bg-surface-elevated text-ink-muted border border-line'
                    }`}
                  >
                    {selectedTourn.status.replace('_', ' ')}
                  </span>

                  {selectedTourn.status === 'registration_open' && (
                    <button
                      onClick={() => setShowRegisterModal(true)}
                      className="btn btn-gold text-xs h-9 px-3"
                    >
                      + Register Player
                    </button>
                  )}

                  {selectedTourn.status === 'registration_open' && isOwner && (
                    <button
                      disabled={busy || participants.length < 2}
                      onClick={handleGenerateBracket}
                      className="btn btn-secondary text-xs h-9 px-3 font-bold hover:border-brand"
                    >
                      ⚡ Start Tournament
                    </button>
                  )}
                </div>
              </div>

              {/* Tournament Accounting & Financial Summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl border border-line bg-surface-elevated p-3 text-center">
                  <p className="text-[10px] font-bold uppercase text-ink-dim tracking-wider">
                    Players Registered
                  </p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-ink mt-0.5">
                    {participants.length}{' '}
                    <span className="text-xs font-semibold text-ink-muted">
                      / {selectedTourn.max_players}
                    </span>
                  </p>
                  <p className="text-[10px] text-ink-dim">{paidCount} paid fees</p>
                </div>

                <div className="rounded-2xl border border-line bg-surface-elevated p-3 text-center">
                  <p className="text-[10px] font-bold uppercase text-ink-dim tracking-wider">
                    Gross Entry Revenue
                  </p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-brand mt-0.5">
                    {etb(financials.grossRevenue)}
                  </p>
                  <p className="text-[10px] text-ink-dim">
                    {etb(selectedTourn.entry_fee)} per player
                  </p>
                </div>

                <div className="rounded-2xl border border-line bg-surface-elevated p-3 text-center">
                  <p className="text-[10px] font-bold uppercase text-ink-dim tracking-wider">
                    Prize Pool
                  </p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold text-ink mt-0.5">
                    {etb(selectedTourn.prize_pool)}
                  </p>
                  <p className="text-[10px] text-ink-dim">Champion & Runner-up</p>
                </div>

                <div
                  className={`rounded-2xl border p-3 text-center ${
                    financials.isProfitable
                      ? 'border-ok/40 bg-ok/10 text-ok'
                      : 'border-bad/40 bg-bad/10 text-bad'
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-wider">
                    {financials.isProfitable ? 'Net Profit' : 'Net Loss'}
                  </p>
                  <p className="font-display text-xl sm:text-2xl font-extrabold mt-0.5">
                    {etb(Math.abs(financials.netProfit))}
                  </p>
                  <p className="text-[10px] opacity-80">
                    After {etb(selectedTourn.organizer_expenses)} expenses
                  </p>
                </div>
              </div>

              {selectedTourn.winner_id && (
                <div className="rounded-2xl border border-brand/50 bg-gradient-to-r from-brand/20 via-brand/10 to-transparent p-4 flex items-center gap-3">
                  <span className="text-3xl">👑</span>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-brand">
                      Tournament Champion
                    </p>
                    <p className="font-display text-xl font-extrabold text-ink">
                      {getPlayerName(selectedTourn.winner_id)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Elimination Bracket View */}
            {matches.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-ink flex items-center gap-2">
                    <span>⚔️</span>
                    <span>Single-Elimination Bracket</span>
                  </h3>
                  <span className="text-xs text-ink-muted">Tap match to enter scores</span>
                </div>

                {/* Horizontal scrollable bracket tree */}
                <div className="surface-card p-4 sm:p-6 overflow-x-auto">
                  <div className="flex gap-6 min-w-max pb-4">
                    {rounds.map((roundNum) => {
                      const roundMatches = matches.filter((m) => m.round === roundNum)
                      const title = getRoundTitle(roundNum, totalRounds)

                      return (
                        <div key={roundNum} className="w-64 space-y-3">
                          <div className="text-center border-b border-line pb-2">
                            <p className="font-display text-xs font-bold text-brand uppercase tracking-wider">
                              {title}
                            </p>
                            <p className="text-[10px] text-ink-muted">
                              {roundMatches.length} Match{roundMatches.length > 1 ? 'es' : ''}
                            </p>
                          </div>

                          <div className="space-y-4">
                            {roundMatches.map((m) => {
                              const p1Name = getPlayerName(m.player1_id)
                              const p2Name = getPlayerName(m.player2_id)
                              const isCompleted = m.status === 'completed' || m.status === 'walkover'
                              const canScore = m.player1_id && m.player2_id && !isCompleted

                              return (
                                <div
                                  key={m.id}
                                  onClick={() => {
                                    if (canScore || isOwner) {
                                      setActiveMatch(m)
                                      setScore1(String(m.score1 || 0))
                                      setScore2(String(m.score2 || 0))
                                      setWinnerId(m.winner_id || m.player1_id)
                                    }
                                  }}
                                  className={`rounded-2xl border p-3 transition-all cursor-pointer ${
                                    isCompleted
                                      ? 'border-line/70 bg-surface-elevated/60'
                                      : canScore
                                      ? 'border-brand/50 bg-surface hover:border-brand shadow-glow-sm'
                                      : 'border-line/40 bg-surface/40 opacity-70 cursor-not-allowed'
                                  }`}
                                >
                                  <div className="flex items-center justify-between text-[10px] text-ink-dim border-b border-line/40 pb-1 mb-2">
                                    <span>Match #{m.match_number}</span>
                                    <span
                                      className={`font-semibold capitalize ${
                                        isCompleted ? 'text-ok' : 'text-brand'
                                      }`}
                                    >
                                      {m.status}
                                    </span>
                                  </div>

                                  {/* Player 1 Row */}
                                  <div
                                    className={`flex items-center justify-between py-1 px-1.5 rounded-lg text-xs font-semibold ${
                                      m.winner_id === m.player1_id
                                        ? 'bg-brand/20 text-brand font-bold'
                                        : 'text-ink'
                                    }`}
                                  >
                                    <span className="truncate max-w-[170px]">{p1Name}</span>
                                    <span className="font-display font-bold">
                                      {m.score1 ?? '—'}
                                    </span>
                                  </div>

                                  {/* Player 2 Row */}
                                  <div
                                    className={`flex items-center justify-between py-1 px-1.5 rounded-lg text-xs font-semibold mt-1 ${
                                      m.winner_id === m.player2_id
                                        ? 'bg-brand/20 text-brand font-bold'
                                        : 'text-ink'
                                    }`}
                                  >
                                    <span className="truncate max-w-[170px]">{p2Name}</span>
                                    <span className="font-display font-bold">
                                      {m.score2 ?? '—'}
                                    </span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              /* Players Registered List if bracket not generated yet */
              <div className="surface-card p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-ink">
                    Registered Players Roster ({participants.length} / {selectedTourn.max_players})
                  </h3>
                  {selectedTourn.status === 'registration_open' && (
                    <button
                      onClick={() => setShowRegisterModal(true)}
                      className="btn btn-outline-gold text-xs h-8 px-2.5 font-bold"
                    >
                      + Add Player
                    </button>
                  )}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {participants.map((p, idx) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between rounded-xl border border-line bg-surface-elevated p-3 text-xs"
                    >
                      <div className="truncate">
                        <p className="font-bold text-ink truncate">
                          #{idx + 1} {p.name}
                        </p>
                        {p.phone && <p className="text-[11px] text-ink-muted">{p.phone}</p>}
                      </div>
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                          p.payment_status === 'paid'
                            ? 'bg-ok/20 text-ok border border-ok/40'
                            : 'bg-warning/20 text-warning border border-warning/40'
                        }`}
                      >
                        {p.payment_status}
                      </span>
                    </div>
                  ))}

                  {participants.length === 0 && (
                    <div className="col-span-full py-8 text-center text-xs text-ink-muted">
                      No players registered yet. Tap "+ Register Player" to start the roster.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="surface-card p-12 text-center text-ink-muted space-y-3">
            <TrophyIcon className="mx-auto w-12 h-12 text-brand" />
            <p className="text-base font-bold text-ink">No tournaments created yet</p>
            <p className="text-xs text-ink-muted max-w-sm mx-auto">
              Create your first FIFA / EA FC PlayStation tournament to manage player registrations,
              generate elimination brackets, and track prize accounting.
            </p>
            {isOwner && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="btn btn-gold text-xs mt-2"
              >
                Create Tournament
              </button>
            )}
          </div>
        )}
      </div>

      {/* Create Tournament Modal */}
      {showCreateModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-display text-lg font-bold text-ink">Create New Tournament</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTournament} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Tournament Title
                </label>
                <input
                  required
                  value={newTourn.name}
                  onChange={(e) => setNewTourn({ ...newTourn, name: e.target.value })}
                  placeholder="e.g. Blackout FIFA 25 Championship"
                  className="inp text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Game</label>
                  <input
                    required
                    value={newTourn.game}
                    onChange={(e) => setNewTourn({ ...newTourn, game: e.target.value })}
                    className="inp text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">Console</label>
                  <select
                    value={newTourn.kind}
                    onChange={(e) => setNewTourn({ ...newTourn, kind: e.target.value })}
                    className="inp text-xs"
                  >
                    <option value="ps5">PS5</option>
                    <option value="ps4">PS4</option>
                    <option value="pool">Pool</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Max Players
                  </label>
                  <select
                    value={newTourn.max_players}
                    onChange={(e) => setNewTourn({ ...newTourn, max_players: e.target.value })}
                    className="inp text-xs"
                  >
                    <option value="4">4 Players</option>
                    <option value="8">8 Players</option>
                    <option value="16">16 Players</option>
                    <option value="32">32 Players</option>
                    <option value="64">64 Players</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Entry Fee (ETB)
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={newTourn.entry_fee}
                    onChange={(e) => setNewTourn({ ...newTourn, entry_fee: e.target.value })}
                    className="inp text-xs font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Prize Pool (ETB)
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={newTourn.prize_pool}
                    onChange={(e) => setNewTourn({ ...newTourn, prize_pool: e.target.value })}
                    className="inp text-xs font-bold text-ok"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Expenses (ETB)
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    value={newTourn.organizer_expenses}
                    onChange={(e) =>
                      setNewTourn({ ...newTourn, organizer_expenses: e.target.value })
                    }
                    className="inp text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Tournament Rules
                </label>
                <textarea
                  rows={2}
                  value={newTourn.rules}
                  onChange={(e) => setNewTourn({ ...newTourn, rules: e.target.value })}
                  className="inp h-auto py-2 text-xs"
                />
              </div>

              <button disabled={busy} className="btn btn-gold w-full mt-2">
                {busy ? 'Creating…' : 'Publish Tournament'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Register Player Modal */}
      {showRegisterModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-display text-lg font-bold text-ink">Register Participant</h3>
              <button
                onClick={() => setShowRegisterModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRegisterPlayer} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Player / Gamer Tag
                </label>
                <input
                  required
                  value={newPlayer.name}
                  onChange={(e) => setNewPlayer({ ...newPlayer, name: e.target.value })}
                  placeholder="e.g. Alex (ProGamer)"
                  className="inp text-sm"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-ink-muted mb-1">
                  Phone Number (optional)
                </label>
                <input
                  value={newPlayer.phone}
                  onChange={(e) => setNewPlayer({ ...newPlayer, phone: e.target.value })}
                  placeholder="0911..."
                  className="inp text-sm"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="paidCheck"
                  checked={newPlayer.paid}
                  onChange={(e) => setNewPlayer({ ...newPlayer, paid: e.target.checked })}
                  className="h-4 w-4 rounded accent-brand"
                />
                <label htmlFor="paidCheck" className="text-xs font-semibold text-ink cursor-pointer">
                  Entry fee paid ({etb(selectedTourn?.entry_fee)})
                </label>
              </div>

              {newPlayer.paid && (
                <div>
                  <label className="block text-xs font-semibold text-ink-muted mb-1">
                    Payment Method
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['cash', 'telebirr', 'cbe'] as const).map((method) => (
                      <button
                        type="button"
                        key={method}
                        onClick={() => setNewPlayer({ ...newPlayer, method })}
                        className={`btn text-xs uppercase font-bold py-2 ${
                          newPlayer.method === method
                            ? 'btn-gold'
                            : 'btn-secondary text-ink-muted'
                        }`}
                      >
                        {method === 'cbe' ? 'CBE' : method}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button disabled={busy} className="btn btn-gold w-full mt-2">
                {busy ? 'Registering…' : 'Confirm Registration'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Match Result Scoring Modal */}
      {activeMatch && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 className="font-display text-lg font-bold text-ink">
                Match #{activeMatch.match_number} Scorecard
              </h3>
              <button
                onClick={() => setActiveMatch(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-sm text-ink-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordResult} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 items-center text-center">
                <div className="surface-card p-3 space-y-2">
                  <p className="text-xs font-bold text-ink truncate">
                    {getPlayerName(activeMatch.player1_id)}
                  </p>
                  <input
                    type="number"
                    min="0"
                    value={score1}
                    onChange={(e) => setScore1(e.target.value)}
                    className="inp text-center text-2xl font-black"
                  />
                  <button
                    type="button"
                    onClick={() => setWinnerId(activeMatch.player1_id)}
                    className={`btn w-full text-xs py-1.5 ${
                      winnerId === activeMatch.player1_id ? 'btn-gold' : 'btn-secondary'
                    }`}
                  >
                    Winner
                  </button>
                </div>

                <div className="surface-card p-3 space-y-2">
                  <p className="text-xs font-bold text-ink truncate">
                    {getPlayerName(activeMatch.player2_id)}
                  </p>
                  <input
                    type="number"
                    min="0"
                    value={score2}
                    onChange={(e) => setScore2(e.target.value)}
                    className="inp text-center text-2xl font-black"
                  />
                  <button
                    type="button"
                    onClick={() => setWinnerId(activeMatch.player2_id)}
                    className={`btn w-full text-xs py-1.5 ${
                      winnerId === activeMatch.player2_id ? 'btn-gold' : 'btn-secondary'
                    }`}
                  >
                    Winner
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="walkoverCheck"
                  checked={isWalkover}
                  onChange={(e) => setIsWalkover(e.target.checked)}
                  className="h-4 w-4 rounded accent-brand"
                />
                <label htmlFor="walkoverCheck" className="text-xs text-ink-muted cursor-pointer">
                  Mark as Walkover / Forfeit
                </label>
              </div>

              <button disabled={busy || !winnerId} className="btn btn-gold w-full">
                {busy ? 'Saving Result…' : 'Record Score & Advance Winner'}
              </button>
            </form>
          </div>
        </div>
      )}
    </AppLayout>
  )
}
