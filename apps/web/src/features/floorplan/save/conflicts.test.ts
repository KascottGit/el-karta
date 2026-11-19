import { generateProject, type Change, type RejectedChange } from '@el-karta/core';
import type { Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { createModelStore } from '@/model/store';
import { conflictMessage } from './conflict-text';
import { describeConflict, dismissConflicts } from './conflicts';

const model = generateProject('small');
const floor = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
const room = Object.values(floor.data.rooms)[0]!;
const wall = Object.values(floor.data.walls)[0]!;
const door = Object.values(floor.data.openings).find((o) => o.kind === 'door')!;
const outlet = Object.values(floor.data.devices).find((d) => d.type === 'outlet')!;

let nextId = 0;
const rejected = (...patches: Patch[]): RejectedChange => ({
  change: { id: `change-${++nextId}`, patches } satisfies Change,
  reason: 'missing',
});

const t = i18n.t.bind(i18n);

describe('describeConflict', () => {
  it('names an edited item from the model and the floor it is on', () => {
    const conflict = rejected({
      op: 'replace',
      path: ['data', 'rooms', room.id, 'name'],
      value: 'Nytt',
    });
    const description = describeConflict(conflict, floor.id, [model]);
    expect(description).toEqual({
      changeId: conflict.change.id,
      action: 'change',
      subjects: [{ kind: 'room', id: room.id, name: room.name }],
      floorName: floor.name,
    });
    expect(conflictMessage(t, description)).toBe(
      `Din ändring av rummet ”${room.name}” kunde inte sparas eftersom någon annan tog bort det du ändrade.`,
    );
  });

  it('lists every item a change touched once, and calls a removal a removal', () => {
    const description = describeConflict(
      rejected(
        { op: 'remove', path: ['data', 'walls', wall.id] },
        { op: 'remove', path: ['data', 'openings', door.id] },
        { op: 'remove', path: ['data', 'walls', wall.id] },
      ),
      floor.id,
      [model],
    );
    expect(description.action).toBe('remove');
    expect(description.subjects).toEqual([
      { kind: 'wall', id: wall.id },
      { kind: 'opening', id: door.id, openingKind: 'door' },
    ]);
    expect(conflictMessage(t, description)).toBe(
      'Din borttagning av väggen och dörren kunde inte sparas eftersom någon annan redan hade tagit bort något av det.',
    );
  });

  it('falls back to the name in the change itself, and searches every floor when the document is unknown', () => {
    const fromPatch = describeConflict(
      rejected({
        op: 'replace',
        path: ['data', 'devices', 'gone'],
        value: { ...outlet, id: 'gone', label: 'Uttag X' },
      }),
      undefined,
      [null],
    );
    expect(fromPatch.subjects).toEqual([{ kind: 'device', id: 'gone', name: 'Uttag X' }]);
    expect(fromPatch.floorName).toBeUndefined();

    const searched = describeConflict(
      rejected({ op: 'replace', path: ['data', 'devices', outlet.id, 'label'], value: 'Y' }),
      undefined,
      [model],
    );
    expect(searched.subjects).toEqual([{ kind: 'device', id: outlet.id, name: outlet.label }]);
  });

  it('describes floor settings, floor properties and project changes', () => {
    const building = Object.values(model.project.data.buildings)[0]!;
    const kinds = (doc: string, ...paths: (string | number)[][]) =>
      describeConflict(
        rejected(...paths.map((path): Patch => ({ op: 'replace', path, value: 1 }))),
        doc,
        [model],
      ).subjects.map((s) => ('name' in s ? `${s.kind}:${s.name}` : s.kind));

    expect(
      kinds(floor.id, ['data', 'scale', 'metresPerPixel'], ['data', 'height'], ['name']),
    ).toEqual(['scale', 'floor']);
    expect(kinds('project', ['data', 'buildings', building.id, 'name'], ['name'])).toEqual([
      `building:${building.name}`,
      'project',
    ]);
  });

  it('shortens long lists', () => {
    const rooms = Object.values(floor.data.rooms).slice(0, 5);
    const description = describeConflict(
      rejected(
        ...rooms.map((r): Patch => ({
          op: 'replace',
          path: ['data', 'rooms', r.id, 'type'],
          value: 'other',
        })),
      ),
      floor.id,
      [model],
    );
    expect(conflictMessage(t, description)).toContain('och 2 saker till');
  });
});

describe('dismissConflicts', () => {
  it('removes the given conflicts, or all of them', () => {
    const store = createModelStore();
    store.getState().load(model);
    const [a, b, c] = [rejected(), rejected(), rejected()];
    store.setState({ conflicts: [a, b, c] });

    dismissConflicts(store, [b.change.id]);
    expect(store.getState().conflicts).toEqual([a, c]);
    dismissConflicts(store);
    expect(store.getState().conflicts).toEqual([]);
  });
});
