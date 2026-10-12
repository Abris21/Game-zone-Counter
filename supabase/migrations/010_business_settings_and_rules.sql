-- Migration 010: Configurable business rules, FIFA extra-time policies, and shift reconciliation fixes

-- 1. Business rules columns on game_zones
alter table game_zones 
  add column if not exists reopen_window_minutes int not null default 5,
  add column if not exists pause_allowed boolean not null default true,
  add column if not exists max_pause_minutes int not null default 15,
  add column if not exists fifa_extra_time_rule text not null default 'free' check (fifa_extra_time_rule in ('free','half_price','full_price','flat_fee')),
  add column if not exists fifa_extra_time_flat_fee numeric(12,2) not null default 0,
  add column if not exists fifa_penalties_rule text not null default 'free' check (fifa_penalties_rule in ('free','half_price','full_price','flat_fee')),
  add column if not exists fifa_penalties_flat_fee numeric(12,2) not null default 0,
  add column if not exists handover_requires_confirmation boolean not null default false;

-- 2. Update reopen_session to respect zone's reopen_window_minutes
create or replace function reopen_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare
  s sessions;
  sh text;
  win int;
begin
  select * into s from sessions where id=p_session and zone_id=my_zone() for update;
  if not found or s.status<>'ended' or (s.employee_id<>auth.uid() and my_role()<>'admin') then
    raise exception 'NOT_ALLOWED';
  end if;

  select coalesce(reopen_window_minutes, 5) into win from game_zones where id=s.zone_id;
  if now() - s.ended_at > (win || ' minutes')::interval and my_role()<>'admin' then
    raise exception 'REOPEN_EXPIRED';
  end if;

  select status into sh from shifts where id=s.shift_id;
  if sh is distinct from 'open' and sh is distinct from 'rejected' then
    raise exception 'SHIFT_LOCKED';
  end if;

  begin
    update sessions set status='open', ended_at=null, total_amount=null, payment_method=null where id=s.id;
  exception when unique_violation then
    raise exception 'UNIT_BUSY';
  end;

  update sales set payment_method=null where session_id=s.id and voided_at is null;
  insert into session_events(session_id,type,employee_id) values(s.id,'reopen',auth.uid());
end$$;

-- 3. Fix shift rejection bug: Allow 'rejected' status so shifts sent back don't violate one_open_shift
alter table shifts drop constraint if exists shifts_status_check;
alter table shifts add constraint shifts_status_check check (status in ('open','pending_verification','settled','rejected'));

create or replace function verify_shift(p_shift uuid, p_approve boolean, p_note text) returns void language plpgsql security definer set search_path=public as $$
declare
  s shifts;
  has_open boolean;
begin
  if my_role()<>'admin' then raise exception 'NOT_ALLOWED'; end if;
  select * into s from shifts where id=p_shift and zone_id=my_zone() for update;
  if not found or s.status<>'pending_verification' then raise exception 'SHIFT_LOCKED'; end if;

  if p_approve then
    update shifts set status='settled' where id=s.id;
  else
    -- If employee already has an open shift, set this rejected shift to 'rejected' to avoid unique violation
    select exists(select 1 from shifts where employee_id=s.employee_id and status='open') into has_open;
    if has_open then
      update shifts set status='rejected', note=coalesce(p_note, note) where id=s.id;
    else
      update shifts set status='open', closed_at=null, note=coalesce(p_note, note) where id=s.id;
    end if;
  end if;

  insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state, reason)
  values(
    s.zone_id,
    auth.uid(),
    case when p_approve then 'settle_shift' else 'reject_shift' end,
    'shift',
    s.id,
    jsonb_build_object('status', case when p_approve then 'settled' else 'rejected' end, 'variance', s.variance),
    p_note
  );
end$$;

-- 4. Update zone settings RPC
create or replace function update_zone_settings(
  p_name text,
  p_location text,
  p_currency text,
  p_timezone text,
  p_reopen_window int,
  p_fifa_extra_rule text,
  p_fifa_extra_fee numeric,
  p_fifa_penalty_rule text,
  p_fifa_penalty_fee numeric
) returns void language plpgsql security definer set search_path=public as $$
declare
  z uuid := my_zone();
begin
  if my_role()<>'admin' then raise exception 'NOT_ALLOWED'; end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then raise exception 'INVALID_INPUT'; end if;
  if p_reopen_window not between 1 and 60 then raise exception 'INVALID_INPUT'; end if;
  if p_fifa_extra_rule not in ('free','half_price','full_price','flat_fee') then raise exception 'INVALID_INPUT'; end if;
  if p_fifa_penalty_rule not in ('free','half_price','full_price','flat_fee') then raise exception 'INVALID_INPUT'; end if;

  update game_zones
  set name = trim(p_name),
      location = nullif(trim(coalesce(p_location, '')), ''),
      currency = coalesce(nullif(trim(p_currency), ''), 'ETB'),
      timezone = coalesce(nullif(trim(p_timezone), ''), 'Africa/Addis_Ababa'),
      reopen_window_minutes = p_reopen_window,
      fifa_extra_time_rule = p_fifa_extra_rule,
      fifa_extra_time_flat_fee = greatest(0, coalesce(p_fifa_extra_fee, 0)),
      fifa_penalties_rule = p_fifa_penalty_rule,
      fifa_penalties_flat_fee = greatest(0, coalesce(p_fifa_penalty_fee, 0))
  where id = z;

  insert into audit_logs(zone_id, user_id, action, entity, entity_id, new_state)
  values(z, auth.uid(), 'update_zone_settings', 'game_zone', z, jsonb_build_object(
    'name', p_name,
    'location', p_location,
    'reopen_window_minutes', p_reopen_window,
    'fifa_extra_time_rule', p_fifa_extra_rule,
    'fifa_penalties_rule', p_fifa_penalty_rule
  ));
end$$;

grant execute on function update_zone_settings to authenticated;
