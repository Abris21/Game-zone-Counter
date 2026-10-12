-- Migration 012: Tournament Management System (Single Elimination, Participant Registration, Brackets & Accounting)

create table if table_exists_placeholder (dummy int); -- safety guard
drop table if exists table_exists_placeholder;

-- 1. Tournaments table
create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references game_zones,
  name text not null,
  description text,
  game text not null default 'EA FC / FIFA',
  kind text not null default 'ps5' check(kind in('ps4','ps5','pool','other')),
  format text not null default 'single_elimination' check(format in('single_elimination')),
  max_players int not null default 16 check(max_players between 4 and 128),
  entry_fee numeric(12,2) not null default 0 check(entry_fee >= 0),
  prize_pool numeric(12,2) not null default 0 check(prize_pool >= 0),
  organizer_expenses numeric(12,2) not null default 0 check(organizer_expenses >= 0),
  status text not null default 'registration_open' check(status in('draft','registration_open','in_progress','completed','cancelled')),
  rules text,
  starts_at timestamptz,
  registration_closes_at timestamptz,
  winner_id uuid,
  created_at timestamptz not null default now()
);

-- 2. Tournament participants table
create table if not exists tournament_participants (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  zone_id uuid not null references game_zones,
  name text not null,
  phone text,
  seed int,
  payment_status text not null default 'unpaid' check(payment_status in('unpaid','paid','refunded')),
  payment_method text check(payment_method in('cash','telebirr','cbe')),
  registered_at timestamptz not null default now(),
  unique (tournament_id, name)
);

-- Foreign key on tournaments.winner_id
alter table tournaments drop constraint if exists fk_tournament_winner;
alter table tournaments add constraint fk_tournament_winner foreign key (winner_id) references tournament_participants(id) on delete set null;

-- 3. Tournament matches table
create table if not exists tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments on delete cascade,
  zone_id uuid not null references game_zones,
  round int not null check(round >= 1),
  match_number int not null,
  player1_id uuid references tournament_participants(id) on delete set null,
  player2_id uuid references tournament_participants(id) on delete set null,
  score1 int check(score1 >= 0),
  score2 int check(score2 >= 0),
  winner_id uuid references tournament_participants(id) on delete set null,
  station_id uuid references stations(id) on delete set null,
  status text not null default 'pending' check(status in('pending','in_progress','completed','walkover')),
  next_match_id uuid references tournament_matches(id) on delete set null,
  next_match_slot int check(next_match_slot in(1, 2)),
  created_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_tournaments_zone on tournaments(zone_id, created_at desc);
create index if not exists idx_participants_tourn on tournament_participants(tournament_id);
create index if not exists idx_matches_tourn on tournament_matches(tournament_id, round, match_number);

-- RLS
alter table tournaments enable row level security;
alter table tournament_participants enable row level security;
alter table tournament_matches enable row level security;

create policy tn_sel on tournaments for select using(zone_id = my_zone() or my_role() = 'super_admin');
create policy tn_all on tournaments for all using(zone_id = my_zone() and my_role() = 'admin') with check(zone_id = my_zone() and my_role() = 'admin');

create policy tp_sel on tournament_participants for select using(zone_id = my_zone());
create policy tp_all on tournament_participants for all using(zone_id = my_zone()) with check(zone_id = my_zone());

create policy tm_sel on tournament_matches for select using(zone_id = my_zone());
create policy tm_all on tournament_matches for all using(zone_id = my_zone()) with check(zone_id = my_zone());

-- Realtime publication
alter publication supabase_realtime add table tournaments;
alter publication supabase_realtime add table tournament_participants;
alter publication supabase_realtime add table tournament_matches;

