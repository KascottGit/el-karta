import {
  generateProject,
  InMemoryRepository,
  putSpaceItem,
  removeSpaceItem,
  updateDevice,
  type Repository,
} from '@el-karta/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelStore } from '@/model/store';
import { createAutosave, hasUnsavedChanges, type AutosaveOptions } from './autosave';
import { bindPageLifecycle } from './page-lifecycle';

const OPTIONS: AutosaveOptions = {
  debounceMs: 1500,
  maxIntervalMs: 10_000,
  retryBaseMs: 2000,
  retryMaxMs: 6000,
};

/** Fails the next `failures` floor saves, like a dropped connection would. */
class FlakyRepository extends InMemoryRepository {
  failures = 0;
  saves = 0;
  override saveFloor(...args: Parameters<Repository['saveFloor']>) {
    this.saves++;
    if (this.failures > 0) {
      this.failures--;
      return Promise.reject(new Error('offline'));
    }
    return super.saveFloor(...args);
  }
}

async function setup(options: Partial<AutosaveOptions> = {}) {
  const repository = new FlakyRepository();
  const model = await repository.createProject(generateProject('small'));
  const floor = Object.values(model.floors).sort((a, b) => a.sortOrder - b.sortOrder)[0]!;
  const outlets = Object.values(floor.data.devices).filter((d) => d.type === 'outlet');
  const store = createModelStore();
  store.getState().load(model);
  const autosave = createAutosave(store, repository, { ...OPTIONS, ...options });
  const stop = autosave.start();
  let edits = 0;
  const edit = () => {
    edits++;
    store.getState().apply(updateDevice(outlets[0]!.id, { label: `Ändring ${edits}` }));
  };
  const savedLabel = async () =>
    (await repository.loadProject(model.project.id)).floors[floor.id]!.data.devices[outlets[0]!.id]!
      .label;
  return { repository, model, floor, store, autosave, stop, edit, savedLabel };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('autosave', () => {
  it('saves once, 1.5 s after the last edit', async () => {
    const { repository, store, edit, savedLabel } = await setup();
    edit();
    await vi.advanceTimersByTimeAsync(1000);
    edit();
    await vi.advanceTimersByTimeAsync(1499);
    expect(repository.saves).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(repository.saves).toBe(1);
    expect(hasUnsavedChanges(store.getState())).toBe(false);
    expect(await savedLabel()).toBe('Ändring 2');
  });

  it('saves at least every 10 s while the user keeps editing', async () => {
    const { repository, edit } = await setup();
    for (let second = 0; second < 10; second++) {
      edit();
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(repository.saves).toBe(1);
  });

  it('saves edits made while a save is in flight afterwards', async () => {
    const { repository, store, autosave, edit, savedLabel } = await setup();
    edit();
    const inFlight = autosave.flush();
    edit();
    await inFlight;
    expect(hasUnsavedChanges(store.getState())).toBe(true);

    await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
    expect(repository.saves).toBe(2);
    expect(await savedLabel()).toBe('Ändring 2');
  });

  it('keeps the changes and retries with backoff while saving fails', async () => {
    const { repository, store, autosave, edit, savedLabel } = await setup();
    repository.failures = 3;
    edit();
    await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
    expect(autosave.status.getState()).toMatchObject({
      failures: 1,
      retryAt: Date.now() + 2000,
    });
    expect(hasUnsavedChanges(store.getState())).toBe(true);

    edit();
    await vi.advanceTimersByTimeAsync(1999);
    expect(repository.saves).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(repository.saves).toBe(2);
    expect(autosave.status.getState().failures).toBe(2);

    await vi.advanceTimersByTimeAsync(3999);
    expect(repository.saves).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(autosave.status.getState().failures).toBe(3);
    expect(autosave.status.getState().retryAt).toBe(Date.now() + OPTIONS.retryMaxMs);

    await vi.advanceTimersByTimeAsync(OPTIONS.retryMaxMs);
    expect(autosave.status.getState()).toMatchObject({ failures: 0, error: null, retryAt: null });
    expect(hasUnsavedChanges(store.getState())).toBe(false);
    expect(await savedLabel()).toBe('Ändring 2');
  });

  it('retries at once when asked', async () => {
    const { repository, store, autosave, edit } = await setup();
    repository.failures = 1;
    edit();
    await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
    expect(autosave.status.getState().failures).toBe(1);

    autosave.retry();
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(2);
    expect(hasUnsavedChanges(store.getState())).toBe(false);
    expect(autosave.status.getState().failures).toBe(0);
  });

  it('waits for a save started elsewhere instead of skipping', async () => {
    const { repository, store, autosave, edit } = await setup();
    edit();
    const elsewhere = store.getState().save(repository);
    edit();
    await autosave.flush();
    await elsewhere;
    expect(repository.saves).toBe(2);
    expect(hasUnsavedChanges(store.getState())).toBe(false);
  });

  it('flushes when stopped, and does not schedule afterwards', async () => {
    const { repository, store, stop, edit } = await setup();
    edit();
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(1);

    edit();
    await vi.advanceTimersByTimeAsync(OPTIONS.maxIntervalMs);
    expect(repository.saves).toBe(1);
    expect(hasUnsavedChanges(store.getState())).toBe(true);
  });

  it('resumes after a restart, keeping the failure count (as on a StrictMode remount)', async () => {
    const { repository, store, autosave, stop, edit } = await setup();
    repository.failures = 2;
    edit();
    await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(autosave.status.getState().failures).toBe(2);

    autosave.start();
    await vi.advanceTimersByTimeAsync(OPTIONS.debounceMs);
    expect(repository.saves).toBe(3);
    expect(hasUnsavedChanges(store.getState())).toBe(false);
    expect(autosave.status.getState().failures).toBe(0);
  });

  it('describes conflicts with names from before the merge', async () => {
    const { repository, model, floor, store, autosave } = await setup();
    const room = Object.values(floor.data.rooms)[0]!;
    const other = createModelStore();
    other.getState().load(await repository.loadProject(model.project.id));
    other.getState().apply(removeSpaceItem(floor.id, 'rooms', room.id));
    await other.getState().save(repository);

    store.getState().apply(putSpaceItem(floor.id, 'rooms', { ...room, ceilingHeight: 2.7 }));
    await autosave.flush();

    const [conflict] = store.getState().conflicts;
    expect(store.getState().model!.floors[floor.id]!.data.rooms[room.id]).toBeUndefined();
    expect(autosave.status.getState().conflictDescriptions[conflict!.change.id]).toEqual({
      changeId: conflict!.change.id,
      action: 'change',
      subjects: [{ kind: 'room', id: room.id, name: room.name }],
      floorName: floor.name,
    });
  });
});

describe('page lifecycle', () => {
  function page() {
    const win = new EventTarget();
    const visibility: { visibilityState: DocumentVisibilityState } = { visibilityState: 'visible' };
    const doc = Object.assign(new EventTarget(), visibility);
    return { win, doc };
  }

  it('saves at once when the page is hidden or closed', async () => {
    const { repository, store, autosave, edit } = await setup();
    const { win, doc } = page();
    const unbind = bindPageLifecycle(autosave, store, win, doc);

    edit();
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(0);

    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(1);

    edit();
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(2);
    expect(hasUnsavedChanges(store.getState())).toBe(false);

    unbind();
    edit();
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(2);
  });

  it('asks before leaving only while changes are unsaved', async () => {
    const { repository, store, autosave, edit } = await setup();
    const { win, doc } = page();
    bindPageLifecycle(autosave, store, win, doc);
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true });
      win.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(leave()).toBe(false);
    edit();
    expect(leave()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(repository.saves).toBe(1);
    expect(leave()).toBe(false);
  });
});
