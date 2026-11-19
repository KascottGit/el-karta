import { createEmptyProject, type FloorRecord, type Id, type ProjectKind } from '@el-karta/core';
import { SupabaseRepository, type MemberRole } from '@el-karta/data-supabase';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/app/supabase';
import { modelStore } from '@/model/store';

export const repository = new SupabaseRepository(supabase);

const keys = {
  projects: ['projects'] as const,
  project: (id: Id) => ['project', id] as const,
};

export const useProjects = () =>
  useQuery({ queryKey: keys.projects, queryFn: () => repository.listProjects() });

/** Loads once per visit; after that the model store owns the project and saves it. */
export const useProject = (id: Id) =>
  useQuery({
    queryKey: keys.project(id),
    queryFn: () => repository.loadProject(id),
    staleTime: Infinity,
    gcTime: 0,
  });

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      kind: ProjectKind;
      buildingName: string;
      floorName: string;
    }) => repository.createProject(createEmptyProject({ ...input, id: () => crypto.randomUUID() })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.projects }),
  });
}

export const useShareProject = (projectId: Id) =>
  useMutation({
    mutationFn: ({ email, role }: { email: string; role: MemberRole }) =>
      repository.shareProject(projectId, email, role),
  });

export const useCreateFloor = () =>
  useMutation({
    mutationFn: (floor: FloorRecord) => modelStore.getState().createFloor(repository, floor),
  });

export const useDeleteFloor = () =>
  useMutation({
    mutationFn: (floorId: Id) => modelStore.getState().deleteFloor(repository, floorId),
  });
