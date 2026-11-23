/**
 * The handles of a wall's gizmo (move along the normal from either face, drag a top corner, set the
 * height) and of an opening's (slide, move its start or end edge, set its top or a window's sill).
 * Kept free of imports, so the e2e tests can name handles through the dev hook's types.
 */
export type HandleName =
  | 'move-left'
  | 'move-right'
  | 'corner-a'
  | 'corner-b'
  | 'height'
  | 'slide'
  | 'start'
  | 'end'
  | 'top'
  | 'sill';
