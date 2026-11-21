import { describe, expect, it } from 'vitest';
import { createPassRegistry, type AnyAiPass } from '../src/index.ts';

const pass = (id: string) => ({ id }) as AnyAiPass;

describe('createPassRegistry', () => {
  it('finds passes by id', () => {
    const registry = createPassRegistry([pass('floorplan'), pass('photo')]);
    expect(registry.get('photo')?.id).toBe('photo');
    expect(registry.ids()).toEqual(['floorplan', 'photo']);
  });

  it('refuses duplicate ids', () => {
    expect(() => createPassRegistry([pass('a'), pass('a')])).toThrow(/Duplicate/);
  });
});
