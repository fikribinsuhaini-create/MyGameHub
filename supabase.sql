create extension if not exists "pgcrypto";

create table if not exists public.puzzlehub_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text default 'Puzzle Collector',
  avatar text default 'PH',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.puzzlehub_user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  dark_mode boolean not null default true,
  sound_effects boolean not null default true,
  animations boolean not null default true,
  cloud_sync boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.puzzlehub_game_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_type text not null check (game_type in ('sudoku', 'kakuro', 'sumplete')),
  progress_json jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, game_type)
);

create table if not exists public.puzzlehub_save_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  puzzle_key text not null,
  game_type text not null check (game_type in ('sudoku', 'kakuro', 'sumplete')),
  level_number integer not null default 1,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  is_daily boolean not null default false,
  timer integer not null default 0,
  board_state jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  completed boolean not null default false,
  hints_used integer not null default 0,
  last_played timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, puzzle_key)
);

create or replace function public.puzzlehub_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists puzzlehub_profiles_set_updated_at on public.puzzlehub_profiles;
create trigger puzzlehub_profiles_set_updated_at before update on public.puzzlehub_profiles
for each row execute function public.puzzlehub_set_updated_at();

drop trigger if exists puzzlehub_user_settings_set_updated_at on public.puzzlehub_user_settings;
create trigger puzzlehub_user_settings_set_updated_at before update on public.puzzlehub_user_settings
for each row execute function public.puzzlehub_set_updated_at();

drop trigger if exists puzzlehub_game_progress_set_updated_at on public.puzzlehub_game_progress;
create trigger puzzlehub_game_progress_set_updated_at before update on public.puzzlehub_game_progress
for each row execute function public.puzzlehub_set_updated_at();

drop trigger if exists puzzlehub_save_states_set_updated_at on public.puzzlehub_save_states;
create trigger puzzlehub_save_states_set_updated_at before update on public.puzzlehub_save_states
for each row execute function public.puzzlehub_set_updated_at();

alter table public.puzzlehub_profiles enable row level security;
alter table public.puzzlehub_user_settings enable row level security;
alter table public.puzzlehub_game_progress enable row level security;
alter table public.puzzlehub_save_states enable row level security;

drop policy if exists "puzzlehub profiles own select" on public.puzzlehub_profiles;
create policy "puzzlehub profiles own select" on public.puzzlehub_profiles for select using (id = auth.uid());
drop policy if exists "puzzlehub profiles own insert" on public.puzzlehub_profiles;
create policy "puzzlehub profiles own insert" on public.puzzlehub_profiles for insert with check (id = auth.uid());
drop policy if exists "puzzlehub profiles own update" on public.puzzlehub_profiles;
create policy "puzzlehub profiles own update" on public.puzzlehub_profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "puzzlehub settings own all" on public.puzzlehub_user_settings;
create policy "puzzlehub settings own all" on public.puzzlehub_user_settings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "puzzlehub progress own all" on public.puzzlehub_game_progress;
create policy "puzzlehub progress own all" on public.puzzlehub_game_progress for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "puzzlehub saves own all" on public.puzzlehub_save_states;
create policy "puzzlehub saves own all" on public.puzzlehub_save_states for all using (user_id = auth.uid()) with check (user_id = auth.uid());
