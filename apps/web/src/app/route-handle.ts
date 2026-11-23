/** Route `handle` data read by the app layout. */
export interface RouteHandle {
  /** The page fills the screen below the header, without the page padding. */
  fullBleed?: boolean;
}

export const isFullBleed = (handle: unknown): boolean =>
  typeof handle === 'object' && handle !== null && (handle as RouteHandle).fullBleed === true;
