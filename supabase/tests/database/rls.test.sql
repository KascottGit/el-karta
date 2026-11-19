begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Fixed ids: owner A, editor B, viewer V, outsider C; project P with floors F1, F2.
insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-000000000001', 'a@test.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-000000000002', 'b@test.local', 'authenticated', 'authenticated'),
  ('c0000000-0000-4000-8000-000000000003', 'c@test.local', 'authenticated', 'authenticated'),
  ('d0000000-0000-4000-8000-000000000004', 'v@test.local', 'authenticated', 'authenticated');

-- Owner A creates the project and shares it.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select is(
  public.create_project(
    '{"id":"e0000000-0000-4000-8000-000000000010","name":"Villa","kind":"home","data":{"schemaVersion":1}}',
    '[{"id":"f0000000-0000-4000-8000-000000000011","buildingId":"b1","name":"Plan 1","sortOrder":0,"data":{"schemaVersion":1}},
      {"id":"f0000000-0000-4000-8000-000000000012","buildingId":"b1","name":"Plan 2","sortOrder":1,"data":{"schemaVersion":1}}]'
  ),
  'e0000000-0000-4000-8000-000000000010'::uuid,
  'create_project returns the new project id'
);
select results_eq(
  $$ select user_id, role from public.project_members $$,
  $$ values ('a0000000-0000-4000-8000-000000000001'::uuid, 'owner'::text) $$,
  'creating a project makes the creator its owner'
);
select is((select count(*) from public.floors)::int, 2, 'owner sees both floors');
select lives_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'B@test.local') $$, 'owner shares with an editor (email is case-insensitive)');
select lives_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'v@test.local', 'viewer') $$, 'owner shares with a viewer');
select throws_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'nobody@test.local') $$, 'P0002', 'no user with that email', 'sharing with an unknown email fails');
select throws_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'b@test.local', 'owner') $$, '22023', null, 'cannot share ownership');
insert into public.attachments (id, project_id, storage_path, kind)
  values ('aa000000-0000-4000-8000-000000000020', 'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000010/plan.png', 'floorplan');
insert into public.ai_runs (project_id, pass, provider, model, status)
  values ('e0000000-0000-4000-8000-000000000010', 'floorplan', 'gemini', 'test', 'ok');
insert into storage.objects (bucket_id, name) values ('project-files', 'e0000000-0000-4000-8000-000000000010/plan.png');
select is((select count(*) from storage.objects where bucket_id = 'project-files')::int, 1, 'owner uploads and sees a project file');

-- Outsider C gets nothing back and cannot write.
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
select is((select count(*) from public.projects)::int, 0, 'non-member sees no projects');
select is((select count(*) from public.floors)::int, 0, 'non-member sees no floors');
select is((select count(*) from public.project_members)::int, 0, 'non-member sees no memberships');
select is((select count(*) from public.attachments)::int, 0, 'non-member sees no attachments');
select is((select count(*) from public.ai_runs)::int, 0, 'non-member sees no AI runs');
select is((select count(*) from storage.objects where bucket_id = 'project-files')::int, 0, 'non-member sees no project files');
select is_empty($$ update public.floors set name = 'hacked' returning id $$, 'non-member updates no floors');
select is_empty($$ delete from public.projects returning id $$, 'non-member deletes no projects');
select throws_ok(
  $$ insert into public.floors (project_id, building_id, name, sort_order, data, schema_version)
     values ('e0000000-0000-4000-8000-000000000010', 'b1', 'Intrång', 9, '{}', 1) $$,
  '42501', null, 'non-member cannot add a floor'
);
select throws_ok(
  $$ insert into public.projects (owner_id, name, kind, data, schema_version)
     values ('a0000000-0000-4000-8000-000000000001', 'Fake', 'home', '{}', 1) $$,
  '42501', null, 'cannot create a project owned by someone else'
);
select throws_ok(
  $$ insert into public.project_members (project_id, user_id, role)
     values ('e0000000-0000-4000-8000-000000000010', 'c0000000-0000-4000-8000-000000000003', 'owner') $$,
  '42501', null, 'cannot add yourself as a member'
);
select throws_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'c@test.local') $$, '42501', null, 'non-member cannot share');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('project-files', 'e0000000-0000-4000-8000-000000000010/evil.png') $$,
  '42501', null, 'non-member cannot upload project files'
);

-- Viewer V reads but cannot write.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
select is((select count(*) from public.floors)::int, 2, 'viewer sees the floors');
select is_empty($$ update public.floors set name = 'nope' returning id $$, 'viewer updates no floors');
select is((select count(*) from storage.objects where bucket_id = 'project-files')::int, 1, 'viewer sees project files');

-- Editor B saves a floor with the version check; a stale save then matches nothing.
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
select isnt_empty(
  $$ update public.floors set name = 'Plan 1 (B)', version = version + 1
     where id = 'f0000000-0000-4000-8000-000000000011' and version = 1 returning id $$,
  'editor saves a floor at the expected version'
);
select is_empty(
  $$ update public.floors set name = 'Plan 1 (stale)', version = version + 1
     where id = 'f0000000-0000-4000-8000-000000000011' and version = 1 returning id $$,
  'a save at a stale version matches no row'
);
select throws_ok($$ select public.share_project('e0000000-0000-4000-8000-000000000010', 'c@test.local') $$, '42501', null, 'editor cannot share');
select is_empty($$ delete from public.projects returning id $$, 'editor cannot delete the project');
select is_empty($$ delete from public.project_members returning user_id $$, 'editor cannot remove members');
select lives_ok(
  $$ insert into storage.objects (bucket_id, name) values ('project-files', 'e0000000-0000-4000-8000-000000000010/photo.jpg') $$,
  'editor uploads project files'
);

-- Owner A can remove the editor but not themselves.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ with removed as (delete from public.project_members where user_id = 'b0000000-0000-4000-8000-000000000002' returning user_id) select count(*)::int from removed $$,
  $$ values (1) $$,
  'owner removes the editor'
);
select is_empty($$ delete from public.project_members where user_id = 'a0000000-0000-4000-8000-000000000001' returning user_id $$, 'owner cannot remove themselves');
select is((select version from public.floors where id = 'f0000000-0000-4000-8000-000000000011'), 2, 'floor version was incremented once');

select * from finish();
rollback;
