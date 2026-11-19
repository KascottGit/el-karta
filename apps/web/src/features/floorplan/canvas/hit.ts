import type { FloorCollection, Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import type { Handle, ResolvedExtensions } from './extension';
import type { PointerKind } from './gestures';
import { FLOOR_COLLECTIONS, type SelectionItem } from './selection';

const SELECTABLE = 'selectable:';
const HANDLE = 'handle:';
const HANDLE_PAYLOAD = 'handlePayload';

/** Props that make a Konva node (or a group around several) selectable as a model item. */
export const selectable = (collection: FloorCollection, id: Id) => ({
  id,
  name: `${SELECTABLE}${collection}`,
});

/** Props that make a Konva node a drag handle; the payload comes back in the handle's callbacks. */
export const handle = <P>(spec: Handle<P>, payload: P) => ({
  name: `${HANDLE}${spec.name}`,
  [HANDLE_PAYLOAD]: payload,
});

/** Finger-sized search radius in pixels, so thin walls and small handles can be tapped. */
export const TOUCH_RADIUS = 12;

/** The point itself, then rings at half and full radius. */
export function samplePoints(center: Pt, radius: number): Pt[] {
  const points = [center];
  if (radius <= 0) return points;
  for (const r of [radius / 2, radius]) {
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      points.push({ x: center.x + r * Math.cos(angle), y: center.y + r * Math.sin(angle) });
    }
  }
  return points;
}

/** Uses Konva's hit graph, so whatever is drawn on top wins and shapes need no hit-testing code. */
function findAt<T>(
  stage: Konva.Stage,
  screen: Pt,
  kind: PointerKind,
  match: (node: Konva.Node) => T | undefined,
): T | null {
  for (const point of samplePoints(screen, kind === 'touch' ? TOUCH_RADIUS : 0)) {
    let node: Konva.Node | null = stage.getIntersection(point);
    while (node && node !== stage) {
      const found = match(node);
      if (found !== undefined) return found;
      node = node.getParent();
    }
  }
  return null;
}

export function itemAt(stage: Konva.Stage, screen: Pt, kind: PointerKind): SelectionItem | null {
  return findAt(stage, screen, kind, (node) => {
    const name = node.name();
    if (!name.startsWith(SELECTABLE)) return undefined;
    const collection = FLOOR_COLLECTIONS.find((c) => c === name.slice(SELECTABLE.length));
    return collection && { collection, id: node.id() };
  });
}

export interface HandleHit {
  handle: Handle<never>;
  payload: unknown;
}

export function handleAt(
  stage: Konva.Stage,
  screen: Pt,
  kind: PointerKind,
  registry: ResolvedExtensions,
): HandleHit | null {
  return findAt(stage, screen, kind, (node) => {
    const name = node.name();
    const spec = name.startsWith(HANDLE) ? registry.handles.get(name.slice(HANDLE.length)) : null;
    return spec ? { handle: spec, payload: node.getAttr(HANDLE_PAYLOAD) as unknown } : undefined;
  });
}
