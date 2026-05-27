create extension if not exists pgcrypto;

create table if not exists public.image_ratings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  image_folder text not null,
  image_name text not null,
  score numeric(3,1) not null check (score between 0 and 10 and score * 2 = trunc(score * 2)),
  negative_feedback text not null default '',
  neutral_feedback text not null default '',
  positive_feedback text not null default '',
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists image_ratings_user_image_idx
  on public.image_ratings (user_id, image_path);

grant usage on schema public to authenticated;
grant select, insert, update on table public.image_ratings to authenticated;

alter table public.image_ratings enable row level security;

drop policy if exists "anonymous users can insert their own ratings" on public.image_ratings;
create policy "anonymous users can insert their own ratings"
on public.image_ratings
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users can read their own ratings" on public.image_ratings;
create policy "users can read their own ratings"
on public.image_ratings
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users can update their own ratings" on public.image_ratings;
create policy "users can update their own ratings"
on public.image_ratings
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
