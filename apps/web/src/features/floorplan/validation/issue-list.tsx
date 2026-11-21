import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MessageKey } from '../canvas/extension';
import { issueColors } from '../canvas/theme';
import type { IssueSummary } from './issue-summary';

/**
 * The validator's issues on the selected items, one line per code in its severity's colour. A
 * message with plural forms says the count itself; others get it appended when there are several.
 * An issue's own parameters (a `count` among them) take precedence over the number of issues.
 */
export function IssueList({ issues }: { issues: readonly IssueSummary[] }) {
  const { t, i18n } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label={t('canvas.issues')}>
      {issues.map(({ code, severity, count, params }) => {
        // Validator codes are data; `issues.<code>` is the convention that maps them to messages.
        const key = `issues.${code}` as MessageKey;
        const counted = i18n.exists(`${key}_other`);
        return (
          <li
            key={code}
            className="flex items-start gap-2"
            style={{ color: issueColors[severity] }}
          >
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {t(key, { count, ...params })}
              {!counted && count > 1 && ` (${String(count)})`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
