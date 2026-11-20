import { intersects, type Rect } from './rect';

const sameItems = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Returns a query for the items of a collection whose bounding box intersects a rectangle.
 * Bounds are cached per item object, so after an edit only the changed items are measured again.
 * When the same items are visible as in the last query of the same collection, it returns that
 * same array, so a render window change that shows nothing new re-renders nothing.
 */
export function createCuller<B extends object>(bounds: (item: B) => Rect | null) {
  const cache = new WeakMap<B, Rect | null>();
  const last = new WeakMap<object, readonly B[]>();
  const boundsOf = (item: B) => {
    let rect = cache.get(item);
    if (rect === undefined) {
      rect = bounds(item);
      cache.set(item, rect);
    }
    return rect;
  };
  return <T extends B>(items: Readonly<Record<string, T>>, view: Rect): readonly T[] => {
    const visible: T[] = [];
    for (const item of Object.values(items)) {
      const rect = boundsOf(item);
      if (rect && intersects(rect, view)) visible.push(item);
    }
    const previous = last.get(items) as readonly T[] | undefined;
    if (previous && sameItems(previous, visible)) return previous;
    last.set(items, visible);
    return visible;
  };
}
