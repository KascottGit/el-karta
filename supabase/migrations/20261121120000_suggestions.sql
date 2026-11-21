-- AI suggestions and richer AI run logging (M4, ADR 0007).

-- Lets suggestions and runs reference a floor together with its project, so a row can never point
-- at a floor of another project.
alter table public.floors add constraint floors_id_project_id_key unique (id, project_id);

alter table public.ai_runs
  add column floor_id uuid,
  add column duration_ms int,
  add column error text,
  add column model_version text,
  add constraint ai_runs_floor_fkey foreign key (floor_id, project_id)
    references public.floors (id, project_id) on delete cascade,
  add constraint ai_runs_id_project_id_key unique (id, project_id);
create index ai_runs_user_id_created_at_idx on public.ai_runs (user_id, created_at);

-- One row per suggested item; the columns mirror the core `Suggestion` schema. `run_id` is the run
-- that produced the item, or null when it was merged from several tiles' runs.
create table public.suggestions (
  id uuid primary key,
  project_id uuid not null references public.projects on delete cascade,
  floor_id uuid not null,
  run_id uuid,
  pass text not null,
  kind text not null,
  source text not null,
  payload jsonb not null,
  confidence double precision check (confidence between 0 and 1),
  issues jsonb not null default '[]',
  requires uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users on delete set null,
  foreign key (floor_id, project_id) references public.floors (id, project_id) on delete cascade,
  foreign key (run_id, project_id) references public.ai_runs (id, project_id) on delete set null (run_id)
);
create index suggestions_floor_id_status_idx on public.suggestions (floor_id, status);
create index suggestions_project_id_idx on public.suggestions (project_id);

create function public.record_suggestion_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at = case when new.status = 'pending' then null else now() end;
    new.decided_by = case when new.status = 'pending' then null else (select auth.uid()) end;
  end if;
  return new;
end;
$$;

create trigger suggestions_decision before update on public.suggestions
  for each row execute function public.record_suggestion_decision();

alter table public.suggestions enable row level security;

create policy "members read suggestions" on public.suggestions for select to authenticated
  using (public.can_read_project(project_id));
create policy "writers insert suggestions" on public.suggestions for insert to authenticated
  with check (public.can_write_project(project_id) and status = 'pending' and decided_by is null);
create policy "writers decide suggestions" on public.suggestions for update to authenticated
  using (public.can_write_project(project_id)) with check (public.can_write_project(project_id));

-- A suggestion's content is fixed once stored; people only decide on it. Rows go away with their
-- floor or project, never one by one.
revoke update on public.suggestions from authenticated, anon;
grant update (status) on public.suggestions to authenticated;

-- The AI rate limit counts every run of the caller, also in projects they can no longer read.
create function public.my_ai_run_count(p_since timestamptz)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.ai_runs
  where user_id = (select auth.uid()) and created_at >= p_since
$$;

revoke execute on function public.my_ai_run_count(timestamptz) from public, anon;
grant execute on function public.my_ai_run_count(timestamptz) to authenticated;
