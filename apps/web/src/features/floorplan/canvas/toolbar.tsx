import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/button';
import { useEditorStore } from '../editor-store';
import { switchTool } from './commands';
import type { Action, CanvasContext, MessageKey, ResolvedExtensions, Tool } from './extension';
import { useCanvasState } from './use-canvas-state';

function useLabel(label: MessageKey, shortcut: string | undefined) {
  const { t } = useTranslation();
  const text = t(label);
  return { text, title: shortcut ? `${text} (${shortcut.toUpperCase()})` : text };
}

/** Registered tools, then registered actions. */
export function Toolbar({ ctx, registry }: { ctx: CanvasContext; registry: ResolvedExtensions }) {
  const { t } = useTranslation();
  return (
    <div
      role="toolbar"
      aria-label={t('canvas.toolbar')}
      className="flex shrink-0 items-center gap-1 overflow-x-auto"
    >
      {registry.tools.map((tool) => (
        <ToolButton key={tool.id} tool={tool} registry={registry} ctx={ctx} />
      ))}
      <div className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden />
      {registry.actions.map((action) => (
        <ActionButton key={action.id} action={action} ctx={ctx} />
      ))}
    </div>
  );
}

function ToolButton({
  tool,
  registry,
  ctx,
}: {
  tool: Tool;
  registry: ResolvedExtensions;
  ctx: CanvasContext;
}) {
  const active = useEditorStore((s) => s.tool === tool.id);
  const { text, title } = useLabel(tool.label, tool.shortcut);
  return (
    <Button
      size="icon-lg"
      variant={active ? 'default' : 'ghost'}
      aria-label={text}
      aria-pressed={active}
      title={title}
      onClick={() => {
        switchTool(tool.id, registry, ctx);
      }}
    >
      <tool.icon />
    </Button>
  );
}

function ActionButton({ action, ctx }: { action: Action; ctx: CanvasContext }) {
  const enabled = useCanvasState((editor, model) => action.enabled?.(editor, model) ?? true);
  const { text, title } = useLabel(action.label, action.shortcut);
  return (
    <Button
      size="icon-lg"
      variant="ghost"
      aria-label={text}
      title={title}
      disabled={!enabled}
      onClick={() => {
        action.run(ctx);
      }}
    >
      <action.icon />
    </Button>
  );
}
