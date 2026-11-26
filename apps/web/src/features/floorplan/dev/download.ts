/** A file-name-safe id from a floor's name, e.g. "Plan 1 – Gotgatan" → "plan-1-gotgatan". */
export const fileId = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'floor';

/** Downloads `value` as pretty-printed JSON named `fileName`. */
export function downloadJson(fileName: string, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
