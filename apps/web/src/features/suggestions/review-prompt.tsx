import { useTranslation } from 'react-i18next';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { editorStore } from '@/features/floorplan/editor-store';
import { Button } from '@/ui/button';
import { onFloor, useSuggestions } from './suggestions-store';
import { SUGGESTIONS_TOOL } from './tool';

/**
 * "N förslag att granska" with a button to the review tool, so pending suggestions are not missed
 * (shown while `reviewPromptVisible`).
 */
export function ReviewPrompt({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const count = useSuggestions((s) => onFloor(s.pending, ctx.floorId) ?? 0);
  return (
    <section
      aria-label={t('suggestions.tool')}
      className="flex flex-wrap items-center justify-between gap-2"
    >
      <p className="text-sm">{t('suggestions.remaining', { count })}</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          editorStore.getState().setTool(SUGGESTIONS_TOOL);
        }}
      >
        {t('suggestions.review')}
      </Button>
    </section>
  );
}
