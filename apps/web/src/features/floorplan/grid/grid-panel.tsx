import {
  addGridLine,
  evenGrid,
  gridCell,
  gridLines,
  isAutoLabelled,
  moveGridLine,
  relabelGrid,
  removeGridLine,
  renameGridLine,
  sortLines,
  type Grid,
  type GridAxis,
} from '@el-karta/core';
import { X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { useModelStore } from '@/model/store';
import { Button } from '@/ui/button';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { useEditorStore } from '../editor-store';
import type { CanvasContext } from '../canvas/extension';
import type { Rect } from '../canvas/rect';
import { CommitInput } from '../fields/commit-input';
import { formatDecimal, parseDecimal } from '../fields/numbers';
import { coveringLines, DEFAULT_SPACING, nextLinePos } from './defaults';
import { editGrid, gridUiStore } from './interaction';
import { selectionCells } from './item-anchor';
import { useContentBounds } from './use-grid-geometry';

const AXES: readonly GridAxis[] = ['x', 'y'];
const MAX_LINES = 200;
const MAX_CELLS_SHOWN = 6;

const rangeOf = (content: Rect | null, axis: GridAxis): [number, number] | null =>
  content && (axis === 'x' ? [content.minX, content.maxX] : [content.minY, content.maxY]);

/** Positions to the millimetre. */
const formatMetres = (n: number) => formatDecimal(n, 3);
const isNumber = (text: string) => parseDecimal(text) !== null;
const isLabel = (text: string) => text.trim() !== '';

/** The grid tool's side panel: the location under the pointer, the lines, and an evenly spaced grid. */
export function GridPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const grid = useModelStore((s) => s.model?.floors[ctx.floorId]?.data.grid);
  const content = useContentBounds(ctx.floorId);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-sm font-semibold">
          {t('grid.title')}
        </h2>
        <PointerCell grid={grid} />
      </div>
      {AXES.map((axis) => (
        <AxisLines key={axis} ctx={ctx} axis={axis} grid={grid} content={content} />
      ))}
      <EvenGridForm key={ctx.floorId} ctx={ctx} hasGrid={grid !== undefined} content={content} />
      {grid && (
        <Button
          variant="destructive"
          onClick={() => {
            editGrid(ctx.floorId, () => null);
          }}
        >
          {t('grid.remove')}
        </Button>
      )}
    </section>
  );
}

function PointerCell({ grid }: { grid: Grid | undefined }) {
  const { t } = useTranslation();
  const cell = useStore(gridUiStore, (s) => (s.pointer && grid ? gridCell(grid, s.pointer) : null));
  const hasPointer = useStore(gridUiStore, (s) => s.pointer !== null);
  if (!grid) return <p className="text-sm text-muted-foreground">{t('grid.empty')}</p>;
  return (
    <p className="text-sm text-muted-foreground" aria-live="polite">
      {hasPointer
        ? t('grid.pointerCell', { cell: cell ?? t('grid.outside') })
        : t('grid.pointerHint')}
    </p>
  );
}

function AxisLines({
  ctx,
  axis,
  grid,
  content,
}: {
  ctx: CanvasContext;
  axis: GridAxis;
  grid: Grid | undefined;
  content: Rect | null;
}) {
  const { t } = useTranslation();
  const lines = useMemo(() => (grid ? sortLines(gridLines(grid, axis)) : []), [grid, axis]);
  const edit = (change: (grid: Grid) => Grid | null) => {
    editGrid(ctx.floorId, change);
  };
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">{t(`grid.axis.${axis}`)}</legend>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1">
          {lines.map((line, index) => (
            <li key={index} className="flex items-center gap-1">
              <CommitInput
                className="w-14"
                aria-label={t('grid.lineLabel', { label: line.label })}
                value={line.label}
                valid={isLabel}
                onCommit={(text) => {
                  edit((g) => renameGridLine(g, axis, index, text));
                }}
              />
              <CommitInput
                className="flex-1"
                inputMode="decimal"
                aria-label={t('grid.linePosition', { label: line.label })}
                value={formatMetres(line.pos)}
                valid={isNumber}
                onCommit={(text) => {
                  const pos = parseDecimal(text);
                  if (pos !== null) edit((g) => moveGridLine(g, axis, index, pos));
                }}
              />
              <span className="text-sm text-muted-foreground">{t('fields.metres')}</span>
              <Button
                size="icon"
                variant="ghost"
                aria-label={t('grid.removeLine', { label: line.label })}
                title={t('grid.removeLine', { label: line.label })}
                onClick={() => {
                  edit((g) => removeGridLine(g, axis, index));
                }}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            const fallback = rangeOf(content, axis)?.[0] ?? 0;
            edit((g) => addGridLine(g, axis, nextLinePos(gridLines(g, axis), fallback)));
          }}
        >
          {t('grid.addLine')}
        </Button>
        {!isAutoLabelled(axis, lines) && (
          <Button
            variant="ghost"
            onClick={() => {
              edit((g) => relabelGrid(g, axis));
            }}
          >
            {t('grid.relabel')}
          </Button>
        )}
      </div>
    </fieldset>
  );
}

