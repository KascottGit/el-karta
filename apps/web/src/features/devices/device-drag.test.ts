import { describe, expect, it } from 'vitest';
import { withoutDragged } from './device-drag';

const mark = (id: string) => ({ device: { id } });

describe('withoutDragged', () => {
  it('leaves out the dragged device, and returns the same array when nothing is dragged', () => {
    const marks = [mark('a'), mark('b'), mark('c')];
    expect(withoutDragged(marks, 'b')).toEqual([mark('a'), mark('c')]);
    expect(withoutDragged(marks, undefined)).toBe(marks);
  });
});
