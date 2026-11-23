import { addDevice, applyEdit, removeSpaceItem, type Device } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { projectWith, pt, wall } from '@/features/floorplan/walls/test-fixtures';
import { DEVICE_ISSUE_CODES, deviceIssues } from './device-issues';
import { deviceTypeName } from './type-name';

const device = (
  id: string,
  placement: Device['placement'],
  extra: Partial<Device> = {},
): Device => ({
  id,
  domain: 'power',
  type: 'outlet',
  label: id,
  placement,
  props: {},
  ports: [],
  provenance: { status: 'manual' },
  ...extra,
});

describe('device issues', () => {
  it('flags a device whose wall is gone, keyed by device', () => {
    const { model, floorId } = projectWith([wall(pt(0, 0), pt(4, 0), 0.2, 'w')]);
    let next = applyEdit(
      model,
      addDevice(
        floorId,
        device('outlet', { kind: 'wall', wallId: 'w', offset: 1, height: 0.3, side: 'left' }),
      ),
    ).model;
    expect(deviceIssues(next.floors[floorId]!).size).toBe(0);
    next = applyEdit(next, removeSpaceItem(floorId, 'walls', 'w')).model;
    const issues = deviceIssues(next.floors[floorId]!);
    expect(issues.get('outlet')?.map((i) => i.code)).toEqual(['placement.wall-missing']);
    expect(deviceIssues(next.floors[floorId]!)).toBe(issues);
  });

  it('flags both devices of a taken slot and a missing room by the device', () => {
    const { model, floorId } = projectWith();
    let next = model;
    for (const d of [
      device('panel', { kind: 'floor', at: pt(1, 1) }, { type: 'main_panel' }),
      device('first', { kind: 'container', parentId: 'panel', slot: 0 }, { type: 'breaker' }),
      device('second', { kind: 'container', parentId: 'panel', slot: 0 }, { type: 'breaker' }),
      device('roomless', { kind: 'floor', at: pt(2, 2) }, { roomId: 'gone' }),
    ]) {
      next = applyEdit(next, addDevice(floorId, d)).model;
    }
    const issues = deviceIssues(next.floors[floorId]!);
    expect(issues.get('first')?.map((i) => i.code)).toEqual(['placement.slot-taken']);
    expect(issues.get('second')?.map((i) => i.code)).toEqual(['placement.slot-taken']);
    expect(issues.get('roomless')?.map((i) => i.code)).toEqual(['device.room-missing']);
    expect(issues.has('panel')).toBe(false);
  });

  it('has a Swedish message for every device issue', () => {
    for (const code of DEVICE_ISSUE_CODES) {
      const key = `issues.${code}`;
      expect(i18n.exists(key) || i18n.exists(`${key}_other`), code).toBe(true);
    }
    expect(i18n.t('issues.placement.wall-missing')).toBe(
      'Väggen som enheten sitter på finns inte.',
    );
  });
});

describe('deviceTypeName', () => {
  it('names known types in Swedish and falls back to a generic name', () => {
    expect(deviceTypeName({ domain: 'power', type: 'outlet' })).toBe('Vägguttag');
    expect(deviceTypeName({ domain: 'furnishing', type: 'desk' })).toBe('Skrivbord');
    expect(deviceTypeName({ domain: 'power', type: 'flux_capacitor' })).toBe('Enhet');
    expect(deviceTypeName({ domain: 'unknown', type: 'thing' })).toBe('Enhet');
  });
});