-- 4. Participant Registration RPC
create or replace function register_tournament_player(
  p_tournament uuid,
  p_name text,
  p_phone text,
  p_paid boolean,
  p_method text
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  t tournaments;
  current_count int;
  pid uuid;
  z uuid := my_zone();
begin
  if z is null then raise exception 'NOT_ALLOWED'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'INVALID_INPUT'; end if;

  select * into t from tournaments where id = p_tournament and zone_id = z for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if t.status in ('in_progress', 'completed', 'cancelled') then raise exception 'TOURNAMENT_REGISTRATION_CLOSED'; end if;

  select count(*) into current_count from tournament_participants where tournament_id = t.id;
  if current_count >= t.max_players then raise exception 'TOURNAMENT_FULL'; end if;

  if exists(select 1 from tournament_participants where tournament_id = t.id and lower(name) = lower(trim(p_name))) then
    raise exception 'PLAYER_ALREADY_REGISTERED';
  end if;

  if p_paid and (p_method not in ('cash','telebirr','cbe') or p_method is null) then
    raise exception 'INVALID_INPUT';
  end if;

  insert into tournament_participants(
    tournament_id,
    zone_id,
    name,
    phone,
    seed,
    payment_status,
    payment_method
  ) values(
    t.id,
    z,
    trim(p_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    current_count + 1,
    case when p_paid then 'paid' else 'unpaid' end,
    case when p_paid then p_method else null end
  ) returning id into pid;

  return pid;
end$$;

-- 5. Bracket Generation RPC (Single Elimination)
create or replace function generate_tournament_bracket(p_tournament uuid) returns void language plpgsql security definer set search_path=public as $$
declare
  t tournaments;
  p_count int;
  bracket_size int := 2;
  total_rounds int := 1;
  r int;
  m int;
  matches_in_round int;
  new_match_id uuid;
  p_cursor int := 0;
  p_ids uuid[];
  next_round_match_ids uuid[];
  cur_round_match_ids uuid[];
  p1 uuid;
  p2 uuid;
  z uuid := my_zone();
begin
  if my_role() <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  select * into t from tournaments where id = p_tournament and zone_id = z for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if t.status in ('in_progress', 'completed') then raise exception 'TOURNAMENT_ALREADY_STARTED'; end if;

  -- Delete any pre-existing matches for this tournament
  delete from tournament_matches where tournament_id = t.id;

  -- Load participants ordered by seed or id
  select array_agg(id order by seed nulls last, registered_at) into p_ids
  from tournament_participants
  where tournament_id = t.id;

  p_count := coalesce(array_length(p_ids, 1), 0);
  if p_count < 2 then raise exception 'Need at least 2 players to start a tournament.'; end if;

  -- Find nearest power of 2 (e.g. 2, 4, 8, 16, 32)
  while bracket_size < p_count loop
    bracket_size := bracket_size * 2;
    total_rounds := total_rounds + 1;
  end loop;

  -- Create matches round by round from Final (round = total_rounds) down to Round 1
  -- Final: 1 match
  next_round_match_ids := array[]::uuid[];
  for r in reverse total_rounds..1 loop
    matches_in_round := bracket_size / (2 ^ r);
    cur_round_match_ids := array[]::uuid[];

    for m in 1..matches_in_round loop
      declare
        next_m_id uuid := null;
        slot int := null;
      begin
        if array_length(next_round_match_ids, 1) is not null then
          -- Match m links to match ceil(m/2) in next round
          next_m_id := next_round_match_ids[((m - 1) / 2) + 1];
          slot := case when (m % 2) = 1 then 1 else 2 end;
        end if;

        -- For round 1, seed participants
        p1 := null;
        p2 := null;
        if r = 1 then
          p_cursor := p_cursor + 1;
          if p_cursor <= p_count then p1 := p_ids[p_cursor]; end if;
          p_cursor := p_cursor + 1;
          if p_cursor <= p_count then p2 := p_ids[p_cursor]; end if;
        end if;

        insert into tournament_matches(
          tournament_id,
          zone_id,
          round,
          match_number,
          player1_id,
          player2_id,
          status,
          next_match_id,
          next_match_slot
        ) values (
          t.id,
          z,
          r,
          m,
          p1,
          p2,
          case 
            when r = 1 and p1 is not null and p2 is null then 'completed' -- bye
            else 'pending'
          end,
          next_m_id,
          slot
        ) returning id into new_match_id;

        -- If bye in round 1, automatically advance p1 as winner
        if r = 1 and p1 is not null and p2 is null then
          update tournament_matches set winner_id = p1 where id = new_match_id;
        end if;

        cur_round_match_ids := array_append(cur_round_match_ids, new_match_id);
      end;
    end loop;

    next_round_match_ids := cur_round_match_ids;
  end loop;

  -- Advance any byes into round 2
  for new_match_id in 
    select id from tournament_matches where tournament_id = t.id and round = 1 and status = 'completed' and winner_id is not null
  loop
    declare
      m_rec tournament_matches;
    begin
      select * into m_rec from tournament_matches where id = new_match_id;
      if m_rec.next_match_id is not null then
        if m_rec.next_match_slot = 1 then
          update tournament_matches set player1_id = m_rec.winner_id where id = m_rec.next_match_id;
        else
          update tournament_matches set player2_id = m_rec.winner_id where id = m_rec.next_match_id;
        end if;
      end if;
    end;
  end loop;

  update tournaments set status = 'in_progress' where id = t.id;
  
  insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
  values(z, auth.uid(), 'generate_bracket', 'tournament', t.id, jsonb_build_object('rounds', total_rounds, 'players', p_count));
end$$;

-- 6. Match Result Recording and Winner Progression RPC
create or replace function record_match_result(
  p_match uuid,
  p_score1 int,
  p_score2 int,
  p_winner uuid,
  p_walkover boolean default false
) returns void language plpgsql security definer set search_path=public as $$
declare
  m tournament_matches;
  t tournaments;
  z uuid := my_zone();
begin
  select * into m from tournament_matches where id = p_match and zone_id = z for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if m.player1_id is null or m.player2_id is null then raise exception 'INVALID_MATCH_RESULT'; end if;
  if p_winner not in (m.player1_id, m.player2_id) then raise exception 'INVALID_MATCH_RESULT'; end if;

  select * into t from tournaments where id = m.tournament_id for update;

  update tournament_matches
  set score1 = greatest(0, coalesce(p_score1, 0)),
      score2 = greatest(0, coalesce(p_score2, 0)),
      winner_id = p_winner,
      status = case when p_walkover then 'walkover' else 'completed' end
  where id = m.id;

  -- Advance winner to next match if present
  if m.next_match_id is not null then
    if m.next_match_slot = 1 then
      update tournament_matches set player1_id = p_winner where id = m.next_match_id;
    else
      update tournament_matches set player2_id = p_winner where id = m.next_match_id;
    end if;
  else
    -- Final match! Declare tournament winner
    update tournaments set winner_id = p_winner, status = 'completed' where id = t.id;
    insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
    values(z, auth.uid(), 'tournament_completed', 'tournament', t.id, jsonb_build_object('winner_id', p_winner));
  end if;

  insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
  values(z, auth.uid(), 'record_match_result', 'tournament_match', m.id, jsonb_build_object(
    'score1', p_score1,
    'score2', p_score2,
    'winner_id', p_winner,
    'walkover', p_walkover
  ));
end$$;

-- 7. Tournament Financial Accounting RPC
create or replace function tournament_financials(p_tournament uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  t tournaments;
  reg_count int;
  paid_count int;
  unpaid_count int;
  gross numeric(12,2);
  net numeric(12,2);
  z uuid := my_zone();
begin
  select * into t from tournaments where id = p_tournament and zone_id = z;
  if not found then raise exception 'NOT_ALLOWED'; end if;

  select count(*),
         count(*) filter (where payment_status = 'paid'),
         count(*) filter (where payment_status = 'unpaid')
  into reg_count, paid_count, unpaid_count
  from tournament_participants
  where tournament_id = t.id;

  gross := paid_count * t.entry_fee;
  net := gross - t.prize_pool - t.organizer_expenses;

  return jsonb_build_object(
    'registered_count', reg_count,
    'paid_count', paid_count,
    'unpaid_count', unpaid_count,
    'entry_fee', t.entry_fee,
    'gross_revenue', gross,
    'prize_pool', t.prize_pool,
    'organizer_expenses', t.organizer_expenses,
    'net_profit', net
  );
end$$;

grant execute on function register_tournament_player, generate_tournament_bracket, record_match_result, tournament_financials to authenticated;
