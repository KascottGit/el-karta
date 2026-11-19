import type { Id } from '../schemas/index.ts';

export type IssueSeverity = 'error' | 'warning';

/** `code` doubles as the i18n key suffix (`issues.<code>`); `params` fill the message. */
export interface Issue {
  code: string;
  severity: IssueSeverity;
  ids: Id[];
  floorId?: Id;
  params?: Record<string, string | number>;
}
