import type { FloorCollection, Id, Pt } from '@el-karta/core';
import type Konva from 'konva';
import { FLOOR_COLLECTIONS, type SelectionItem } from './selection';

const PREFIX = 'selectable:';

/** Props that make a Konva node (or a group around several) selectable as a model item. */
export const selectable = (collection: FloorCollection, id: Id) => ({
  id,
  name: `${PREFIX}${collection}`,
});

const collectionOf = (name: string): FloorCollection | undefined => {
  if (!name.startsWith(PREFIX)) return undefined;
  const collection = name.slice(PREFIX.length);
  return FLOOR_COLLECTIONS.find((c) => c === collection);
};

/** Uses Konva's hit graph, so whatever is drawn on top wins and shapes need no hit-testing code of their own. */
export function itemAt(stage: Konva.Stage, screen: Pt): SelectionItem | null {
  let node: Konva.Node | null = stage.getIntersection(screen);
  while (node && node !== stage) {
    const collection = collectionOf(node.name());
    if (collection) return { collection, id: node.id() };
    node = node.getParent();
  }
  return null;
}
