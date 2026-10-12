create function update_profile(p_name text) returns void language plpgsql security definer set search_path=public as $$begin
if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'INVALID_INPUT';end if;
update profiles set full_name=trim(p_name) where id=auth.uid() and is_active;end$$;
grant execute on function update_profile to authenticated;
