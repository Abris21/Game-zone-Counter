create table inventory_items(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,name text not null,sell_price numeric(12,2) not null check(sell_price>=0),cost_price numeric(12,2) not null default 0 check(cost_price>=0),track_stock boolean not null default false,stock_qty int not null default 0 check(stock_qty>=0),low_stock_threshold int not null default 5,is_archived boolean not null default false);
create table sales(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,shift_id uuid references shifts,session_id uuid references sessions,employee_id uuid not null,payment_method text check(payment_method in('cash','telebirr','cbe')),total numeric(12,2) not null default 0,created_at timestamptz not null default now());
create table sale_items(id uuid primary key default gen_random_uuid(),sale_id uuid not null references sales on delete cascade,item_id uuid not null references inventory_items,qty int not null check(qty>0),unit_price_snapshot numeric(12,2) not null,unit_cost_snapshot numeric(12,2) not null);
create index on sales(zone_id,created_at);create index on sales(session_id);
alter table inventory_items enable row level security;alter table sales enable row level security;alter table sale_items enable row level security;
create policy it_adm on inventory_items for all using(zone_id=my_zone() and my_role()='admin') with check(zone_id=my_zone() and my_role()='admin');
create policy sl_sel on sales for select using(zone_id=my_zone() and (my_role()='admin' or employee_id=auth.uid()));
create policy si_sel on sale_items for select using(exists(select 1 from sales s where s.id=sale_id and s.zone_id=my_zone() and (my_role()='admin' or s.employee_id=auth.uid())));
create function menu() returns table(id uuid,name text,sell_price numeric,track_stock boolean,stock_qty int) language sql stable security definer set search_path=public as $$select i.id,i.name,i.sell_price,i.track_stock,i.stock_qty from inventory_items i where i.zone_id=my_zone() and not i.is_archived order by i.name$$;
create function add_sale(p_items jsonb,p_session uuid,p_method text) returns uuid language plpgsql security definer set search_path=public as $$
declare z uuid:=my_zone();sh uuid;sid uuid;t numeric:=0;i jsonb;it inventory_items;q int;ses sessions;begin
if z is null then raise exception 'NOT_ALLOWED';end if;
if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'INVALID_INPUT';end if;
if p_session is not null then select * into ses from sessions where id=p_session and zone_id=z and status='open' for update;
 if not found then raise exception 'SESSION_ALREADY_ENDED';end if;sh:=ses.shift_id;
else if p_method not in('cash','telebirr','cbe') then raise exception 'INVALID_INPUT';end if;sh:=open_shift();end if;
insert into sales(zone_id,shift_id,session_id,employee_id,payment_method) values(z,sh,p_session,auth.uid(),case when p_session is null then p_method end) returning id into sid;
for i in select * from jsonb_array_elements(p_items) loop
 q:=(i->>'qty')::int;if q<1 or q>50 then raise exception 'INVALID_INPUT';end if;
 select * into it from inventory_items where id=(i->>'item_id')::uuid and zone_id=z and not is_archived for update;
 if not found then raise exception 'NOT_ALLOWED';end if;
 if it.track_stock then if it.stock_qty<q then raise exception 'OUT_OF_STOCK';end if;update inventory_items set stock_qty=stock_qty-q where id=it.id;end if;
 insert into sale_items(sale_id,item_id,qty,unit_price_snapshot,unit_cost_snapshot) values(sid,it.id,q,it.sell_price,it.cost_price);t:=t+q*it.sell_price;end loop;
update sales set total=t where id=sid;return sid;end$$;
create or replace function end_session(p_session uuid,p_method text) returns numeric language plpgsql security definer set search_path=public as $$
declare s sessions;t numeric;begin
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found then raise exception 'NOT_ALLOWED';end if;
if s.status<>'open' then raise exception 'SESSION_ALREADY_ENDED';end if;
if s.games_count=0 and not exists(select 1 from sales where session_id=s.id) then update sessions set status='cancelled',ended_at=now(),total_amount=0 where id=s.id;t:=0;
else t:=s.games_count*s.price_snapshot;update sessions set status='ended',ended_at=now(),total_amount=t,payment_method=p_method where id=s.id;update sales set payment_method=p_method where session_id=s.id;end if;
insert into session_events(session_id,type,employee_id) values(s.id,'end',auth.uid());return t;end$$;
create or replace function close_shift(p_counted numeric,p_note text) returns uuid language plpgsql security definer set search_path=public as $$
declare s shifts;e numeric;begin
select * into s from shifts where employee_id=auth.uid() and status='open' for update;
if not found then raise exception 'NO_OPEN_SHIFT';end if;
if exists(select 1 from sessions where employee_id=auth.uid() and status='open') then raise exception 'OPEN_SESSIONS';end if;
if p_counted is null or p_counted<0 then raise exception 'INVALID_INPUT';end if;
select coalesce((select sum(total_amount) from sessions where shift_id=s.id and status='ended' and payment_method='cash'),0)+coalesce((select sum(total) from sales where shift_id=s.id and payment_method='cash'),0) into e;
update shifts set status='pending_verification',closed_at=now(),expected_cash=e,counted_cash=p_counted,variance=p_counted-e,note=p_note where id=s.id;
insert into audit_logs(zone_id,user_id,action,entity,entity_id,new_state) values(s.zone_id,auth.uid(),'close_shift','shift',s.id,jsonb_build_object('expected',e,'counted',p_counted));
return s.id;end$$;
create function snack_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare z uuid:=my_zone();tz text;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
select timezone into tz from game_zones where id=z;
return (select jsonb_build_object('revenue',coalesce(sum(si.qty*si.unit_price_snapshot),0),'cost',coalesce(sum(si.qty*si.unit_cost_snapshot),0)) from sale_items si join sales s on s.id=si.sale_id where s.zone_id=z and (s.created_at at time zone tz)::date between p_from and p_to and s.payment_method is not null);end$$;
grant execute on function menu,add_sale,snack_report to authenticated;
