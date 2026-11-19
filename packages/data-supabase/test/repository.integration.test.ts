import {
  generateProject,
  NotFoundError,
  saveWithReplay,
  splitByDocument,
  applyEdit,
  updateDevice,
  removeDevice,
  type Change,
  type Edit,
  type Model,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { RepositoryError, SupabaseRepository } from '../src/index.ts';
import { signedInUser } from './local-supabase.ts';

/** A random seed gives fresh ids, so every run creates new rows. */
const newProject = (): Model => generateProject('small', Math.floor(Math.random() * 2 ** 31));

function floorChange(model: Model, floorId: string, edit: Edit, changeId: string) {
  const result = applyEdit(model, edit);
  const change: Change = {
    id: changeId,
    patches: splitByDocument(result.patches).get(floorId) ?? [],
  };
  return change;
}

async function sharedProject() {
  const owner = await signedInUser('owner');
  const editor = await signedInUser('editor');
  const outsider = await signedInUser('outsider');
  const ownerRepo = new SupabaseRepository(owner.client);
  const editorRepo = new SupabaseRepository(editor.client);
  const outsiderRepo = new SupabaseRepository(outsider.client);
  const created = await ownerRepo.createProject(newProject());
  await ownerRepo.shareProject(created.project.id, editor.email);
  return { owner, editor, outsider, ownerRepo, editorRepo, outsiderRepo, created };
}

describe('SupabaseRepository (local Supabase)', () => {
  it('creates a project with its floors and lists it for the owner only', async () => {
    const { ownerRepo, outsiderRepo, created } = await sharedProject();
    const original = await ownerRepo.loadProject(created.project.id);
    expect(Object.keys(original.floors)).toHaveLength(2);
    expect(original).toEqual(created);
    expect((await ownerRepo.listProjects()).map((p) => p.id)).toContain(created.project.id);
    expect(await outsiderRepo.listProjects()).toEqual([]);
    await expect(outsiderRepo.loadProject(created.project.id)).rejects.toThrow(NotFoundError);
  });

  it('lets two users edit different floors at the same time without conflicts', async () => {
    const { ownerRepo, editorRepo, created } = await sharedProject();
    const asEditor = await editorRepo.loadProject(created.project.id);
    expect(asEditor).toEqual(created);
    const [ground, upper] = Object.values(created.floors).sort((a, b) => a.sortOrder - b.sortOrder);
    const deviceOn = (floorId: string) =>
      Object.values(created.floors[floorId]!.data.devices).find((d) => d.type === 'outlet')!;

    const ownerChange = floorChange(
      created,
      ground!.id,
      updateDevice(deviceOn(ground!.id).id, { label: 'Ägarens uttag' }),
      'owner',
    );
    const editorChange = floorChange(
      asEditor,
      upper!.id,
      updateDevice(deviceOn(upper!.id).id, { label: 'Redaktörens uttag' }),
      'editor',
    );
    const attempts: string[] = [];
    const [ownerSaved, editorSaved] = await Promise.all([
      saveWithReplay(
        ground!,
        [ownerChange],
        (r, v) => (attempts.push('owner'), ownerRepo.saveFloor(r, v)),
      ),
      saveWithReplay(
        upper!,
        [editorChange],
        (r, v) => (attempts.push('editor'), editorRepo.saveFloor(r, v)),
      ),
    ]);
    expect(attempts.sort()).toEqual(['editor', 'owner']);
    expect([ownerSaved.rejected, editorSaved.rejected]).toEqual([[], []]);

    const reloaded = await ownerRepo.loadProject(created.project.id);
    expect(reloaded.floors[ground!.id]!.data.devices[deviceOn(ground!.id).id]!.label).toBe(
      'Ägarens uttag',
    );
    expect(reloaded.floors[upper!.id]!.data.devices[deviceOn(upper!.id).id]!.label).toBe(
      'Redaktörens uttag',
    );
    expect([reloaded.floors[ground!.id]!.version, reloaded.floors[upper!.id]!.version]).toEqual([
      2, 2,
    ]);
  });

  it('replays onto the newer version when both edit the same floor, and reports what no longer applies', async () => {
    const { ownerRepo, editorRepo, created } = await sharedProject();
    const floor = Object.values(created.floors)[0]!;
    const [first, second] = Object.values(floor.data.devices).filter((d) => d.type === 'outlet');

    await saveWithReplay(
      floor,
      [floorChange(created, floor.id, removeDevice(first!.id), 'owner-removes')],
      (r, v) => ownerRepo.saveFloor(r, v),
    );
    const saved = await saveWithReplay(
      floor,
      [
        floorChange(created, floor.id, updateDevice(first!.id, { label: 'Borttagen?' }), 'stale'),
        floorChange(created, floor.id, updateDevice(second!.id, { label: 'Redaktören' }), 'fine'),
      ],
      (r, v) => editorRepo.saveFloor(r, v),
    );
    expect(saved.rejected.map((r) => r.change.id)).toEqual(['stale']);
    expect(saved.record.version).toBe(3);
    expect(saved.record.data.devices[first!.id]).toBeUndefined();
    expect(saved.record.data.devices[second!.id]!.label).toBe('Redaktören');
  });

  it('keeps outsiders out of saving and sharing', async () => {
    const { outsiderRepo, editorRepo, outsider, created } = await sharedProject();
    const floor = Object.values(created.floors)[0]!;
    await expect(
      outsiderRepo.saveFloor({ ...floor, name: 'Hackad' }, floor.version),
    ).rejects.toThrow(NotFoundError);
    await expect(outsiderRepo.shareProject(created.project.id, outsider.email)).rejects.toThrow(
      RepositoryError,
    );
    await expect(editorRepo.shareProject(created.project.id, outsider.email)).rejects.toThrow(
      'only the project owner',
    );
  });
});
