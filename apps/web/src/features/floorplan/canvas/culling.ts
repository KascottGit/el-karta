import { intersects, type Rect } from './rect';

/**
 * Returns a query for the items of a collection whose bounding box intersects a rectangle.
 * Bounds are cached per item object, so after an edit only the changed items are measured again.
 */
export function createCuller<B extends object>(bounds: (item: B) => Rect | null) {
  const cache = new WeakMap<B, Rect | null>();
  const boundsOf = (item: B) => {
    let rect = cache.get(item);
    if (rect === undefined) {
      rect = bounds(item);
      cache.set(item, rect);
    }
    return rect;
  };
  return <T extends B>(items: Readonly<Record<string, T>>, view: Rect): T[] => {
    const visible: T[] = [];
    for (const item of Object.values(items)) {
      const rect = boundsOf(item);
      if (rect && intersects(rect, view)) visible.push(item);
    }
    return visible;
  };
}