interface AxisForm {
  count: string;
  spacing: string;
  start: string;
}

function coveringForm(range: [number, number] | null, spacingText: string): AxisForm {
  const spacing = parseDecimal(spacingText);
  const covering = coveringLines(range, spacing && spacing > 0 ? spacing : DEFAULT_SPACING);
  return {
    count: String(covering.count),
    spacing: spacingText,
    start: formatMetres(covering.start),
  };
}

const parseCount = (text: string) => {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= 0 && n <= MAX_LINES ? n : null;
};

function parseAxis(form: AxisForm) {
  const count = parseCount(form.count);
  const spacing = parseDecimal(form.spacing);
  const start = parseDecimal(form.start);
  return count !== null && spacing !== null && spacing > 0 && start !== null
    ? { count, spacing, start }
    : null;
}

/** Creates an evenly spaced grid, by default covering the floor's walls, rooms and zones. */
function EvenGridForm({
  ctx,
  hasGrid,
  content,
}: {
  ctx: CanvasContext;
  hasGrid: boolean;
  content: Rect | null;
}) {
  const { t } = useTranslation();
  const defaultSpacing = formatMetres(DEFAULT_SPACING);
  const [form, setForm] = useState<Record<GridAxis, AxisForm>>(() => ({
    x: coveringForm(rangeOf(content, 'x'), defaultSpacing),
    y: coveringForm(rangeOf(content, 'y'), defaultSpacing),
  }));
  const x = parseAxis(form.x);
  const y = parseAxis(form.y);
  const valid = x !== null && y !== null && x.count + y.count > 0;
  const idPrefix = useId();

  const field = (axis: GridAxis, key: keyof AxisForm, label: string) => {
    const id = `${idPrefix}-${axis}-${key}`;
    const invalid = (key === 'count' ? parseCount : parseDecimal)(form[axis][key]) === null;
    return (
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
          {label}
        </Label>
        <Input
          id={id}
          inputMode={key === 'count' ? 'numeric' : 'decimal'}
          value={form[axis][key]}
          aria-invalid={invalid}
          onChange={(e) => {
            setForm((f) => ({ ...f, [axis]: { ...f[axis], [key]: e.target.value } }));
          }}
        />
      </div>
    );
  };

  return (
    <details open={!hasGrid} className="flex flex-col gap-2">
      <summary className="cursor-pointer text-sm font-medium">{t('grid.even.title')}</summary>
      <form
        className="mt-2 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!x || !y || !valid) return;
          editGrid(ctx.floorId, () =>
            evenGrid({
              origin: { x: x.start, y: y.start },
              x: { count: x.count, spacing: x.spacing },
              y: { count: y.count, spacing: y.spacing },
            }),
          );
        }}
      >
        {AXES.map((axis) => (
          <fieldset key={axis} className="grid grid-cols-3 gap-2">
            <legend className="mb-1 text-xs font-medium">{t(`grid.axis.${axis}`)}</legend>
            {field(axis, 'count', t('grid.even.count'))}
            {field(axis, 'spacing', t('grid.even.spacing'))}
            {field(axis, 'start', t(`grid.even.start.${axis}`))}
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!valid}>
            {hasGrid ? t('grid.even.replace') : t('grid.even.create')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!content}
            onClick={() => {
              setForm((f) => ({
                x: coveringForm(rangeOf(content, 'x'), f.x.spacing),
                y: coveringForm(rangeOf(content, 'y'), f.y.spacing),
              }));
            }}
          >
            {t('grid.even.fitFloor')}
          </Button>
        </div>
      </form>
    </details>
  );
}

/** The grid location of the selected items, while the floor has a grid. */
export function SelectionCellPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const selection = useEditorStore((s) => s.selection);
  const data = useModelStore((s) => s.model?.floors[ctx.floorId]?.data);
  const cells = useMemo(
    () => (data?.grid ? selectionCells(data, data.grid, selection) : []),
    [data, selection],
  );
  const shown = cells.slice(0, MAX_CELLS_SHOWN).join(', ');
  return (
    <p className="text-sm text-muted-foreground">
      {t('grid.selectionCell', {
        cell:
          cells.length === 0
            ? t('grid.outside')
            : cells.length > MAX_CELLS_SHOWN
              ? `${shown} …`
              : shown,
      })}
    </p>
  );
}
