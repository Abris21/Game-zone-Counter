-- The counter and employee day screens refresh their totals from sales events.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'sales'
  ) then
    execute 'alter publication supabase_realtime add table public.sales';
  end if;
end;
$$;
