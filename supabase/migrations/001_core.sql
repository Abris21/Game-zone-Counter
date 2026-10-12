-- Game Zone Counter: core schema, RLS and money-critical RPCs
create extension if not exists pgcrypto;
create type user_role as enum ('super_admin','admin','employee');
create table game_zones(id uuid primary key default gen_random_uuid(),owner_id uuid,name text not null,location text,currency text not null default 'ETB',timezone text not null default 'Africa/Addis_Ababa',status text not null default 'active' check(status in('active','suspended')),max_employees int not null default 3,max_stations int not null default 10,created_at timestamptz not null default now(),deleted_at timestamptz);
create table profiles(id uuid primary key references auth.users on delete cascade,role user_role not null default 'employee',full_name text,username text,zone_id uuid references game_zones,is_active boolean not null default true,deleted_at timestamptz,created_at timestamptz not null default now());
create table stations(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,kind text not null check(kind in('ps4','ps5','pool','other')),name text not null,price numeric(12,2) not null check(price>=0),sort_order int not null default 0,is_archived boolean not null default false);
create table shifts(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,employee_id uuid not null references profiles,status text not null default 'open' check(status in('open','pending_verification','settled')),opened_at timestamptz not null default now(),closed_at timestamptz,expected_cash numeric(12,2),counted_cash numeric(12,2),variance numeric(12,2),note text);
create unique index one_open_shift on shifts(employee_id) where status='open';
create table sessions(id uuid primary key default gen_random_uuid(),zone_id uuid not null references game_zones,station_id uuid not null references stations,employee_id uuid not null references profiles,shift_id uuid references shifts,status text not null default 'open' check(status in('open','ended','cancelled')),price_snapshot numeric(12,2) not null,games_count int not null default 0 check(games_count between 0 and 200),total_amount numeric(12,2),payment_method text check(payment_method in('cash','telebirr','cbe')),started_at timestamptz not null default now(),ended_at timestamptz);
create unique index one_open_per_station on sessions(station_id) where status='open';
create index on sessions(zone_id,started_at);
create table session_events(id uuid primary key default gen_random_uuid(),session_id uuid not null references sessions,type text not null,delta int,employee_id uuid not null,client_event_id text unique,created_at timestamptz not null default now());
create table audit_logs(id uuid primary key default gen_random_uuid(),zone_id uuid,user_id uuid,action text not null,entity text,entity_id uuid,previous_state jsonb,new_state jsonb,reason text,created_at timestamptz not null default now());

create function my_zone() returns uuid language sql stable security definer set search_path=public as $$select zone_id from profiles where id=auth.uid() and is_active and deleted_at is null$$;
create function my_role() returns user_role language sql stable security definer set search_path=public as $$select role from profiles where id=auth.uid() and is_active and deleted_at is null$$;

alter table game_zones enable row level security;alter table profiles enable row level security;alter table stations enable row level security;alter table shifts enable row level security;alter table sessions enable row level security;alter table session_events enable row level security;alter table audit_logs enable row level security;
create policy z_sel on game_zones for select using(id=my_zone() or my_role()='super_admin');
create policy z_sa on game_zones for all using(my_role()='super_admin') with check(my_role()='super_admin');
create policy p_sel on profiles for select using(id=auth.uid() or zone_id=my_zone() or my_role()='super_admin');
create policy st_sel on stations for select using(zone_id=my_zone());
create policy st_adm on stations for all using(zone_id=my_zone() and my_role()='admin') with check(zone_id=my_zone() and my_role()='admin');
create policy sh_sel on shifts for select using(zone_id=my_zone() and (my_role()='admin' or employee_id=auth.uid()));
create policy se_sel on sessions for select using(zone_id=my_zone());
create policy ev_sel on session_events for select using(exists(select 1 from sessions s where s.id=session_id and s.zone_id=my_zone()));
create policy au_sel on audit_logs for select using(zone_id=my_zone() and my_role()='admin');
-- Writes to shifts/sessions/events happen only through the RPCs below.

create function open_shift() returns uuid language plpgsql security definer set search_path=public as $$
declare v uuid;z uuid:=my_zone();begin
if z is null then raise exception 'NOT_ALLOWED';end if;
if (select status from game_zones where id=z)<>'active' then raise exception 'ZONE_SUSPENDED';end if;
select id into v from shifts where employee_id=auth.uid() and status='open';
if v is null then insert into shifts(zone_id,employee_id) values(z,auth.uid()) returning id into v;end if;return v;end$$;

create function start_session(p_station uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare s stations;v uuid;sh uuid;begin
select * into s from stations where id=p_station and zone_id=my_zone() and not is_archived;
if not found then raise exception 'NOT_ALLOWED';end if;
sh:=open_shift();
begin insert into sessions(zone_id,station_id,employee_id,shift_id,price_snapshot) values(s.zone_id,s.id,auth.uid(),sh,s.price) returning id into v;
exception when unique_violation then raise exception 'UNIT_BUSY';end;
insert into session_events(session_id,type,employee_id) values(v,'start',auth.uid());return v;end$$;

create function adjust_session(p_session uuid,p_delta int,p_event text) returns int language plpgsql security definer set search_path=public as $$
declare s sessions;n int;begin
if p_delta not in(-1,1) then raise exception 'COUNT_OUT_OF_RANGE';end if;
if exists(select 1 from session_events where client_event_id=p_event) then return (select games_count from sessions where id=p_session);end if;
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found then raise exception 'NOT_ALLOWED';end if;
if s.status<>'open' then raise exception 'SESSION_ALREADY_ENDED';end if;
n:=s.games_count+p_delta;if n<0 or n>200 then raise exception 'COUNT_OUT_OF_RANGE';end if;
update sessions set games_count=n where id=s.id;
insert into session_events(session_id,type,delta,employee_id,client_event_id) values(s.id,case when p_delta>0 then 'inc' else 'dec' end,p_delta,auth.uid(),p_event);return n;end$$;

create function end_session(p_session uuid,p_method text) returns numeric language plpgsql security definer set search_path=public as $$
declare s sessions;t numeric;begin
select * into s from sessions where id=p_session and zone_id=my_zone() for update;
if not found then raise exception 'NOT_ALLOWED';end if;
if s.status<>'open' then raise exception 'SESSION_ALREADY_ENDED';end if;
if s.games_count=0 then update sessions set status='cancelled',ended_at=now(),total_amount=0 where id=s.id;t:=0;
else t:=s.games_count*s.price_snapshot;update sessions set status='ended',ended_at=now(),total_amount=t,payment_method=p_method where id=s.id;end if;
insert into session_events(session_id,type,employee_id) values(s.id,'end',auth.uid());return t;end$$;

grant execute on function open_shift,start_session,adjust_session,end_session to authenticated;
alter publication supabase_realtime add table sessions;
