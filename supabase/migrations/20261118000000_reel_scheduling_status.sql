do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'reels'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format(
      'alter table reels drop constraint %I',
      constraint_record.conname
    );
  end loop;
end
$$;

alter table reels
  add constraint reels_status_check
  check (status in ('draft', 'scheduling', 'scheduled', 'posted', 'failed'));
