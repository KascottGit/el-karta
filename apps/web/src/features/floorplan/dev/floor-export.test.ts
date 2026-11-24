import { photoDetectables } from '@el-karta/core';
import { parsePhotoFloor, photoDetectable } from '@el-karta/evals';
import { describe, expect, it } from 'vitest';
import { walledKitchen } from '@/features/photos/test-fixtures';
import { registry } from '@/plugins';
import { floorExport } from './floor-export';

describe('floorExport', () => {
  it('downloads the floor record as the photo evals read it, named after the floor', () => {
    const project = walledKitchen();
    const floor = { ...project.model.floors[project.floorId]!, name: 'Plan 1 – Kök' };
    const { fileName, content } = floorExport(floor);
    expect(fileName).toBe('plan-1-kok.json');
    expect(parsePhotoFloor(JSON.parse(JSON.stringify(content)))).toEqual(floor);
  });
});

describe('the photo evals’ copy of the detectable types', () => {
  it('is what the app sends; update evals/photo/detectable.ts when the plugins change', () => {
    expect(photoDetectable).toEqual(photoDetectables(registry));
  });
});
