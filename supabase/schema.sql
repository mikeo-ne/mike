-- ============================================================================
-- 1ne — Supabase schema v1: collaboration + asset vault (PRD §2.1)
-- ----------------------------------------------------------------------------
-- How to apply (free tier, no card):
--   1. Create a project at https://supabase.com/dashboard (region: EU / Frankfurt
--      is closest to East Africa).
--   2. Open the SQL Editor → New query → paste this whole file → Run.
--   3. Settings → API → copy the Project URL, anon key, and service_role key
--      into your env (see .env.example: SUPABASE_*).
-- Tables: profiles, projects, project_members, assets (+ private
-- `project-assets` storage bucket). All access is gated by Row Level Security.
-- ============================================================================

create extension if not exists pgcrypto;

-- profiles -------------------------------------------------------------------
-- One row per auth user; created automatically on signup (see trigger below).
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- projects -------------------------------------------------------------------
-- stage matches the PRD pipeline: In Production → Demo Review → Distribution
-- → Marketing Rollout (+ Archived).
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  stage text not null default 'in_production'
    check (stage in (
      'in_production', 'demo_review', 'distribution',
      'marketing_rollout', 'archived'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- project_members --------------------------------------------------------------
-- Owner lives on projects.owner_id; this table holds invited collaborators.
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'collaborator'
    check (role in ('owner', 'collaborator', 'view_only')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- assets -----------------------------------------------------------------------
-- Metadata for vault files (stems, mixes, artwork, docs). Bytes live in the
-- `project-assets` storage bucket at "<project_id>/<asset_id>-v<version>-<file>".
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  storage_path text not null,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists assets_project_idx
  on public.assets (project_id, created_at desc);

-- helpers ----------------------------------------------------------------------
create or replace function public.is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_members m
    where m.project_id = p_project_id and m.user_id = auth.uid()
  ) or exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = auth.uid()
  );
$$;

create or replace function public.project_role(p_project_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select m.role from public.project_members m
     where m.project_id = p_project_id and m.user_id = auth.uid()),
    (select 'owner' from public.projects p
     where p.id = p_project_id and p.owner_id = auth.uid()),
    'none'
  );
$$;

-- Extracts the project id from a storage path; NULL (deny) on malformed paths.
create or replace function public.path_project_id(p_path text)
returns uuid language plpgsql stable as $$
begin
  return split_part(p_path, '/', 1)::uuid;
exception when invalid_text_representation then
  return null;
end $$;

-- row level security -------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.assets enable row level security;

-- profiles: authed users can read names; users manage only their own row.
drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_self_write" on public.profiles;
create policy "profiles_self_write" on public.profiles
  for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- projects: members read; owners write; anyone authed can create (as owner).
drop policy if exists "projects_member_read" on public.projects;
create policy "projects_member_read" on public.projects
  for select to authenticated using (public.is_project_member(id));
drop policy if exists "projects_owner_write" on public.projects;
create policy "projects_owner_write" on public.projects
  for all to authenticated
  using (public.project_role(id) = 'owner')
  with check (public.project_role(id) = 'owner');
drop policy if exists "projects_create" on public.projects;
create policy "projects_create" on public.projects
  for insert to authenticated with check (owner_id = auth.uid());

-- members: members read the roster; owners manage it.
drop policy if exists "members_read" on public.project_members;
create policy "members_read" on public.project_members
  for select to authenticated using (public.is_project_member(project_id));
drop policy if exists "members_owner_write" on public.project_members;
create policy "members_owner_write" on public.project_members
  for all to authenticated
  using (public.project_role(project_id) = 'owner')
  with check (public.project_role(project_id) = 'owner');

-- assets: members read; collaborators+owners upload; owners delete.
drop policy if exists "assets_member_read" on public.assets;
create policy "assets_member_read" on public.assets
  for select to authenticated
  using (public.is_project_member(project_id));
drop policy if exists "assets_contrib_insert" on public.assets;
create policy "assets_contrib_insert" on public.assets
  for insert to authenticated
  with check (public.project_role(project_id) in ('owner', 'collaborator'));
drop policy if exists "assets_owner_delete" on public.assets;
create policy "assets_owner_delete" on public.assets
  for delete to authenticated
  using (public.project_role(project_id) = 'owner');

-- auto-create a profile row on signup --------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- private storage bucket + policies ----------------------------------------------
insert into storage.buckets (id, name, public)
values ('project-assets', 'project-assets', false)
on conflict (id) do nothing;

drop policy if exists "assets_storage_read" on storage.objects;
create policy "assets_storage_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'project-assets'
    and public.is_project_member(public.path_project_id(name))
  );
drop policy if exists "assets_storage_insert" on storage.objects;
create policy "assets_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'project-assets'
    and public.project_role(public.path_project_id(name)) in ('owner', 'collaborator')
  );
drop policy if exists "assets_storage_delete" on storage.objects;
create policy "assets_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'project-assets'
    and public.project_role(public.path_project_id(name)) = 'owner'
  );
