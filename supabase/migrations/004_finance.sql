create table expenses(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,category text not null,amount numeric(12,2) not null check(amount>=0),expense_date date not null default current_date,note text,recurring_id uuid,created_by uuid default auth.uid(),created_at timestamptz not null default now(),deleted_at timestamptz);
create table recurring_expenses(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,category text not null,amount numeric(12,2) not null check(amount>=0),day_of_month int not null check(day_of_month between 1 and 28),is_active boolean not null default true);
create unique index one_recurring_per_day on expenses(recurring_id,expense_date) where recurring_id is not null;
create index on expenses(zone_id,expense_date);
alter table expenses enable row level security;alter table recurring_expenses enable row level security;
create policy ex_adm on expenses for all using(zone_id=my_zone() and my_role()='admin') with check(zone_id=my_zone() and my_role()='admin');
create policy rx_adm on recurring_expenses for all using(zone_id=my_zone() and my_role()='admin') with check(zone_id=my_zone() and my_role()='admin');
create function audit_exp() returns trigger language plpgsql security definer set search_path=public as $$begin
insert into audit_logs(zone_id,user_id,action,entity,entity_id,previous_state,new_state) values(coalesce(new.zone_id,old.zone_id),auth.uid(),lower(tg_op)||'_expense','expense',coalesce(new.id,old.id),case when tg_op<>'INSERT' then to_jsonb(old) end,case when tg_op<>'DELETE' then to_jsonb(new) end);return coalesce(new,old);end$$;
create trigger exp_audit after insert or update on expenses for each row execute function audit_exp();
create function post_recurring() returns void language plpgsql security definer set search_path=public as $$
declare z uuid:=my_zone();begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
insert into expenses(zone_id,category,amount,expense_date,note,recurring_id)
select r.zone_id,r.category,r.amount,make_date(extract(year from current_date)::int,extract(month from current_date)::int,r.day_of_month),'Recurring',r.id
from recurring_expenses r where r.zone_id=z and r.is_active and make_date(extract(year from current_date)::int,extract(month from current_date)::int,r.day_of_month)<=current_date
on conflict do nothing;end$$;
create function profit_report(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare z uuid:=my_zone();tz text;r jsonb;begin
if my_role()<>'admin' then raise exception 'NOT_ALLOWED';end if;
if p_to<p_from or p_to-p_from>366 then raise exception 'INVALID_INPUT';end if;
select timezone into tz from game_zones where id=z;
select jsonb_build_object(
'revenue',coalesce((select sum(total_amount) from sessions where zone_id=z and status='ended' and (ended_at at time zone tz)::date between p_from and p_to),0),
'games',coalesce((select sum(games_count) from sessions where zone_id=z and status='ended' and (ended_at at time zone tz)::date between p_from and p_to),0),
'expenses',coalesce((select sum(amount) from expenses where zone_id=z and deleted_at is null and expense_date between p_from and p_to),0),
'by_method',coalesce((select jsonb_object_agg(m,t) from(select payment_method m,sum(total_amount) t from sessions where zone_id=z and status='ended' and (ended_at at time zone tz)::date between p_from and p_to group by 1)x),'{}'),
'by_kind',coalesce((select jsonb_object_agg(k,t) from(select st.kind k,sum(s.total_amount) t from sessions s join stations st on st.id=s.station_id where s.zone_id=z and s.status='ended' and (s.ended_at at time zone tz)::date between p_from and p_to group by 1)x),'{}'),
'by_category',coalesce((select jsonb_object_agg(c,t) from(select category c,sum(amount) t from expenses where zone_id=z and deleted_at is null and expense_date between p_from and p_to group by 1)x),'{}'),
'daily',coalesce((select jsonb_agg(jsonb_build_object('day',d,'revenue',rv,'expenses',ex) order by d) from(select g::date d,
 coalesce((select sum(total_amount) from sessions where zone_id=z and status='ended' and (ended_at at time zone tz)::date=g::date),0) rv,
 coalesce((select sum(amount) from expenses where zone_id=z and deleted_at is null and expense_date=g::date),0) ex
 from generate_series(p_from,p_to,'1 day') g)q),'[]'))into r;return r;end$$;
grant execute on function post_recurring,profit_report to authenticated;
