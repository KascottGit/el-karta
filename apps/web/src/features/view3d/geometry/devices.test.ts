import { describe, expect, it } from 'vitest';
import { deviceAppearance } from '@/features/devices/appearance';
import { deviceTransforms } from './devices';
import { FloorFixture, pt } from './test-fixtures';

const close = (v: { x: number; y: number; z: number }) => ({
  x: Math.round(v.x * 1000) / 1000 + 0,
  y: Math.round(v.y * 1000) / 1000 + 0,
  z: Math.round(v.z * 1000) / 1000 + 0,
});

describe('deviceTransforms', () => {
  it('puts a wall device on the face of its side, facing out of the wall', () => {
    const floor = new FloorFixture(2.5, 3);
    const wall = floor.wall(pt(0, 0), pt(4, 0), { thickness: 0.2 });
    const left = floor.device({
      kind: 'wall',
      wallId: wall.id,
      offset: 1,
      height: 0.3,
      side: 'left',
    });
    const right = floor.device({
      kind: 'wall',
      wallId: wall.id,
      offset: 2,
      height: 1.1,
      side: 'right',
    });
    const [l, r] = deviceTransforms(floor.data);
    // With y down, left of a wall running along +x is towards -y.
    expect(l).toMatchObject({ kind: 'marker', deviceId: left.id, flagged: false });
    expect(l?.kind === 'marker' && close(l.position)).toEqual({ x: 1, y: -0.1, z: 0.3 });
    expect(l?.kind === 'marker' && close(l.facing)).toEqual({ x: 0, y: -1, z: 0 });
    expect(r).toMatchObject({ kind: 'marker', deviceId: right.id, flagged: false });
    expect(r?.kind === 'marker' && close(r.position)).toEqual({ x: 2, y: 0.1, z: 1.1 });
    expect(r?.kind === 'marker' && close(r.facing)).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('takes shape and colour from the appearance registration', () => {
    const floor = new FloorFixture();
    const device = floor.device({ kind: 'floor', at: pt(1, 1) }, { type: 'switch' });
    const [t] = deviceTransforms(floor.data);
    expect(t).toMatchObject(deviceAppearance(device));
  });

  it('hangs a ceiling device under its room’s own ceiling height, facing down', () => {
    const floor = new FloorFixture(2.5, 3);
    const room = floor.room([pt(0, 0), pt(4, 0), pt(4, 4), pt(0, 4)], { ceilingHeight: 2.2 });
    floor.device({ kind: 'ceiling', roomId: room.id, at: pt(2, 2) });
    const [t] = deviceTransforms(floor.data);
    expect(t).toMatchObject({
      kind: 'marker',
      position: { x: 2, y: 2, z: 2.2 },
      facing: { x: 0, y: 0, z: -1 },
      flagged: false,
    });
  });

  it('draws a floor device with a size as a box standing on the floor, turned by its rotation', () => {
    const floor = new FloorFixture(2.5, 3);
    const desk = floor.device(
      { kind: 'floor', at: pt(2, 3), rotation: 90, size: { x: 1.6, y: 0.8, z: 0.75 } },
      { domain: 'furnishing', type: 'desk' },
    );
    const [t] = deviceTransforms(floor.data);
    expect(t).toEqual({
      kind: 'box',
      deviceId: desk.id,
      center: { x: 2, y: 3, z: 0.375 },
      size: { x: 1.6, y: 0.8, z: 0.75 },
      rotation: Math.PI / 2,
      color: deviceAppearance(desk).color,
      flagged: false,
    });
  });

  it('draws a floor device without a size as an upward marker on the floor', () => {
    const floor = new FloorFixture(2.5, 3);
    floor.device({ kind: 'floor', at: pt(2, 3), size: { x: 0, y: 1, z: 1 } });
    expect(deviceTransforms(floor.data)).toMatchObject([
      { kind: 'marker', position: { x: 2, y: 3, z: 0 }, facing: { x: 0, y: 0, z: 1 } },
    ]);
  });

  it('draws an unresolved device at its approximate position, flagged', () => {
    const floor = new FloorFixture();
    const wall = floor.wall(pt(0, 0), pt(4, 0));
    floor.device({ kind: 'wall', wallId: wall.id, offset: 6, height: 1, side: 'right' });
    const [t] = deviceTransforms(floor.data);
    expect(t).toMatchObject({ kind: 'marker', flagged: true });
    expect(t?.kind === 'marker' && close(t.position)).toEqual({ x: 4, y: 0.1, z: 1 });
  });

  it('skips an unresolved device with no approximate position', () => {
    const floor = new FloorFixture();
    floor.device({ kind: 'wall', wallId: crypto.randomUUID(), offset: 1, height: 1, side: 'left' });
    floor.device({ kind: 'ceiling', roomId: crypto.randomUUID(), at: pt(1, 1) });
    expect(deviceTransforms(floor.data)).toEqual([]);
  });

  it('gives devices in a container no transform of their own', () => {
    const floor = new FloorFixture();
    const panel = floor.device({ kind: 'floor', at: pt(1, 1) }, { type: 'main_panel' });
    floor.device({ kind: 'container', parentId: panel.id, slot: 0 }, { type: 'breaker' });
    expect(deviceTransforms(floor.data).map((t) => t.deviceId)).toEqual([panel.id]);
  });
});
