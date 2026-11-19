-- Private bucket for floor plans and photos, laid out as '<project_id>/<attachment_id>.<ext>'.
insert into storage.buckets (id, name, public) values ('project-files', 'project-files', false);

-- Returns null for paths whose first folder is not a uuid, so they match no project.
create function public.storage_project_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return (storage.foldername(object_name))[1]::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

create policy "members read project files" on storage.objects for select to authenticated
  using (bucket_id = 'project-files' and public.can_read_project(public.storage_project_id(name)));
create policy "writers upload project files" on storage.objects for insert to authenticated
  with check (bucket_id = 'project-files' and public.can_write_project(public.storage_project_id(name)));
create policy "writers update project files" on storage.objects for update to authenticated
  using (bucket_id = 'project-files' and public.can_write_project(public.storage_project_id(name)));
create policy "writers delete project files" on storage.objects for delete to authenticated
  using (bucket_id = 'project-files' and public.can_write_project(public.storage_project_id(name)));
