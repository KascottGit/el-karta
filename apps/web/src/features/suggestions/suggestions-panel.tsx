import type { Id, Suggestion, SuggestionIssue } from '@el-karta/core';
import { Check, Pencil, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CanvasContext } from '@/features/floorplan/canvas/extension';
import { suggestionStyle } from '@/features/floorplan/canvas/theme';
import { DecimalField } from '@/features/floorplan/fields/decimal-field';
import { formatDecimal } from '@/features/floorplan/fields/numbers';
import { IssueList } from '@/features/floorplan/validation/issue-list';
import { summarizeIssues } from '@/features/floorplan/validation/issue-summary';
import { Button } from '@/ui/button';
import {
  confidentIds,
  dependantsOf,
  editTarget,
  isPending,
  suggestionKinds,
  type Decision,
} from './actions';
import { parsePayload } from './ghosts';
import { useFloorSuggestions, useSuggestionActions } from './hooks';
import { onFloor, selectSuggestion, useSuggestions } from './suggestions-store';
import { suggestionView, type SuggestionView } from './views';

interface Row {
  suggestion: Suggestion;
  view: SuggestionView;
  /** Null when the payload does not fit its kind's schema. */
  payload: unknown;
}

const percent = (confidence: number) => formatDecimal(confidence * 100, 0);

// Counts stay numbers for plural forms; other numbers get a decimal comma.
const issueParams = (issue: SuggestionIssue) =>
  issue.params &&
  Object.fromEntries(
    Object.entries(issue.params).map(([k, v]) => [
      k,
      typeof v === 'number' && k !== 'count' ? formatDecimal(v, 2) : v,
    ]),
  );

/**
 * The floor's pending suggestions: floor-level values first, then one group per kind, with
 * accept and reject per item and for all of them at once.
 */
export function SuggestionsPanel({ ctx }: { ctx: CanvasContext }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { suggestions, failed } = useFloorSuggestions(ctx.floorId);
  const selectedId = useSuggestions((s) => onFloor(s.selected, ctx.floorId));
  const notice = useSuggestions((s) => onFloor(s.notice, ctx.floorId));
  const actions = useSuggestionActions(ctx.floorId);
  const [threshold, setThreshold] = useState<number>(suggestionStyle.thresholds.high);
  const [confirm, setConfirm] = useState<{ ids: Id[]; dependants: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo<Row[]>(
    () =>
      suggestions.filter(isPending).map((suggestion) => ({
        suggestion,
        view: suggestionView(suggestion.kind),
        payload: parsePayload(suggestionKinds, suggestion),
      })),
    [suggestions],
  );
  const confident = useMemo(() => confidentIds(suggestions, threshold), [suggestions, threshold]);
  const groups = useMemo(() => {
    const byKind = new Map<string, Row[]>();
    for (const row of rows) {
      if (row.view.floorValue) continue;
      const list = byKind.get(row.suggestion.kind);
      if (list) list.push(row);
      else byKind.set(row.suggestion.kind, [row]);
    }
    return [...byKind.values()].sort((a, b) => a[0]!.view.order - b[0]!.view.order);
  }, [rows]);
  const floorValues = rows.filter((r) => r.view.floorValue);
  const selected = rows.find((r) => r.suggestion.id === selectedId);

  const run = (decide: () => Promise<Decision>) => {
    setBusy(true);
    setConfirm(null);
    void decide().finally(() => {
      setBusy(false);
    });
  };
  const reject = (ids: Id[]) => {
    const dependants = dependantsOf(suggestions, ids).length;
    if (dependants > 0) setConfirm({ ids, dependants });
    else run(() => actions.reject(ids));
  };
  const item = {
    busy,
    onSelect: (id: Id) => {
      selectSuggestion(ctx.floorId, id);
    },
    onAccept: (id: Id) => {
      run(() => actions.accept([id]));
    },
    onReject: (id: Id) => {
      reject([id]);
    },
    onEdit: (s: Suggestion) => {
      run(() => actions.acceptAndEdit(s));
    },
  };
  const pendingIds = rows.map((r) => r.suggestion.id);

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      <h2 id={titleId} className="font-semibold">
        {t('suggestions.title')}
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t('suggestions.loadFailed')}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {rows.length === 0
            ? t('suggestions.none')
            : t('suggestions.remaining', { count: rows.length })}
        </p>
      )}
      {notice && (
        <p role="alert" className="text-sm text-destructive">
          {t(notice)}
        </p>
      )}
      {confirm && (
        <div
          role="alertdialog"
          aria-label={t('suggestions.reject')}
          className="flex flex-col gap-2 rounded-md border p-2"
        >
          <p className="text-sm">{t('suggestions.confirmReject', { count: confirm.dependants })}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                const { ids } = confirm;
                run(() => actions.reject(ids));
              }}
            >
              {t('suggestions.confirmRejectButton', {
                count: confirm.ids.length + confirm.dependants,
              })}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirm(null);
              }}
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
      {selected && (
        <div
          className="rounded-md border border-primary/40 p-2"
          aria-label={t('suggestions.selected')}
          role="group"
        >
          <SuggestionItem row={selected} detailed {...item} />
        </div>
      )}
      {floorValues.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label={t('suggestions.floorValues')}>
          {floorValues.map((row) => (
            <li key={row.suggestion.id}>
              <SuggestionItem row={row} {...item} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="flex flex-col gap-2" role="group" aria-label={t('suggestions.bulk')}>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                run(() => actions.accept(pendingIds));
              }}
            >
              {t('suggestions.acceptAll', { count: pendingIds.length })}
            </Button>
            <Button
              variant="outline"
              disabled={busy || confident.length === 0}
              onClick={() => {
                run(() => actions.accept(confident));
              }}
            >
              {t('suggestions.acceptConfident', { count: confident.length })}
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                run(() => actions.reject(pendingIds));
              }}
            >
              {t('suggestions.rejectAll', { count: pendingIds.length })}
            </Button>
          </div>
          <DecimalField
            label={t('suggestions.threshold')}
            value={threshold * 100}
            digits={0}
            unit="%"
            accept={(v) => v >= 0 && v <= 100}
            onCommit={(v) => {
              setThreshold(v / 100);
            }}
          />
        </div>
      )}
      {groups.map((group) => (
        <details key={group[0]!.suggestion.kind} className="flex flex-col gap-2">
          <summary className="cursor-pointer text-sm font-medium">
            {t('suggestions.group', { kind: t(group[0]!.view.title), count: group.length })}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {group.map((row) => (
              <li key={row.suggestion.id}>
                <SuggestionItem row={row} {...item} />
              </li>
            ))}
          </ul>
        </details>
      ))}
      {groups.length > 0 && (
        <p className="text-sm text-muted-foreground">{t('suggestions.hint')}</p>
      )}
    </section>
  );
}

