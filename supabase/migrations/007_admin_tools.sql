alter table profiles add column must_change_password boolean not null default false;
alter table sales add column voided_at timestamptz;
create or replace function my_zone() returns uuid language sql stable security definer set search_path=public as $$select p.zone_id from profiles p join game_zones g on g.id=p.zone_id where p.id=auth.uid() and p.is_active and p.deleted_at is null and g.status='active' and g.deleted_at is null$$;
create function zone_ok() returns boolean language sql stable security definer set search_path=public as $$select my_zone() is not null$$;
create function clear_must_change() returns void language sql security definer set search_path=public as $$update profiles set must_change_password=false where id=auth.uid()$$;
create function update_zone(p_name text,p_location text) returns void language plpgsql security definer set search_path=public as $$begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
if length(trim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'INVALID_INPUT';end if;
update game_zones set name=trim(p_name),location=nullif(trim(coalesce(p_location,'')),'') where id=my_zone();
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(my_zone(),auth.uid(),'update_zone','game_zone',my_zone(),jsonb_build_object('name',p_name,'location',p_location));end$$;
create function _recalc_shift(p_shift uuid) returns void language plpgsql security definer set search_path=public as $$declare e numeric;begin
select coalesce((select sum(total_amount) from sessions where shift_id=p_shift and status='ended' and payment_method='cash'),0)+coalesce((select sum(total) from sales where shift_id=p_shift and payment_method='cash' and voided_at is null),0) into e;
update shifts set expected_cash=e,variance=counted_cash-e where id=p_shift and status='pending_verification';end$$;
create function _void_sale(p_sale uuid) returns void language plpgsql security definer set search_path=public as $$begin
update inventory_items i set stock_qty=i.stock_qty+x.q from(select item_id,sum(qty)::int q from sale_items where sale_id=p_sale group by 1) x where i.id=x.item_id and i.track_stock and exists(select 1 from sales where id=p_sale and voided_at is null);
update sales set voided_at=now() where id=p_sale and voided_at is null;end$$;
revoke execute on function _recalc_shift,_void_sale from public,anon,authenticated;
create function edit_session(p_session uuid,p_games int,p_method text,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare s sessions;sh text;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
if length(trim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED';end if;
if p_games<0 or p_games>200 or p_method not in('cash','telebirr','cbe') then raise exception 'INVALID_INPUT';end if;
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found or s.status<>'ended' then raise exception 'NOT_ALLOWED';end if;
select status into sh from shifts where id=s.shift_id;if sh='settled' then raise exception 'SHIFT_LOCKED';end if;
update sessions set games_count=p_games,total_amount=p_games*price_snapshot,payment_method=p_method where id=s.id;
update sales set payment_method=p_method where session_id=s.id;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,previous_state,new_state,reason) values(s.zone_id,auth.uid(),'edit_session','session',s.id,jsonb_build_object('games',s.games_count,'total',s.total_amount,'method',s.payment_method),jsonb_build_object('games',p_games,'total',p_games*s.price_snapshot,'method',p_method),p_reason);
if s.shift_id is not null then perform _recalc_shift(s.shift_id);end if;end$$;
create function void_session(p_session uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare s sessions;sh text;r record;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
if length(trim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED';end if;
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found or s.status<>'ended' then raise exception 'NOT_ALLOWED';end if;
select status into sh from shifts where id=s.shift_id;if sh='settled' then raise exception 'SHIFT_LOCKED';end if;
for r in select id from sales where session_id=s.id loop perform _void_sale(r.id);end loop;
update sessions set status='cancelled',total_amount=0 where id=s.id;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,previous_state,reason) values(s.zone_id,auth.uid(),'void_session','session',s.id,jsonb_build_object('games',s.games_count,'total',s.total_amount,'method',s.payment_method),p_reason);
if s.shift_id is not null then perform _recalc_shift(s.shift_id);end if;end$$;
create function void_sale(p_sale uuid,p_reason text) returns void language plpgsql security definer set search_path=public as $$
declare s sales;sh text;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
if length(trim(coalesce(p_reason,'')))<3 then raise exception 'REASON_REQUIRED';end if;
select * into s from sales where id=p_sale and zone_id=my_zone() for update;
if not found or s.voided_at is not null or s.payment_method is null then raise exception 'NOT_ALLOWED';end if;
select status into sh from shifts where id=s.shift_id;if sh='settled' then raise exception 'SHIFT_LOCKED';end if;
perform _void_sale(s.id);
insert into audit_logs(zone_id,user_id,action,entity,entity_id,previous_state,reason) values(s.zone_id,auth.uid(),'void_sale','sale',s.id,jsonb_build_object('total',s.total,'method',s.payment_method),p_reason);
if s.shift_id is not null then perform _recalc_shift(s.shift_id);end if;end$$;
create or replace function close_shift(p_counted numeric,p_note text) returns uuid language plpgsql security definer set search_path=public as $$
declare s shifts;e numeric;begin
select * into s from shifts where employee_id=auth.uid() and status='open' for update;
if not found then raise exception 'NO_OPEN_SHIFT';end if;
if exists(select 1 from sessions where employee_id=auth.uid() and status='open') then raise exception 'OPEN_SESSIONS';end if;
if p_counted is null or p_counted<0 then raise exception 'INVALID_INPUT';end if;
select coalesce((select sum(total_amount) from sessions where shift_id=s.id and status='ended' and payment_method='cash'),0)+coalesce((select sum(total) from sales where shift_id=s.id and payment_method='cash' and voided_at is null),0) into e;
update shifts set status='pending_verification',closed_at=now(),expected_cash=e,counted_cash=p_counted,variance=p_counted-e,note=p_note where id=s.id;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(s.zone_id,auth.uid(),'close_shift','shift',s.id,jsonb_build_object('expected',e,'counted',p_counted));
return s.id;end$$;
create or replace function snack_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare z uuid:=my_zone();tz text;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
select timezone into tz from game_zones where id=z;
return (select jsonb_build_object('revenue',coalesce(sum(si.qty*si.unit_price_snapshot),0),'cost',coalesce(sum(si.qty*si.unit_cost_snapshot),0)) from sale_items si join sales s on s.id=si.sale_id where s.zone_id=z and s.voided_at is null and (s.created_at at time zone tz)::date between p_from and p_to and s.payment_method is not null);end$$;
grant execute on function zone_ok,clear_must_change,update_zone,edit_session,void_session,void_sale to authenticated;
