-- Migration 011: Session lifecycle enhancements (pause/resume, FIFA tie-break charges) and server-side idempotency

-- 1. Session and Sales idempotency and lifecycle columns
alter table sessions
  add column if not exists paused_at timestamptz,
  add column if not exists total_paused_seconds int not null default 0,
  add column if not exists fifa_extra_time_applied boolean not null default false,
  add column if not exists fifa_penalties_applied boolean not null default false,
  add column if not exists fifa_extra_charge numeric(12,2) not null default 0,
  add column if not exists idempotency_key text;

create unique index if not exists sessions_idempotency_idx on sessions(zone_id, idempotency_key) where idempotency_key is not null;

alter table sales
  add column if not exists idempotency_key text;

create unique index if not exists sales_idempotency_idx on sales(zone_id, idempotency_key) where idempotency_key is not null;

-- 2. Pause and Resume Session RPCs
create or replace function pause_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare
  s sessions;
begin
  select * into s from sessions where id=p_session and zone_id=my_zone() for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if s.status <> 'open' then raise exception 'SESSION_ALREADY_ENDED'; end if;
  if s.paused_at is not null then return; end if; -- already paused

  update sessions set paused_at = now() where id = s.id;
  insert into session_events(session_id, type, employee_id) values(s.id, 'pause', auth.uid());
end$$;

create or replace function resume_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare
  s sessions;
  elapsed int;
begin
  select * into s from sessions where id=p_session and zone_id=my_zone() for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if s.status <> 'open' then raise exception 'SESSION_ALREADY_ENDED'; end if;
  if s.paused_at is null then return; end if; -- not paused

  elapsed := greatest(0, extract(epoch from (now() - s.paused_at))::int);
  update sessions 
  set paused_at = null,
      total_paused_seconds = s.total_paused_seconds + elapsed
  where id = s.id;

  insert into session_events(session_id, type, employee_id) values(s.id, 'resume', auth.uid());
end$$;

-- 3. FIFA extra-time and penalties rule application
create or replace function apply_fifa_rule(p_session uuid, p_rule text) returns numeric language plpgsql security definer set search_path=public as $$
declare
  s sessions;
  z game_zones;
  charge numeric(12,2) := 0;
  rule_type text;
  fee numeric(12,2);
begin
  if p_rule not in ('extra_time', 'penalties') then raise exception 'INVALID_INPUT'; end if;
  select * into s from sessions where id=p_session and zone_id=my_zone() for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if s.status <> 'open' then raise exception 'SESSION_ALREADY_ENDED'; end if;

  select * into z from game_zones where id=s.zone_id;

  if p_rule = 'extra_time' then
    if s.fifa_extra_time_applied then return s.fifa_extra_charge; end if;
    rule_type := z.fifa_extra_time_rule;
    fee := z.fifa_extra_time_flat_fee;
  else
    if s.fifa_penalties_applied then return s.fifa_extra_charge; end if;
    rule_type := z.fifa_penalties_rule;
    fee := z.fifa_penalties_flat_fee;
  end if;

  if rule_type = 'half_price' then
    charge := round(s.price_snapshot / 2.0, 2);
  elsif rule_type = 'full_price' then
    charge := s.price_snapshot;
  elsif rule_type = 'flat_fee' then
    charge := fee;
  else
    charge := 0; -- 'free'
  end if;

  update sessions
  set fifa_extra_charge = s.fifa_extra_charge + charge,
      fifa_extra_time_applied = case when p_rule='extra_time' then true else fifa_extra_time_applied end,
      fifa_penalties_applied = case when p_rule='penalties' then true else fifa_penalties_applied end
  where id = s.id;

  insert into session_events(session_id, type, employee_id, delta)
  values(s.id, 'fifa_' || p_rule, auth.uid(), charge::int);

  return s.fifa_extra_charge + charge;
end$$;

