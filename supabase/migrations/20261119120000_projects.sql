-- Projects, floors, membership, attachments and AI run log, with row level security.
-- Rule for every project-scoped table: members read; owners and editors write.

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade default auth.uid(),
  name text not null,
  kind text not null check (kind in ('home', 'office', 'warehouse', 'other')),
  data jsonb not null,
  schema_version int not null,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.floors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  building_id text not null,
  name text not null,
  sort_order int not null,
  data jsonb not null,
  schema_version int not null,
  version int not null default 1,
  updated_at timestamptz not null default now()
);
create index floors_project_id_idx on public.floors (project_id);

create table public.project_members (
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  primary key (project_id, user_id)
);
create index project_members_user_id_idx on public.project_members (user_id);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  floor_id uuid references public.floors on delete cascade,
  storage_path text not null,
  kind text not null check (kind in ('floorplan', 'photo', 'panel_photo', 'breaker_list')),
  region jsonb,
  created_at timestamptz not null default now()
);
create index attachments_project_id_idx on public.attachments (project_id);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  pass text not null,
  provider text not null,
  model text not null,
  input_tokens int,
  output_tokens int,
  images int,
  validation_retries int not null default 0,
  status text not null check (status in ('ok', 'invalid', 'error', 'rate_limited')),
  created_at timestamptz not null default now()
);
create index ai_runs_project_id_idx on public.ai_runs (project_id);

-- Security definer so policies on project_members can use it without recursing into themselves.
create function public.project_role(p_project_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.project_members
  where project_id = p_project_id and user_id = (select auth.uid())
$$;

create function public.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$ select public.project_role(p_project_id) is not null $$;

create function public.can_write_project(p_project_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce(public.project_role(p_project_id) in ('owner', 'editor'), false) $$;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();
create trigger floors_touch before update on public.floors
  for each row execute function public.touch_updated_at();

-- Security definer because the creator is not yet a member when the row is inserted.
create function public.add_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger projects_owner_membership after insert on public.projects
  for each row execute function public.add_owner_membership();

alter table public.projects enable row level security;
alter table public.floors enable row level security;
alter table public.project_members enable row level security;
alter table public.attachments enable row level security;
alter table public.ai_runs enable row level security;

create policy "members read projects" on public.projects for select to authenticated
  using (owner_id = (select auth.uid()) or public.can_read_project(id));
create policy "users create own projects" on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "writers update projects" on public.projects for update to authenticated
  using (public.can_write_project(id)) with check (public.can_write_project(id));
create policy "owners delete projects" on public.projects for delete to authenticated
  using (public.project_role(id) = 'owner');

create policy "members read floors" on public.floors for select to authenticated
  using (public.can_read_project(project_id));
create policy "writers insert floors" on public.floors for insert to authenticated
  with check (public.can_write_project(project_id));
create policy "writers update floors" on public.floors for update to authenticated
  using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));
create policy "writers delete floors" on public.floors for delete to authenticated
  using (public.can_write_project(project_id));

-- Membership changes go through share_project / owner-only policies.
create policy "members read memberships" on public.project_members for select to authenticated
  using (public.can_read_project(project_id));
create policy "owners remove members" on public.project_members for delete to authenticated
  using (public.project_role(project_id) = 'owner' and user_id <> (select auth.uid()));

create policy "members read attachments" on public.attachments for select to authenticated
  using (public.can_read_project(project_id));
create policy "writers insert attachments" on public.attachments for insert to authenticated
  with check (public.can_write_project(project_id));
create policy "writers update attachments" on public.attachments for update to authenticated
  using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));
create policy "writers delete attachments" on public.attachments for delete to authenticated
  using (public.can_write_project(project_id));

create policy "members read ai runs" on public.ai_runs for select to authenticated
  using (public.can_read_project(project_id));
create policy "writers log own ai runs" on public.ai_runs for insert to authenticated
  with check (user_id = (select auth.uid()) and public.can_write_project(project_id));

-- Creates a project and its floors in one transaction, as the calling user (RLS applies).
create function public.create_project(project jsonb, floors jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id uuid;
begin
  insert into public.projects (id, name, kind, data, schema_version)
  values (
    coalesce((project ->> 'id')::uuid, gen_random_uuid()),
    project ->> 'name',
    project ->> 'kind',
    project -> 'data',
    (project -> 'data' ->> 'schemaVersion')::int
  )
  returning id into new_id;

  insert into public.floors (id, project_id, building_id, name, sort_order, data, schema_version)
  select
    (f ->> 'id')::uuid,
    new_id,
    f ->> 'buildingId',
    f ->> 'name',
    (f ->> 'sortOrder')::int,
    f -> 'data',
    (f -> 'data' ->> 'schemaVersion')::int
  from jsonb_array_elements(floors) as f;

  return new_id;
end;
$$;

-- Owners share by email. The person must have signed in once so an auth user exists.
create function public.share_project(p_project_id uuid, p_email text, p_role text default 'editor')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target uuid;
begin
  if public.project_role(p_project_id) is distinct from 'owner' then
    raise exception 'only the project owner can share it' using errcode = '42501';
  end if;
  if p_role not in ('editor', 'viewer') then
    raise exception 'invalid role %', p_role using errcode = '22023';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then
    raise exception 'no user with that email' using errcode = 'P0002';
  end if;
  insert into public.project_members (project_id, user_id, role) values (p_project_id, target, p_role)
  on conflict (project_id, user_id) do update set role = excluded.role
  where public.project_members.role <> 'owner';
  return target;
end;
$$;

revoke execute on function public.share_project(uuid, text, text) from public, anon;
revoke execute on function public.create_project(jsonb, jsonb) from public, anon;
grant execute on function public.share_project(uuid, text, text) to authenticated;
grant execute on function public.create_project(jsonb, jsonb) to authenticated;
