create function close_shift(p_counted numeric,p_note text) returns uuid language plpgsql security definer set search_path=public as $$
declare s shifts;e numeric;begin
select * into s from shifts where employee_id=auth.uid() and status='open' for update;
if not found then raise exception 'NO_OPEN_SHIFT';end if;
if exists(select 1 from sessions where employee_id=auth.uid() and status='open') then raise exception 'OPEN_SESSIONS';end if;
if p_counted is null or p_counted<0 then raise exception 'INVALID_INPUT';end if;
select coalesce(sum(total_amount),0) into e from sessions where shift_id=s.id and status='ended' and payment_method='cash';
update shifts set status='pending_verification',closed_at=now(),expected_cash=e,counted_cash=p_counted,variance=p_counted-e,note=p_note where id=s.id;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(s.zone_id,auth.uid(),'close_shift','shift',s.id,jsonb_build_object('expected',e,'counted',p_counted));
return s.id;end$$;
create function verify_shift(p_shift uuid,p_approve boolean,p_note text) returns void language plpgsql security definer set search_path=public as $$
declare s shifts;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
select * into s from shifts where id=p_shift and zone_id=my_zone() for update;
if not found or s.status<>'pending_verification' then raise exception 'SHIFT_LOCKED';end if;
begin if p_approve then update shifts set status='settled' where id=s.id;
else update shifts set status='open',closed_at=null,note=coalesce(p_note,note) where id=s.id;end if;
exception when unique_violation then raise exception 'SHIFT_CONFLICT';end;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(s.zone_id,auth.uid(),case when p_approve then 'settle_shift' else 'reject_shift' end,'shift',s.id,jsonb_build_object('variance',s.variance));end$$;
grant execute on function close_shift,verify_shift to authenticated;
alter publication supabase_realtime add table shifts;
