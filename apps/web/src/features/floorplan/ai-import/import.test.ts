import type { BackgroundPlacement, Suggestion, SuggestionDraft } from '@el-karta/core';
import { AiPassError } from '@el-karta/data-supabase';
import { describe, expect, it } from 'vitest';
import { withoutAccepted } from './dedupe';
import { encodeWithin, ENCODINGS, MAX_IMAGE_CHARS } from './encode';
import { abortable } from '@/lib/ai-pass';
import { importErrorCode, ImportError } from './errors';

const accepted = (kind: string, payload: unknown): Suggestion => ({
  id: crypto.randomUUID(),
  projectId: 'p',
  floorId: 'f',
  runId: null,
  pass: 'floorplan',
  kind,
  source: 'ai:floorplan:m',
  payload,
  issues: [],
  requires: [],
  status: 'accepted',
});

const draft = (id: string, kind: string, payload: unknown, requires: string[] = []) =>
  ({ id, kind, payload, issues: [], requires }) satisfies SuggestionDraft;

describe('withoutAccepted', () => {
  // The old suggestions were measured at 1 cm per pixel; the new ones at 2 cm, about the corner.
  const from: BackgroundPlacement = { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: 0.01 };
  const to: BackgroundPlacement = { offset: { x: 0, y: 0 }, rotation: 0, metresPerPixel: 0.02 };
  const at = (placement: BackgroundPlacement) => (suggestion: Suggestion) => ({
    suggestion,
    placement,
  });
  const square = (k: number) => [
    { x: 0, y: 0 },
    { x: 4 * k, y: 0 },
    { x: 4 * k, y: 3 * k },
    { x: 0, y: 3 * k },
  ];
  const door = (id: string, wallId: string, offset: number) => ({
    id,
    wallId,
    kind: 'door',
    offset,
    width: 1,
    height: 2.1,
    hinge: 'left',
    swing: 'in',
  });

  it('drops walls and rooms already accepted, wherever they lie on the image now', () => {
    const wall = accepted('wall', {
      id: 'w',
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      thickness: 0.1,
    });
    const done = [
      wall,
      accepted('room', { id: 'r', name: 'Kök', type: 'kitchen', polygon: square(1) }),
    ].map(at(from));
    const drafts = [
      // The same wall, drawn the other way, at the new scale.
      draft('w1', 'wall', { id: 'x1', a: { x: 8, y: 0 }, b: { x: 0, y: 0 }, thickness: 0.2 }),
      draft('o1', 'opening', door('y1', 'x1', 1), ['w1']),
      draft('w2', 'wall', { id: 'x2', a: { x: 8, y: 0 }, b: { x: 8, y: 6 }, thickness: 0.2 }),
      draft('o2', 'opening', door('y2', 'x2', 1), ['w2']),
      draft('r1', 'room', { id: 'z1', name: 'Kök', type: 'kitchen', polygon: square(2) }),
      draft('r2', 'room', { id: 'z2', name: 'Hall', type: 'hallway', polygon: square(2) }),
      draft('s', 'scale', { source: 'user', metresPerPixel: 0.02 }),
    ];
    const kept = withoutAccepted(drafts, done, to);
    expect(kept.map((d) => d.id)).toEqual(['o1', 'w2', 'o2', 'r2', 's']);

    // The door on the repeated wall moves onto the accepted one, which runs the other way: the
    // same span from its other end, and hinge and swing flipped.
    const moved = kept.find((d) => d.id === 'o1')!;
    expect(moved.requires).toEqual([wall.id]);
    expect(moved.payload).toMatchObject({
      id: 'y1',
      wallId: 'w',
      offset: 6,
      hinge: 'right',
      swing: 'out',
    });
  });

  it('moves each accepted item from the placement it was measured at', () => {
    // Measured at 2 cm per pixel, where the new drafts are too.
    const done = [
      accepted('wall', { id: 'w', a: { x: 0, y: 0 }, b: { x: 8, y: 0 }, thickness: 0.1 }),
    ].map(at(to));
    const drafts = [draft('w1', 'wall', { id: 'x', a: { x: 0, y: 0 }, b: { x: 8, y: 0 } })];
    expect(withoutAccepted(drafts, done, to)).toEqual([]);
    // Read as measured at 1 cm per pixel, the same wall would now span 0–16 m: another wall.
    const elsewhere = done.map((d) => ({ ...d, placement: from }));
    expect(withoutAccepted(drafts, elsewhere, to)).toEqual(drafts);
  });
});

describe('encodeWithin', () => {
  it('uses the first encoding that fits under the body cap', async () => {
    const tried: string[] = [];
    const image = await encodeWithin((e) => {
      tried.push(`${e.mimeType}@${e.scale}`);
      return Promise.resolve('x'.repeat(e.scale < 1 ? 10 : MAX_IMAGE_CHARS + 1));
    });
    expect(tried).toEqual(['image/png@1', 'image/jpeg@1', 'image/jpeg@0.7']);
    expect(image).toEqual({ mimeType: 'image/jpeg', data: 'x'.repeat(10) });
  });

  it('gives up with too_large when nothing fits', async () => {
    let calls = 0;
    await expect(
      encodeWithin(() => {
        calls++;
        return Promise.resolve('xx');
      }, 1),
    ).rejects.toEqual(new ImportError('too_large'));
    expect(calls).toBe(ENCODINGS.length);
  });
});

describe('import errors', () => {
  it('maps function refusals and lost connections to their messages', () => {
    expect(importErrorCode(new AiPassError('rate_limited', 'x', 429))).toBe('rate_limited');
    expect(importErrorCode(new AiPassError('too_large', 'x', 413))).toBe('too_large');
    expect(importErrorCode(new AiPassError('forbidden', 'x', 403))).toBe('forbidden');
    expect(importErrorCode(new AiPassError('internal', 'x', 500))).toBe('internal');
    expect(importErrorCode(new AiPassError('internal', 'Failed to send a request'))).toBe(
      'network',
    );
    expect(importErrorCode(new ImportError('empty'))).toBe('empty');
    expect(importErrorCode(new Error('?'))).toBe('internal');
  });

  it('abortable rejects as soon as the signal aborts, and passes results through otherwise', async () => {
    const abort = new AbortController();
    const pending = abortable(new Promise(() => {}), abort.signal);
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(abortable(Promise.resolve(1), new AbortController().signal)).resolves.toBe(1);
    await expect(abortable(Promise.resolve(1), abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
