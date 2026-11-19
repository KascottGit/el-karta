import type { TFunction } from 'i18next';
import type { ConflictDescription, ConflictSubject } from './conflicts';

const LISTED_SUBJECTS = 3;

function subjectText(t: TFunction, subject: ConflictSubject): string {
  switch (subject.kind) {
    case 'opening':
      return t(`save.subject.${subject.openingKind ?? 'opening'}`);
    case 'room':
    case 'zone':
    case 'device':
    case 'building':
      return subject.name === undefined
        ? t(`save.subject.${subject.kind}`)
        : t(`save.subject.${subject.kind}Named`, { name: subject.name });
    default:
      return t(`save.subject.${subject.kind}`);
  }
}

/** One plain-Swedish sentence saying what could not be saved and why. */
export function conflictMessage(t: TFunction, description: ConflictDescription): string {
  const { subjects } = description;
  const named = subjects.slice(0, LISTED_SUBJECTS).map((s) => subjectText(t, s));
  const rest = subjects.length - named.length;
  if (rest > 0) named.push(t('save.subject.more', { count: rest }));
  const list = new Intl.ListFormat('sv', { type: 'conjunction' }).format(named);
  return t(`save.conflicts.${description.action}`, {
    subjects: list || t('save.subject.project'),
  });
}
