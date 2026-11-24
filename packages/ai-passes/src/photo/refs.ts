/** How the prompt and the output name walls (`A`, `B`, …), openings (`O1`, …) and devices (`E1`, …). */

const A = 'A'.charCodeAt(0);

export const wallLetter = (index: number): string => String.fromCharCode(A + index);

export const openingRef = (index: number): string => `O${index + 1}`;

export const deviceRef = (index: number): string => `E${index + 1}`;

/** The array index a reference names, or null when it names nothing in a list of `count`. */
export function wallIndex(letter: string, count: number): number | null {
  if (!/^[A-Z]$/.test(letter)) return null;
  const index = letter.charCodeAt(0) - A;
  return index < count ? index : null;
}

const numbered = (prefix: string) => (ref: string, count: number) => {
  const match = new RegExp(`^${prefix}([1-9][0-9]*)$`).exec(ref);
  const index = match ? Number(match[1]) - 1 : -1;
  return index >= 0 && index < count ? index : null;
};

export const openingIndex = numbered('O');

export const deviceIndex = numbered('E');

/** The `wall` value of a feature on the ceiling. */
export const CEILING = 'ceiling';
