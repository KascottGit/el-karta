import { useTranslation } from 'react-i18next';
import type { CanvasContext, ResolvedExtensions } from './extension';
import { useCanvasState } from './use-canvas-state';

/** The registered panels whose `visible` holds; a sheet over the canvas on phones, a column beside it on wider screens. */
export function SidePanel({ ctx, registry }: { ctx: CanvasContext; registry: ResolvedExtensions }) {
  const { t } = useTranslation();
  const visibleIds = useCanvasState((editor, model) =>
    registry.panels
      .filter((p) => p.visible(editor, model))
      .map((p) => p.id)
      .join(' '),
  );
  if (!visibleIds) return null;
  const visible = new Set(visibleIds.split(' '));
  return (
    <aside
      aria-label={t('canvas.sidePanel')}
      className="absolute inset-x-2 bottom-2 z-10 flex max-h-[45%] flex-col gap-4 overflow-y-auto rounded-lg border bg-background/95 p-3 shadow-md md:static md:max-h-none md:w-72 md:shrink-0 md:shadow-none"
    >
      {registry.panels
        .filter((p) => visible.has(p.id))
        .map(({ id, Component }) => (
          <Component key={id} ctx={ctx} />
        ))}
    </aside>
  );
}
