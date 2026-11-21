begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Owner A, editor B, viewer V, outsider C; A's project P with floor F, C's project Q with floor G.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'a@test.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'b@test.local', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000003', 'c@test.local', 'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-000000000004', 'v@test.local', 'authenticated', 'authenticated');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select public.create_project(
  '{"id":"e0000000-0000-4000-8000-000000000020","name":"Annan","kind":"home","data":{"schemaVersion":1}}',
  '[{"id":"f0000000-0000-4000-8000-000000000021","buildingId":"b1","name":"Plan 1","sortOrder":0,"data":{"schemaVersion":1}}]'
);

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select public.create_project(
  '{"id":"e0000000-0000-4000-8000-000000000010","name":"Villa","kind":"home","data":{"schemaVersion":1}}',
  '[{"id":"f0000000-0000-4000-8000-000000000011","buildingId":"b1","name":"Plan 1","sortOrder":0,"data":{"schemaVersion":1}}]'
);
select public.share_project('e0000000-0000-4000-8000-000000000010', 'b@test.local', 'editor');
select public.share_project('e0000000-0000-4000-8000-000000000010', 'v@test.local', 'viewer');

select lives_ok(
  $$ insert into public.ai_runs (id, project_id, floor_id, pass, provider, model, status, duration_ms, model_version)
     values ('99000000-0000-4000-8000-000000000030', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'fake', 'm', 'ok', 12, 'fake:m') $$,
  'owner logs a run on a floor'
);
select throws_ok(
  $$ insert into public.ai_runs (project_id, floor_id, pass, provider, model, status)
     values ('e0000000-0000-4000-8000-000000000010', 'f0000000-0000-4000-8000-000000000021', 'floorplan', 'fake', 'm', 'ok') $$,
  '23503', null, 'a run cannot point at a floor of another project'
);
select lives_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, run_id, pass, kind, source, payload, confidence)
     values ('5a000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', '99000000-0000-4000-8000-000000000030',
             'floorplan', 'wall', 'ai:floorplan:m', '{}', 0.8) $$,
  'owner stores a suggestion'
);
select throws_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload)
     values ('5a000000-0000-4000-8000-000000000041', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000021', 'floorplan', 'wall', 'ai:floorplan:m', '{}') $$,
  '23503', null, 'a suggestion cannot point at a floor of another project'
);
select is(public.my_ai_run_count(now() - interval '1 hour'), 1, 'the owner counts their own run');

-- Outsider C gets nothing back and cannot write.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.suggestions)::int, 0, 'non-member sees no suggestions');
select is_empty($$ update public.suggestions set status = 'accepted' returning id $$, 'non-member decides no suggestions');
select throws_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload)
     values ('5a000000-0000-4000-8000-000000000042', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'wall', 'ai:floorplan:m', '{}') $$,
  '42501', null, 'non-member cannot store suggestions'
);
select is(public.my_ai_run_count(now() - interval '1 hour'), 0, 'others'' runs do not count for the outsider');

-- Viewer V reads but cannot write or decide.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*) from public.suggestions)::int, 1, 'viewer sees the suggestion');
select is_empty($$ update public.suggestions set status = 'rejected' returning id $$, 'viewer cannot change a status');
select throws_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload)
     values ('5a000000-0000-4000-8000-000000000043', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'wall', 'ai:floorplan:m', '{}') $$,
  '42501', null, 'viewer cannot store suggestions'
);

-- Editor B stores and decides, but cannot rewrite content or delete.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload, requires)
     values ('5a000000-0000-4000-8000-000000000044', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'opening', 'ai:floorplan:m', '{}',
             '{5a000000-0000-4000-8000-000000000040}') $$,
  'editor stores a suggestion'
);
select throws_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload, status)
     values ('5a000000-0000-4000-8000-000000000045', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'wall', 'ai:floorplan:m', '{}', 'accepted') $$,
  '42501', null, 'a suggestion is always stored as pending'
);
select throws_ok(
  $$ insert into public.suggestions (id, project_id, floor_id, pass, kind, source, payload, decided_at)
     values ('5a000000-0000-4000-8000-000000000046', 'e0000000-0000-4000-8000-000000000010',
             'f0000000-0000-4000-8000-000000000011', 'floorplan', 'wall', 'ai:floorplan:m', '{}', now()) $$,
  '42501', null, 'a suggestion cannot be stored as already decided'
);
select results_eq(
  $$ update public.suggestions set status = 'accepted' where id = '5a000000-0000-4000-8000-000000000040' returning status $$,
  $$ values ('accepted'::text) $$,
  'editor accepts a suggestion'
);
select results_eq(
  $$ select decided_by, decided_at is not null from public.suggestions where id = '5a000000-0000-4000-8000-000000000040' $$,
  $$ values ('b0000000-0000-4000-8000-000000000002'::uuid, true) $$,
  'the decision records who and when'
);
select results_eq(
  $$ update public.suggestions set status = 'pending' where id = '5a000000-0000-4000-8000-000000000040' returning decided_by is null and decided_at is null $$,
  $$ values (true) $$,
  'going back to pending clears the decision'
);
select throws_ok(
  $$ update public.suggestions set payload = '{"x":1}' $$,
  '42501', null, 'editor cannot rewrite a payload'
);
select throws_ok(
  $$ update public.suggestions set decided_by = 'a0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'editor cannot forge who decided'
);
select is_empty($$ delete from public.suggestions returning id $$, 'suggestions are not deleted one by one');
select is(public.my_ai_run_count(now() - interval '1 hour'), 0, 'the editor has no runs of their own');
insert into public.ai_runs (project_id, pass, provider, model, status)
  values ('e0000000-0000-4000-8000-000000000010', 'floorplan', 'fake', 'm', 'ok');

-- A removed member's runs still count against their limit.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
delete from public.project_members where user_id = 'b0000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select is((select count(*) from public.ai_runs)::int, 0, 'a removed member no longer sees the runs');
select is(public.my_ai_run_count(now() - interval '1 hour'), 1, 'a removed member''s run still counts');

-- Deleting the floor removes its suggestions; runs outlive the floor and the project.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
delete from public.floors where id = 'f0000000-0000-4000-8000-000000000011';
select is((select count(*) from public.suggestions)::int, 0, 'deleting a floor removes its suggestions');
select results_eq(
  $$ select floor_id from public.ai_runs where id = '99000000-0000-4000-8000-000000000030' $$,
  $$ values (null::uuid) $$,
  'a run outlives its floor'
);
select is(public.my_ai_run_count(now() - interval '1 hour'), 1, 'deleting a floor does not reset the limit');
delete from public.projects where id = 'e0000000-0000-4000-8000-000000000010';
select is((select count(*) from public.ai_runs)::int, 0, 'runs of a deleted project are hidden');
select is(public.my_ai_run_count(now() - interval '1 hour'), 1, 'deleting a project does not reset the limit');

select * from finish();
rollback;
