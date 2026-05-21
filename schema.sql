-- ROOTS Whiteboard – Supabase Schema (public schema)
-- Run this in the Supabase SQL editor
-- All tables use prefix wb_ to avoid name collisions; lives in public so no API exposure config needed.

-- ═══════════════════════════════════════════════════════
-- BOARDS
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_boards (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Neues Board',
  description     text,
  thumbnail       text,                         -- base64 PNG (data url)
  template_key    text,
  is_template     boolean not null default false,
  is_public       boolean not null default false,
  background      text not null default 'dots', -- dots, grid, plain
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  last_opened_at  timestamptz
);

create index if not exists wb_boards_owner_idx on public.wb_boards(owner_id);
create index if not exists wb_boards_updated_idx on public.wb_boards(updated_at desc);

-- ═══════════════════════════════════════════════════════
-- BOARD MEMBERS (sharing)
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_board_members (
  board_id  uuid not null references public.wb_boards(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null check (role in ('owner','editor','commenter','viewer')),
  added_by  uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index if not exists wb_board_members_user_idx on public.wb_board_members(user_id);

-- ═══════════════════════════════════════════════════════
-- BOARD OBJECTS (everything on the canvas)
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_objects (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.wb_boards(id) on delete cascade,
  type        text not null,
  x           numeric not null default 0,
  y           numeric not null default 0,
  width       numeric not null default 100,
  height      numeric not null default 100,
  rotation    numeric not null default 0,
  z_index     int     not null default 0,
  data        jsonb   not null default '{}',
  locked      boolean not null default false,
  created_by  uuid references auth.users(id),
  updated_by  uuid references auth.users(id),
  version     int     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wb_objects_board_idx on public.wb_objects(board_id);
create index if not exists wb_objects_board_z_idx on public.wb_objects(board_id, z_index);

-- ═══════════════════════════════════════════════════════
-- COMMENTS
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_comments (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.wb_boards(id) on delete cascade,
  parent_id    uuid references public.wb_comments(id) on delete cascade,
  object_id    uuid references public.wb_objects(id) on delete cascade,
  x            numeric,
  y            numeric,
  content      text not null,
  resolved     boolean not null default false,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists wb_comments_board_idx on public.wb_comments(board_id);

-- ═══════════════════════════════════════════════════════
-- VERSION SNAPSHOTS
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_snapshots (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.wb_boards(id) on delete cascade,
  label       text,
  data        jsonb not null,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists wb_snapshots_board_idx on public.wb_snapshots(board_id, created_at desc);

-- ═══════════════════════════════════════════════════════
-- ACTIVITY LOG
-- ═══════════════════════════════════════════════════════
create table if not exists public.wb_activity (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid references public.wb_boards(id) on delete cascade,
  user_id     uuid references auth.users(id),
  action      text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists wb_activity_board_idx on public.wb_activity(board_id, created_at desc);

-- ═══════════════════════════════════════════════════════
-- HELPER FUNCTION
-- ═══════════════════════════════════════════════════════
create or replace function public.wb_has_access(p_board_id uuid, p_min_role text default 'viewer')
returns boolean
language sql security definer set search_path = public, auth
as $$
  with hierarchy as (
    select case p_min_role
      when 'viewer'    then 1
      when 'commenter' then 2
      when 'editor'    then 3
      when 'owner'     then 4
      else 0 end as min_level
  ),
  membership as (
    select case role
      when 'viewer'    then 1
      when 'commenter' then 2
      when 'editor'    then 3
      when 'owner'     then 4
      else 0 end as role_level
    from public.wb_board_members
    where board_id = p_board_id and user_id = auth.uid()
  ),
  ownership as (
    select 4 as role_level from public.wb_boards
    where id = p_board_id and owner_id = auth.uid()
  ),
  public_access as (
    select 1 as role_level from public.wb_boards
    where id = p_board_id and is_public = true
  )
  select coalesce(
    (select bool_or(role_level >= (select min_level from hierarchy))
     from (
       select role_level from membership
       union all select role_level from ownership
       union all select role_level from public_access
     ) all_roles),
    false
  );
$$;

grant execute on function public.wb_has_access(uuid, text) to authenticated, anon;

-- ═══════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════
alter table public.wb_boards         enable row level security;
alter table public.wb_board_members  enable row level security;
alter table public.wb_objects        enable row level security;
alter table public.wb_comments       enable row level security;
alter table public.wb_snapshots      enable row level security;
alter table public.wb_activity       enable row level security;

-- Boards
drop policy if exists "wb_boards_select" on public.wb_boards;
create policy "wb_boards_select" on public.wb_boards
  for select using (
    is_public = true or
    owner_id = auth.uid() or
    exists(select 1 from public.wb_board_members m where m.board_id = id and m.user_id = auth.uid())
  );

drop policy if exists "wb_boards_insert" on public.wb_boards;
create policy "wb_boards_insert" on public.wb_boards
  for insert with check (owner_id = auth.uid());

drop policy if exists "wb_boards_update" on public.wb_boards;
create policy "wb_boards_update" on public.wb_boards
  for update using (
    owner_id = auth.uid() or
    exists(select 1 from public.wb_board_members m where m.board_id = id and m.user_id = auth.uid() and m.role in ('owner','editor'))
  );

drop policy if exists "wb_boards_delete" on public.wb_boards;
create policy "wb_boards_delete" on public.wb_boards
  for delete using (owner_id = auth.uid());

-- Members
drop policy if exists "wb_members_select" on public.wb_board_members;
create policy "wb_members_select" on public.wb_board_members
  for select using (public.wb_has_access(board_id, 'viewer'));

drop policy if exists "wb_members_insert" on public.wb_board_members;
create policy "wb_members_insert" on public.wb_board_members
  for insert with check (public.wb_has_access(board_id, 'owner'));

drop policy if exists "wb_members_update" on public.wb_board_members;
create policy "wb_members_update" on public.wb_board_members
  for update using (public.wb_has_access(board_id, 'owner'));

drop policy if exists "wb_members_delete" on public.wb_board_members;
create policy "wb_members_delete" on public.wb_board_members
  for delete using (public.wb_has_access(board_id, 'owner') or user_id = auth.uid());

-- Objects
drop policy if exists "wb_objects_select" on public.wb_objects;
create policy "wb_objects_select" on public.wb_objects
  for select using (public.wb_has_access(board_id, 'viewer'));

drop policy if exists "wb_objects_insert" on public.wb_objects;
create policy "wb_objects_insert" on public.wb_objects
  for insert with check (public.wb_has_access(board_id, 'editor'));

drop policy if exists "wb_objects_update" on public.wb_objects;
create policy "wb_objects_update" on public.wb_objects
  for update using (public.wb_has_access(board_id, 'editor'));

drop policy if exists "wb_objects_delete" on public.wb_objects;
create policy "wb_objects_delete" on public.wb_objects
  for delete using (public.wb_has_access(board_id, 'editor'));

-- Comments
drop policy if exists "wb_comments_select" on public.wb_comments;
create policy "wb_comments_select" on public.wb_comments
  for select using (public.wb_has_access(board_id, 'viewer'));

drop policy if exists "wb_comments_insert" on public.wb_comments;
create policy "wb_comments_insert" on public.wb_comments
  for insert with check (public.wb_has_access(board_id, 'commenter'));

drop policy if exists "wb_comments_update" on public.wb_comments;
create policy "wb_comments_update" on public.wb_comments
  for update using (created_by = auth.uid() or public.wb_has_access(board_id, 'editor'));

drop policy if exists "wb_comments_delete" on public.wb_comments;
create policy "wb_comments_delete" on public.wb_comments
  for delete using (created_by = auth.uid() or public.wb_has_access(board_id, 'editor'));

-- Snapshots
drop policy if exists "wb_snapshots_select" on public.wb_snapshots;
create policy "wb_snapshots_select" on public.wb_snapshots
  for select using (public.wb_has_access(board_id, 'viewer'));

drop policy if exists "wb_snapshots_insert" on public.wb_snapshots;
create policy "wb_snapshots_insert" on public.wb_snapshots
  for insert with check (public.wb_has_access(board_id, 'editor'));

drop policy if exists "wb_snapshots_delete" on public.wb_snapshots;
create policy "wb_snapshots_delete" on public.wb_snapshots
  for delete using (public.wb_has_access(board_id, 'owner'));

-- Activity
drop policy if exists "wb_activity_select" on public.wb_activity;
create policy "wb_activity_select" on public.wb_activity
  for select using (public.wb_has_access(board_id, 'viewer'));

drop policy if exists "wb_activity_insert" on public.wb_activity;
create policy "wb_activity_insert" on public.wb_activity
  for insert with check (public.wb_has_access(board_id, 'viewer'));

-- ═══════════════════════════════════════════════════════
-- AUTO-UPDATE updated_at
-- ═══════════════════════════════════════════════════════
create or replace function public.wb_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_wb_boards_touch on public.wb_boards;
create trigger trg_wb_boards_touch before update on public.wb_boards
  for each row execute function public.wb_touch_updated_at();

drop trigger if exists trg_wb_objects_touch on public.wb_objects;
create trigger trg_wb_objects_touch before update on public.wb_objects
  for each row execute function public.wb_touch_updated_at();

-- ═══════════════════════════════════════════════════════
-- REALTIME PUBLICATION
-- ═══════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wb_objects') then
    alter publication supabase_realtime add table public.wb_objects;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wb_comments') then
    alter publication supabase_realtime add table public.wb_comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='wb_boards') then
    alter publication supabase_realtime add table public.wb_boards;
  end if;
end$$;