function SuggestionItem({
  row,
  detailed = false,
  busy,
  onSelect,
  onAccept,
  onReject,
  onEdit,
}: {
  row: Row;
  detailed?: boolean;
  busy: boolean;
  onSelect: (id: Id) => void;
  onAccept: (id: Id) => void;
  onReject: (id: Id) => void;
  onEdit: (s: Suggestion) => void;
}) {
  const { t } = useTranslation();
  const { suggestion, view, payload } = row;
  const text = payload === null ? t('suggestions.invalid') : view.describe(payload, t);
  const issues = useMemo(
    () =>
      summarizeIssues(
        suggestion.issues.map((issue) => {
          const params = issueParams(issue);
          return { code: issue.code, severity: issue.severity, ...(params ? { params } : {}) };
        }),
      ),
    [suggestion.issues],
  );
  const editable = payload !== null && editTarget(suggestion) !== null;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        {view.ghost && !detailed ? (
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
            aria-label={t('suggestions.selectItem', { item: text })}
            onClick={() => {
              onSelect(suggestion.id);
            }}
          >
            {text}
          </button>
        ) : (
          <span className="min-w-0 flex-1 text-sm">{text}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {suggestion.confidence === undefined
            ? t('suggestions.confidenceUnknown')
            : t('suggestions.confidence', { percent: percent(suggestion.confidence) })}
        </span>
      </div>
      <IssueList issues={issues} />
      <div className="flex flex-wrap gap-1">
        {payload !== null && (
          <Button
            size="sm"
            disabled={busy}
            aria-label={t('suggestions.acceptItem', { item: text })}
            onClick={() => {
              onAccept(suggestion.id);
            }}
          >
            <Check aria-hidden />
            {t('suggestions.accept')}
          </Button>
        )}
        {detailed && editable && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              onEdit(suggestion);
            }}
          >
            <Pencil aria-hidden />
            {t('suggestions.acceptAndEdit')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          aria-label={t('suggestions.rejectItem', { item: text })}
          onClick={() => {
            onReject(suggestion.id);
          }}
        >
          <X aria-hidden />
          {t('suggestions.reject')}
        </Button>
      </div>
    </div>
  );
}
