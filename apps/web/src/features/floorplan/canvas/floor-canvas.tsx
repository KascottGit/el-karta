import Konva from 'konva';
import { memo, useEffect, useRef, type RefObject } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext, CanvasLayer, ResolvedExtensions } from './extension';
import type { PointerInput, PointerKind } from './gestures';
import { handleAt, invalidateHitGraph } from './hit';
import { createPointerDispatch } from './pointer-dispatch';
import { panBy, zoomAt, type Viewport } from './viewport';
import { wheelIntent } from './wheel';

// Konva gives each Layer its own canvas and advises against more than a few, so the logical
// layers share three: static underlay, model content, and frequently redrawn overlays (ADR 0006).
const KONVA_LAYERS: readonly (readonly CanvasLayer[])[] = [
  ['background', 'grid'],
  ['areas', 'walls', 'openings'],
  ['overlays'],
];

const WHEEL_ZOOM_SPEED = 0.0015;
const PINCH_WHEEL_ZOOM_SPEED = 0.01;
const LINE_HEIGHT_PX = 16;

const pointerKind = (type: string): PointerKind =>
  type === 'touch' || type === 'pen' ? type : 'mouse';

/**
 * The Konva stage: renders registered layer content and routes input to tools, handles and the view.
 * Memoized, because re-rendering the stage reconciles every layer.
 */
export const FloorCanvas = memo(function FloorCanvas({
  ctx,
  registry,
  stageRef,
}: {
  ctx: CanvasContext;
  registry: ResolvedExtensions;
  stageRef: RefObject<Konva.Stage | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useEditorStore((s) => s.size);
  const ctxRef = useRef(ctx);
  useEffect(() => {
    ctxRef.current = ctx;
  }, [ctx]);

  // Fits the floor once when the canvas first has a size; switching floors keeps the view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      editorStore.getState().setSize({ width, height });
      if (!measured && width > 0 && height > 0) {
        measured = true;
        ctxRef.current.zoomToFit();
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // The view moves by transforming the stage directly, so panning never re-renders React. It
  // redraws only the scene; the hit graph is redrawn when something is next hit-tested.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let frame = 0;
    const drawScene = () => {
      frame = 0;
      for (const layer of stage.getLayers()) layer.drawScene();
    };
    const apply = ({ x, y, scale }: Viewport) => {
      // Konva's automatic redraw would also redraw the hit graph.
      const autoDraw = Konva.autoDrawEnabled;
      Konva.autoDrawEnabled = false;
      stage.setAttrs({ x, y, scaleX: scale, scaleY: scale });
      Konva.autoDrawEnabled = autoDraw;
      invalidateHitGraph(stage);
      frame ||= requestAnimationFrame(drawScene);
    };
    apply(editorStore.getState().viewport);
    const unsubscribe = editorStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport) apply(s.viewport);
    });
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [stageRef]);

  useEffect(() => {
    const el = containerRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;
    let spaceHeld = false;
    const dispatch = createPointerDispatch({
      registry,
      ctx,
      handleAt: (screen, kind) => handleAt(stage, screen, kind, registry),
    });

    const updateCursor = () => {
      el.style.cursor =
        dispatch.mode === 'pan'
          ? 'grabbing'
          : spaceHeld
            ? 'grab'
            : (registry.tool(editorStore.getState().tool).cursor ?? 'default');
    };

    const input = (e: PointerEvent): PointerInput => {
      const rect = el.getBoundingClientRect();
      return {
        id: e.pointerId,
        kind: pointerKind(e.pointerType),
        button: e.button,
        buttons: e.buttons,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        time: e.timeStamp,
        panKey: spaceHeld,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        modKey: e.ctrlKey || e.metaKey,
      };
    };

    const onDown = (e: PointerEvent) => {
      dispatch.down(input(e));
      if (dispatch.mode !== 'idle') el.setPointerCapture(e.pointerId);
      updateCursor();
    };
    const onMove = (e: PointerEvent) => {
      dispatch.move(input(e));
    };
    const onUp = (e: PointerEvent) => {
      dispatch.up(input(e));
      updateCursor();
    };
    const onCancel = (e: PointerEvent) => {
      dispatch.cancel(input(e));
      updateCursor();
    };
    const onLeave = (e: PointerEvent) => {
      dispatch.leave(input(e));
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_HEIGHT_PX
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? el.clientHeight
            : 1;
      const { viewport, setViewport } = editorStore.getState();
      if (wheelIntent(e, window.devicePixelRatio) === 'pan') {
        setViewport(panBy(viewport, -e.deltaX * unit, -e.deltaY * unit));
        return;
      }
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const speed = e.ctrlKey ? PINCH_WHEEL_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
      setViewport(zoomAt(viewport, anchor, Math.exp(-e.deltaY * unit * speed)));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && e.type === 'keydown' && dispatch.cancelDrag()) {
        // Listening in the capture phase, so the editor's own Escape handling sees defaultPrevented.
        e.preventDefault();
        updateCursor();
        return;
      }
      if (e.code !== 'Space') return;
      const down = e.type === 'keydown';
      // Space still presses a focused button or types in a field.
      if (down && e.target !== document.body) return;
      if (down) e.preventDefault();
      spaceHeld = down;
      updateCursor();
    };
    const onBlur = () => {
      spaceHeld = false;
      updateCursor();
    };

    updateCursor();
    const offTool = editorStore.subscribe((s, prev) => {
      if (s.tool !== prev.tool) updateCursor();
    });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onCancel);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      dispatch.cancelDrag();
      offTool();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [ctx, registry, stageRef]);

  return (
    <div
      ref={containerRef}
      data-testid="floor-editor-canvas"
      className="absolute inset-0 touch-none overflow-hidden select-none"
      onContextMenu={(e) => {
        e.preventDefault();
      }}
    >
      <Stage ref={stageRef} width={size.width} height={size.height}>
        {KONVA_LAYERS.map((group) => (
          <Layer key={group.join('+')}>
            {group.map((layer) => (
              <Group key={layer} name={`layer-${layer}`}>
                {registry.layers[layer].map(({ id, Component }) => (
                  <Component key={id} ctx={ctx} />
                ))}
              </Group>
            ))}
          </Layer>
        ))}
      </Stage>
    </div>
  );
});
