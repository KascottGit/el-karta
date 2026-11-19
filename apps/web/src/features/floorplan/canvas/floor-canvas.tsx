import type Konva from 'konva';
import { useEffect, useRef, type RefObject } from 'react';
import { Group, Layer, Stage } from 'react-konva';
import { editorStore, useEditorStore } from '../editor-store';
import type { CanvasContext, CanvasLayer, CanvasPointer, ResolvedExtensions } from './extension';
import { createGestureController, type PointerInput, type PointerKind } from './gestures';
import { panBy, pinchStep, screenToWorld, zoomAt, type Viewport } from './viewport';

// Konva gives each Layer its own canvas and advises against more than a few, so the logical
// layers share three: static underlay, model content, and frequently redrawn overlays.
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

/** The Konva stage: renders registered layer content and routes pointer input to the tool and the view. */
export function FloorCanvas({
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

  // The view moves by transforming the stage directly, so panning never re-renders React.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const apply = ({ x, y, scale }: Viewport) => {
      stage.setAttrs({ x, y, scaleX: scale, scaleY: scale });
      stage.batchDraw();
    };
    apply(editorStore.getState().viewport);
    return editorStore.subscribe((s, prev) => {
      if (s.viewport !== prev.viewport) apply(s.viewport);
    });
  }, [stageRef]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let spaceHeld = false;
    const tool = () => registry.tool(editorStore.getState().tool);
    const setView = (update: (vp: Viewport) => Viewport) => {
      const { viewport, setViewport } = editorStore.getState();
      setViewport(update(viewport));
    };
    const toCanvas = (p: PointerInput): CanvasPointer => ({
      world: screenToWorld(editorStore.getState().viewport, p),
      screen: { x: p.x, y: p.y },
      kind: p.kind,
      shiftKey: p.shiftKey,
      altKey: p.altKey,
      modKey: p.modKey,
    });

    const gestures = createGestureController({
      hover: (p) => tool().onHover?.(toCanvas(p), ctx),
      tap: (p) => tool().onTap?.(toCanvas(p), ctx),
      doubleTap: (p) => {
        const t = tool();
        if (t.onDoubleTap) t.onDoubleTap(toCanvas(p), ctx);
        else t.onTap?.(toCanvas(p), ctx);
      },
      dragStart: (start, p) => tool().onDragStart?.(toCanvas(start), toCanvas(p), ctx) ?? false,
      drag: (p) => tool().onDrag?.(toCanvas(p), ctx),
      dragEnd: (p) => tool().onDragEnd?.(toCanvas(p), ctx),
      dragCancel: () => tool().onDragCancel?.(ctx),
      pan: (dx, dy) => {
        setView((vp) => panBy(vp, dx, dy));
      },
      pinch: (prevA, prevB, a, b) => {
        setView((vp) => pinchStep(vp, prevA, prevB, a, b));
      },
    });

    const updateCursor = () => {
      const mode = gestures.mode;
      el.style.cursor =
        mode === 'pan' ? 'grabbing' : spaceHeld ? 'grab' : (tool().cursor ?? 'default');
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
        claimed: e.defaultPrevented,
        panKey: spaceHeld,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        modKey: e.ctrlKey || e.metaKey,
      };
    };

    const onDown = (e: PointerEvent) => {
      const p = input(e);
      gestures.down(p);
      if (!p.claimed && gestures.mode !== 'idle') el.setPointerCapture(e.pointerId);
      updateCursor();
    };
    const onMove = (e: PointerEvent) => {
      gestures.move(input(e));
    };
    const onUp = (e: PointerEvent) => {
      gestures.up(input(e));
      updateCursor();
    };
    const onCancel = (e: PointerEvent) => {
      gestures.cancel(input(e));
      updateCursor();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit =
        e.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? LINE_HEIGHT_PX
          : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? el.clientHeight
            : 1;
      const rect = el.getBoundingClientRect();
      const anchor = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (e.shiftKey) {
        setView((vp) => panBy(vp, -e.deltaX * unit, -e.deltaY * unit));
      } else {
        // Trackpad pinches arrive as wheel events with ctrlKey and small deltas.
        const speed = e.ctrlKey ? PINCH_WHEEL_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
        setView((vp) => zoomAt(vp, anchor, Math.exp(-e.deltaY * unit * speed)));
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const down = e.type === 'keydown';
      // Space still presses a focused button or types in a field.
      if (down && e.target !== document.body) return;
      if (down) e.preventDefault();
      spaceHeld = down;
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
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      offTool();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onCancel);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [ctx, registry]);

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
}
