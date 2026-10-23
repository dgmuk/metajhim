-- Run once in your Supabase project's SQL Editor. Does not delete existing data.
begin;
-- Create exactly one login in Authentication > Users before running this script.
do $$ begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Create exactly one user in Authentication > Users, then run this script again.';
  end if;
end $$;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
create table if not exists app_private.diary_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid unique not null references auth.users(id) on delete cascade
);
insert into app_private.diary_owner(singleton,user_id) select true,id from auth.users on conflict(singleton) do nothing;
create or replace function public.is_diary_owner() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists(select 1 from app_private.diary_owner where user_id = (select auth.uid())); $$;
revoke all on function public.is_diary_owner() from public, anon;
grant execute on function public.is_diary_owner() to authenticated;
create table if not exists public.diary_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now()
);
alter table public.diary_state enable row level security;
revoke all on public.diary_state from anon, authenticated;
grant select, insert, update on public.diary_state to authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='diary_state' and policyname='Read own diary') then
    create policy "Read own diary" on public.diary_state for select to authenticated using ((select public.is_diary_owner()) and (select auth.uid()) = user_id);
    create policy "Insert own diary" on public.diary_state for insert to authenticated with check ((select public.is_diary_owner()) and (select auth.uid()) = user_id);
    create policy "Update own diary" on public.diary_state for update to authenticated using ((select public.is_diary_owner()) and (select auth.uid()) = user_id) with check ((select public.is_diary_owner()) and (select auth.uid()) = user_id);
  end if;
end $$;
commit;
