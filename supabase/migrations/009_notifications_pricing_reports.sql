-- Notifications
create table notifications(id uuid primary key default gen_random_uuid(),zone_id uuid not null,user_id uuid not null,type text not null,title text not null,body text,read_at timestamptz,created_at timestamptz not null default now());
create index on notifications(user_id,created_at desc);
alter table notifications enable row level security;
create policy nt_sel on notifications for select using(user_id=auth.uid());
create policy nt_upd on notifications for update using(user_id=auth.uid()) with check(user_id=auth.uid());
create function _notify_admins(p_zone uuid,p_type text,p_title text,p_body text) returns void language sql security definer set search_path=public as $$insert into notifications(zone_id,user_id,type,title,body) select p_zone,id,p_type,p_title,p_body from profiles where zone_id=p_zone and role='admin' and is_active and deleted_at is null$$;
revoke execute on function _notify_admins from public,anon,authenticated;
create function trg_shift_notify() returns trigger language plpgsql security definer set search_path=public as $$
declare n text;begin
select full_name into n from profiles where id=new.employee_id;
if new.status='pending_verification' and old.status is distinct from 'pending_verification' then
 perform _notify_admins(new.zone_id,'shift_submitted',coalesce(n,'An employee')||' submitted the day',case when new.variance=0 then 'Cash matches.' else 'Cash difference: '||new.variance||' ETB.' end);
elsif old.status='pending_verification' and new.status='settled' then
 insert into notifications(zone_id,user_id,type,title,body) values(new.zone_id,new.employee_id,'shift_settled','Your day was settled','The owner checked your cash.');
elsif old.status='pending_verification' and new.status='open' then
 insert into notifications(zone_id,user_id,type,title,body) values(new.zone_id,new.employee_id,'shift_rejected','Your day was sent back','Please check the day and submit again.');
end if;return new;end$$;
create trigger shift_notify after update of status on shifts for each row execute function trg_shift_notify();
create function trg_stock_notify() returns trigger language plpgsql security definer set search_path=public as $$begin
if new.track_stock and new.stock_qty<=new.low_stock_threshold and (old.stock_qty>old.low_stock_threshold or not old.track_stock) then perform _notify_admins(new.zone_id,'low_stock','Running low: '||new.name,new.stock_qty||' left.');end if;return new;end$$;
create trigger stock_notify after update of stock_qty on inventory_items for each row execute function trg_stock_notify();
alter publication supabase_realtime add table notifications;
-- Prices per unit type with per-unit override
alter table stations add column price_override numeric(12,2) check(price_override>=0);
update stations set price_override=price;
create table unit_prices(zone_id uuid not null references game_zones,kind text not null check(kind in('ps4','ps5','pool','other')),price numeric(12,2) not null check(price>=0),primary key(zone_id,kind));
alter table unit_prices enable row level security;
create policy up_sel on unit_prices for select using(zone_id=my_zone());
create policy up_adm on unit_prices for all using(zone_id=my_zone() and my_role()='admin') with check(zone_id=my_zone() and my_role()='admin');
create function stations_price() returns trigger language plpgsql as $$begin
if new.price_override is not null then new.price:=new.price_override;
else new.price:=coalesce((select u.price from unit_prices u where u.zone_id=new.zone_id and u.kind=new.kind),new.price);end if;return new;end$$;
create trigger st_price before insert or update of price_override,kind on stations for each row execute function stations_price();
create function unit_price_apply() returns trigger language plpgsql security definer set search_path=public as $$begin
update stations set price=new.price where zone_id=new.zone_id and kind=new.kind and price_override is null;return new;end$$;
create trigger up_apply after insert or update of price on unit_prices for each row execute function unit_price_apply();
-- Per-employee report
create function employee_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare z uuid:=my_zone();tz text;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
select timezone into tz from game_zones where id=z;
return coalesce((select jsonb_agg(jsonb_build_object('name',p.full_name,'sessions',coalesce(g.n,0),'games',coalesce(g.games,0),'game_revenue',coalesce(g.rev,0),'snack_revenue',coalesce(k.rev,0)) order by coalesce(g.rev,0)+coalesce(k.rev,0) desc)
from profiles p
left join(select employee_id,count(*) n,sum(games_count) games,sum(total_amount) rev from sessions where zone_id=z and status='ended' and (ended_at at time zone tz)::date between p_from and p_to group by 1) g on g.employee_id=p.id
left join(select s.employee_id,sum(si.qty*si.unit_price_snapshot) rev from sales s join sale_items si on si.sale_id=s.id where s.zone_id=z and s.voided_at is null and s.payment_method is not null and (s.created_at at time zone tz)::date between p_from and p_to group by 1) k on k.employee_id=p.id
where p.zone_id=z and p.role='employee' and (g.rev is not null or k.rev is not null)),'[]'::jsonb);end$$;
grant execute on function employee_report to authenticated;