-- 4. Idempotent end_session
create or replace function end_session_idempotent(
  p_session uuid,
  p_method text,
  p_idempotency_key text default null
) returns numeric language plpgsql security definer set search_path=public as $$
declare
  s sessions;
  t numeric;
  existing_id uuid;
begin
  -- If idempotency key provided and session was already ended with it, return existing total
  if p_idempotency_key is not null then
    select total_amount into t from sessions where zone_id=my_zone() and idempotency_key=p_idempotency_key and status in ('ended','cancelled');
    if found then return coalesce(t, 0); end if;
  end if;

  select * into s from sessions where id=p_session and zone_id=my_zone() for update;
  if not found then raise exception 'NOT_ALLOWED'; end if;
  if s.status <> 'open' then
    -- Already ended/cancelled, return existing total safely
    return coalesce(s.total_amount, 0);
  end if;

  if p_method not in ('cash','telebirr','cbe') then raise exception 'INVALID_INPUT'; end if;

  -- Resume if paused
  if s.paused_at is not null then
    perform resume_session(s.id);
  end if;

  if s.games_count = 0 and s.fifa_extra_charge = 0 and not exists(select 1 from sales where session_id=s.id and voided_at is null) then
    update sessions set status='cancelled', ended_at=now(), total_amount=0, idempotency_key=p_idempotency_key where id=s.id;
    t := 0;
  else
    t := (s.games_count * s.price_snapshot) + s.fifa_extra_charge;
    update sessions
    set status = 'ended',
        ended_at = now(),
        total_amount = t,
        payment_method = p_method,
        idempotency_key = p_idempotency_key
    where id = s.id;
    update sales set payment_method = p_method where session_id = s.id and voided_at is null;
  end if;

  insert into session_events(session_id, type, employee_id) values(s.id, 'end', auth.uid());
  return t;
end$$;

-- 5. Idempotent add_sale
create or replace function add_sale_idempotent(
  p_items jsonb,
  p_session uuid,
  p_method text,
  p_idempotency_key text default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare
  z uuid := my_zone();
  sh uuid;
  sid uuid;
  t numeric := 0;
  i jsonb;
  it inventory_items;
  q int;
  ses sessions;
begin
  if z is null then raise exception 'NOT_ALLOWED'; end if;

  -- Check existing idempotency
  if p_idempotency_key is not null then
    select id into sid from sales where zone_id=z and idempotency_key=p_idempotency_key and voided_at is null;
    if found then return sid; end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'INVALID_INPUT'; end if;

  if p_session is not null then
    select * into ses from sessions where id=p_session and zone_id=z and status='open' for update;
    if not found then raise exception 'SESSION_ALREADY_ENDED'; end if;
    sh := ses.shift_id;
  else
    if p_method not in ('cash','telebirr','cbe') then raise exception 'INVALID_INPUT'; end if;
    sh := open_shift();
  end if;

  insert into sales(zone_id, shift_id, session_id, employee_id, payment_method, idempotency_key)
  values(z, sh, p_session, auth.uid(), case when p_session is null then p_method end, p_idempotency_key)
  returning id into sid;

  for i in select * from jsonb_array_elements(p_items) loop
    q := (i->>'qty')::int;
    if q < 1 or q > 50 then raise exception 'INVALID_INPUT'; end if;

    select * into it from inventory_items where id=(i->>'item_id')::uuid and zone_id=z and not is_archived for update;
    if not found then raise exception 'NOT_ALLOWED'; end if;

    if it.track_stock then
      if it.stock_qty < q then raise exception 'OUT_OF_STOCK'; end if;
      update inventory_items set stock_qty = stock_qty - q where id = it.id;
    end if;

    insert into sale_items(sale_id, item_id, qty, unit_price_snapshot, unit_cost_snapshot)
    values(sid, it.id, q, it.sell_price, it.cost_price);
    t := t + q * it.sell_price;
  end loop;

  update sales set total = t where id = sid;
  return sid;
end$$;

grant execute on function pause_session, resume_session, apply_fifa_rule, end_session_idempotent, add_sale_idempotent to authenticated;
