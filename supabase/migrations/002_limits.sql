create function enforce_station_limit() returns trigger language plpgsql as $$begin
if (select count(*) from stations where zone_id=new.zone_id and not is_archived)>=(select max_stations from game_zones where id=new.zone_id) then raise exception 'LIMIT_REACHED';end if;return new;end$$;
create trigger st_limit before insert on stations for each row execute function enforce_station_limit();
create function enforce_emp_limit() returns trigger language plpgsql as $$begin
if new.role='employee' and (select count(*) from profiles where zone_id=new.zone_id and role='employee' and deleted_at is null)>=(select max_employees from game_zones where id=new.zone_id) then raise exception 'LIMIT_REACHED';end if;return new;end$$;
create trigger emp_limit before insert on profiles for each row execute function enforce_emp_limit();
