create function reopen_session(p_session uuid) returns void language plpgsql security definer set search_path=public as $$
declare s sessions;sh text;begin
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found or s.status<>'ended' or (s.employee_id<>auth.uid() and my_role()<>'admin') then raise exception 'NOT_ALLOWED';end if;
if now()-s.ended_at>interval '5 minutes' and my_role()<>'admin' then raise exception 'REOPEN_EXPIRED';end if;
select status into sh from shifts where id=s.shift_id;if sh is distinct from 'open' then raise exception 'SHIFT_LOCKED';end if;
begin update sessions set status='open',ended_at=null,total_amount=null,payment_method=null where id=s.id;exception when unique_violation then raise exception 'UNIT_BUSY';end;
update sales set payment_method=null where session_id=s.id and voided_at is null;
insert into session_events(session_id,type,employee_id) values(s.id,'reopen',auth.uid());end$$;
create function handover_session(p_session uuid,p_to uuid) returns void language plpgsql security definer set search_path=public as $$
declare s sessions;sh uuid;begin
select * into s from sessions where id=p_session and zone_id=my_zone() and status='open' for update;
if not found or (s.employee_id<>auth.uid() and my_role()<>'admin') then raise exception 'NOT_ALLOWED';end if;
if not exists(select 1 from profiles where id=p_to and zone_id=s.zone_id and role='employee' and is_active and deleted_at is null) then raise exception 'NOT_ALLOWED';end if;
select id into sh from shifts where employee_id=p_to and status='open';
if sh is null then insert into shifts(zone_id,employee_id) values(s.zone_id,p_to) returning id into sh;end if;
update sessions set employee_id=p_to,shift_id=sh where id=s.id;update sales set shift_id=sh where session_id=s.id;
insert into session_events(session_id,type,employee_id) values(s.id,'handover',auth.uid());
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(s.zone_id,auth.uid(),'handover_session','session',s.id,jsonb_build_object('to',p_to));end$$;
grant execute on function reopen_session,handover_session to authenticated;
