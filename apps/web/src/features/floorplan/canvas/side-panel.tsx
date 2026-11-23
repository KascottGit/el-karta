import { useTranslation } from 'react-i18next';
import type { CanvasContext, ResolvedExtensions } from './extension';
import { useCanvasState } from './use-canvas-state';

/** The registered panels whose `visible` holds; a bottom sheet over the canvas on phones, a column beside it on wider screens. */
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
      className="absolute inset-x-0 bottom-0 z-10 flex max-h-[55%] flex-col gap-4 overflow-y-auto overscroll-contain rounded-t-xl border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgb(0_0_0/0.08)] md:static md:max-h-none md:w-80 md:shrink-0 md:rounded-none md:border-t-0 md:border-l md:bg-background md:p-4 md:shadow-none"
    >
      {registry.panels
        .filter((p) => visible.has(p.id))
        .map(({ id, Component }) => (
          <Component key={id} ctx={ctx} />
        ))}
    </aside>
  );
}
