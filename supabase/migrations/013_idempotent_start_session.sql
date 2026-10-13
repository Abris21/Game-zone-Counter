-- Make the start_session RPC compatible with the offline queue's idempotency key.
-- Replace the old one-argument function to avoid PostgREST overload ambiguity.
drop function if exists start_session(uuid);

create function start_session(
  p_station uuid,
  p_idempotency_key text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  s stations;
  v uuid;
  sh uuid;
begin
  select * into s
  from stations
  where id = p_station
    and zone_id = my_zone()
    and not is_archived;

  if not found then raise exception 'NOT_ALLOWED'; end if;

  -- A retry after a timeout should return the session created by the first call.
  if p_idempotency_key is not null then
    select id into v
    from sessions
    where zone_id = s.zone_id
      and station_id = s.id
      and idempotency_key = p_idempotency_key;
    if found then return v; end if;
  end if;

  sh := open_shift();
  begin
    insert into sessions(zone_id, station_id, employee_id, shift_id, price_snapshot, idempotency_key)
    values(s.zone_id, s.id, auth.uid(), sh, s.price, p_idempotency_key)
    returning id into v;
  exception when unique_violation then
    -- Handle concurrent delivery of the same queued operation.
    if p_idempotency_key is not null then
      select id into v
      from sessions
      where zone_id = s.zone_id
        and station_id = s.id
        and idempotency_key = p_idempotency_key;
      if found then return v; end if;
    end if;
    raise exception 'UNIT_BUSY';
  end;

  insert into session_events(session_id, type, employee_id)
  values(v, 'start', auth.uid());
  return v;
end;
$$;

grant execute on function start_session(uuid, text) to authenticated;
notify pgrst, 'reload schema';
