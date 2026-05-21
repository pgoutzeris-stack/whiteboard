-- ROOTS Whiteboard – Supabase Schema
-- Run this in the Supabase SQL editor

create schema if not exists whiteboard;

-- ═══════════════════════════════════════════════════════
-- BOARDS
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.boards (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  title         text not null default 'Neues Board',
  description   text,
  thumbnail     text,                         -- base64 PNG (data url)
  template_key  text,                         -- e.g. 'kanban','retro','brainstorm'
  is_template   boolean not null default false,
  is_public     boolean not null default false,
  background    text not null default 'dots', -- 'dots','grid','plain'
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_opened_at timestamptz
);

create index if not exists boards_owner_idx on whiteboard.boards(owner_id);
create index if not exists boards_updated_idx on whiteboard.boards(updated_at desc);

-- ═══════════════════════════════════════════════════════
-- BOARD MEMBERS (sharing)
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.board_members (
  board_id  uuid not null references whiteboard.boards(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null check (role in ('owner','editor','commenter','viewer')),
  added_by  uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (board_id, user_id)
);

create index if not exists board_members_user_idx on whiteboard.board_members(user_id);

-- ═══════════════════════════════════════════════════════
-- BOARD OBJECTS (everything on the canvas)
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.objects (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references whiteboard.boards(id) on delete cascade,
  type        text not null,        -- rect, circle, triangle, diamond, sticky, text, line, arrow, path, image, frame
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

create index if not exists objects_board_idx on whiteboard.objects(board_id);
create index if not exists objects_board_z_idx on whiteboard.objects(board_id, z_index);

-- ═══════════════════════════════════════════════════════
-- COMMENTS
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.comments (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references whiteboard.boards(id) on delete cascade,
  parent_id    uuid references whiteboard.comments(id) on delete cascade,
  object_id    uuid references whiteboard.objects(id) on delete cascade,
  x            numeric,
  y            numeric,
  content      text not null,
  resolved     boolean not null default false,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists comments_board_idx on whiteboard.comments(board_id);

-- ═══════════════════════════════════════════════════════
-- VERSION SNAPSHOTS
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.snapshots (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references whiteboard.boards(id) on delete cascade,
  label       text,
  data        jsonb not null,             -- full board snapshot
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists snapshots_board_idx on whiteboard.snapshots(board_id, created_at desc);

-- ═══════════════════════════════════════════════════════
-- ACTIVITY LOG
-- ═══════════════════════════════════════════════════════
create table if not exists whiteboard.activity (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid references whiteboard.boards(id) on delete cascade,
  user_id     uuid references auth.users(id),
  action      text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists activity_board_idx on whiteboard.activity(board_id, created_at desc);

-- ═══════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════
create or replace function whiteboard.has_board_access(p_board_id uuid, p_min_role text default 'viewer')
returns boolean
language sql security definer set search_path = public, whiteboard, auth
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
    from whiteboard.board_members
    where board_id = p_board_id and user_id = auth.uid()
  ),
  ownership as (
    select 4 as role_level from whiteboard.boards
    where id = p_board_id and owner_id = auth.uid()
  ),
  public_access as (
    select 1 as role_level from whiteboard.boards
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

-- ═══════════════════════════════════════════════════════
-- RLS POLICIES
-- ═══════════════════════════════════════════════════════
alter table whiteboard.boards         enable row level security;
alter table whiteboard.board_members  enable row level security;
alter table whiteboard.objects        enable row level security;
alter table whiteboard.comments       enable row level security;
alter table whiteboard.snapshots      enable row level security;
alter table whiteboard.activity       enable row level security;

-- Boards
drop policy if exists "boards_select" on whiteboard.boards;
create policy "boards_select" on whiteboard.boards
  for select using (
    is_public = true or
    owner_id = auth.uid() or
    exists(select 1 from whiteboard.board_members m where m.board_id = id and m.user_id = auth.uid())
  );

drop policy if exists "boards_insert" on whiteboard.boards;
create policy "boards_insert" on whiteboard.boards
  for insert with check (owner_id = auth.uid());

drop policy if exists "boards_update" on whiteboard.boards;
create policy "boards_update" on whiteboard.boards
  for update using (
    owner_id = auth.uid() or
    exists(select 1 from whiteboard.board_members m where m.board_id = id and m.user_id = auth.uid() and m.role in ('owner','editor'))
  );

drop policy if exists "boards_delete" on whiteboard.boards;
create policy "boards_delete" on whiteboard.boards
  for delete using (owner_id = auth.uid());

-- Members
drop policy if exists "members_select" on whiteboard.board_members;
create policy "members_select" on whiteboard.board_members
  for select using (whiteboard.has_board_access(board_id, 'viewer'));

drop policy if exists "members_insert" on whiteboard.board_members;
create policy "members_insert" on whiteboard.board_members
  for insert with check (whiteboard.has_board_access(board_id, 'owner'));

drop policy if exists "members_update" on whiteboard.board_members;
create policy "members_update" on whiteboard.board_members
  for update using (whiteboard.has_board_access(board_id, 'owner'));

drop policy if exists "members_delete" on whiteboard.board_members;
create policy "members_delete" on whiteboard.board_members
  for delete using (whiteboard.has_board_access(board_id, 'owner') or user_id = auth.uid());

-- Objects (editor or owner)
drop policy if exists "objects_select" on whiteboard.objects;
create policy "objects_select" on whiteboard.objects
  for select using (whiteboard.has_board_access(board_id, 'viewer'));

drop policy if exists "objects_insert" on whiteboard.objects;
create policy "objects_insert" on whiteboard.objects
  for insert with check (whiteboard.has_board_access(board_id, 'editor'));

drop policy if exists "objects_update" on whiteboard.objects;
create policy "objects_update" on whiteboard.objects
  for update using (whiteboard.has_board_access(board_id, 'editor'));

drop policy if exists "objects_delete" on whiteboard.objects;
create policy "objects_delete" on whiteboard.objects
  for delete using (whiteboard.has_board_access(board_id, 'editor'));

-- Comments (commenter or above)
drop policy if exists "comments_select" on whiteboard.comments;
create policy "comments_select" on whiteboard.comments
  for select using (whiteboard.has_board_access(board_id, 'viewer'));

drop policy if exists "comments_insert" on whiteboard.comments;
create policy "comments_insert" on whiteboard.comments
  for insert with check (whiteboard.has_board_access(board_id, 'commenter'));

drop policy if exists "comments_update" on whiteboard.comments;
create policy "comments_update" on whiteboard.comments
  for update using (created_by = auth.uid() or whiteboard.has_board_access(board_id, 'editor'));

drop policy if exists "comments_delete" on whiteboard.comments;
create policy "comments_delete" on whiteboard.comments
  for delete using (created_by = auth.uid() or whiteboard.has_board_access(board_id, 'editor'));

-- Snapshots
drop policy if exists "snapshots_select" on whiteboard.snapshots;
create policy "snapshots_select" on whiteboard.snapshots
  for select using (whiteboard.has_board_access(board_id, 'viewer'));

drop policy if exists "snapshots_insert" on whiteboard.snapshots;
create policy "snapshots_insert" on whiteboard.snapshots
  for insert with check (whiteboard.has_board_access(board_id, 'editor'));

drop policy if exists "snapshots_delete" on whiteboard.snapshots;
create policy "snapshots_delete" on whiteboard.snapshots
  for delete using (whiteboard.has_board_access(board_id, 'owner'));

-- Activity (read-only for members, write via app)
drop policy if exists "activity_select" on whiteboard.activity;
create policy "activity_select" on whiteboard.activity
  for select using (whiteboard.has_board_access(board_id, 'viewer'));

drop policy if exists "activity_insert" on whiteboard.activity;
create policy "activity_insert" on whiteboard.activity
  for insert with check (whiteboard.has_board_access(board_id, 'viewer'));

-- ═══════════════════════════════════════════════════════
-- AUTO-UPDATE updated_at
-- ═══════════════════════════════════════════════════════
create or replace function whiteboard.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_boards_touch on whiteboard.boards;
create trigger trg_boards_touch before update on whiteboard.boards
  for each row execute function whiteboard.touch_updated_at();

drop trigger if exists trg_objects_touch on whiteboard.objects;
create trigger trg_objects_touch before update on whiteboard.objects
  for each row execute function whiteboard.touch_updated_at();

-- ═══════════════════════════════════════════════════════
-- REALTIME PUBLICATION
-- ═══════════════════════════════════════════════════════
-- Allow Supabase Realtime to broadcast changes on objects + comments
alter publication supabase_realtime add table whiteboard.objects;
alter publication supabase_realtime add table whiteboard.comments;
alter publication supabase_realtime add table whiteboard.boards;

-- Expose schema to API
grant usage on schema whiteboard to anon, authenticated;
grant all on all tables in schema whiteboard to authenticated;
grant all on all sequences in schema whiteboard to authenticated;
alter default privileges in schema whiteboard grant all on tables to authenticated;
alter default privileges in schema whiteboard grant all on sequences to authenticated;
