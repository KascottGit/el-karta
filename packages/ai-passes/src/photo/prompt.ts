import { closestOnSegment, distance } from '@el-karta/core';
import type { Prompt } from '../pass.ts';
import { wallFrame, type WallFrame } from './plane.ts';
import { CEILING, deviceRef, openingRef, wallLetter } from './refs.ts';
import { deviceTypeKey, type PhotoInput, type PhotoWall } from './schema.ts';

export const PHOTO_SYSTEM = `You look at photos taken inside a room of a home and report, as structured data, the electrical devices you see and the image positions of points whose place on the walls is known. Code computes positions in metres from your image points, so precise points matter more than completeness. Coordinates: every point is {x, y} on the photo, normalised to 0–1000: x = 0 at the left edge and 1000 at the right edge, y = 0 at the top edge and 1000 at the bottom edge. Boxes are {xmin, ymin, xmax, ymax} in the same coordinates. Report only what you see; never invent values or points.`;

const m = (metres: number) => `${metres.toFixed(2)} m`;
const range = (from: number, to: number) => `${from.toFixed(2)}–${m(to)}`;

/** Metres from the face's left end, as the viewer sees it, to wall-plane `u`. */
const fromLeft = (frame: WallFrame, u: number) =>
  frame.leftEnd === 'a' ? u - frame.start : frame.end - u;

/** The letter of the wall that meets `wall` at its `end`, if one does. */
function neighbour(walls: readonly PhotoWall[], index: number, end: 'a' | 'b'): string | null {
  const wall = walls[index]!;
  const at = wall[end];
  let best: { letter: string; d: number } | null = null;
  for (const [i, other] of walls.entries()) {
    if (i === index) continue;
    const d = distance(at, closestOnSegment(at, other.a, other.b).point);
    if (d <= wall.thickness + other.thickness && (!best || d < best.d))
      best = { letter: wallLetter(i), d };
  }
  return best?.letter ?? null;
}

function wallLines(input: PhotoInput, frames: readonly WallFrame[]): string[] {
  return input.walls.flatMap((wall, i) => {
    const frame = frames[i]!;
    const left = neighbour(input.walls, i, frame.leftEnd);
    const right = neighbour(input.walls, i, frame.leftEnd === 'a' ? 'b' : 'a');
    const ends = [
      left ? `its left end meets wall ${left}` : null,
      right ? `its right end meets wall ${right}` : null,
    ].filter((s) => s !== null);
    const head = `- ${wallLetter(i)}: ${m(frame.end - frame.start)} long${ends.length > 0 ? `; ${ends.join(', ')}` : ''}.`;
    const openings = input.openings.flatMap((o, j) => {
      if (o.wallId !== wall.id) return [];
      const a = fromLeft(frame, o.offset);
      const b = fromLeft(frame, o.offset + o.width);
      const sill = o.sill ?? (o.kind === 'window' ? null : 0);
      const vertical =
        sill === null ? `${m(o.height)} high` : `${range(sill, sill + o.height)} above the floor`;
      return [
        `  - ${openingRef(j)}: ${o.kind}, ${range(Math.min(a, b), Math.max(a, b))} from the left end, ${vertical}.`,
      ];
    });
    return [head, ...openings];
  });
}

function deviceLines(input: PhotoInput, frames: readonly WallFrame[]): string[] {
  if (input.devices.length === 0) return ['None.'];
  return input.devices.map((d, i) => {
    const p = d.placement;
    const type = deviceTypeKey(d);
    const wall = p.kind === 'wall' ? input.walls.findIndex((w) => w.id === p.wallId) : -1;
    const frame = frames[wall];
    if (p.kind === 'wall' && frame)
      return `- ${deviceRef(i)}: ${type} on wall ${wallLetter(wall)}, ${m(fromLeft(frame, p.offset))} from the left end, ${m(p.height)} above the floor.`;
    if (p.kind === 'ceiling') return `- ${deviceRef(i)}: ${type} on the ceiling.`;
    return `- ${deviceRef(i)}: ${type}, elsewhere in the room.`;
  });
}

function typeLines(input: PhotoInput): string[] {
  return input.detectable.map((d) => {
    const where = d.placement === 'wall' ? 'on a wall' : 'on the ceiling';
    const props = Object.entries(d.visibleProps ?? {}).map(
      ([name, values]) => `${name} (${values.join(', ')})`,
    );
    return [
      `- ${deviceTypeKey(d)} (${where}): ${d.description}`,
      d.countable ? ' count: the number of units side by side in one frame.' : ' count: null.',
      props.length > 0 ? ` props: ${props.join('; ')}.` : ' props: none.',
    ].join('');
  });
}

function imagesNote(earlier: number): string {
  if (earlier === 0) return 'The image is the photo to read.';
  const rest =
    earlier === 1
      ? 'The second image is an earlier photo'
      : `The other ${earlier} images are earlier photos`;
  return `The first image is the photo to read. ${rest} of the same room, for context only: report nothing from them, and give no points on them.`;
}

/** The prompt for one photo: the room as the model knows it, then what to report. */
export function photoPrompt(input: PhotoInput): Prompt {
  const frames = input.walls.map((w) => wallFrame(w, input.room.polygon));
  const target = input.walls.findIndex((w) => w.id === input.targetWallId);
  const room = `Room: "${input.room.name}" (${input.room.type}), ceiling height ${m(input.room.ceilingHeight)}.`;
  const text = [
    room,
    [
      `Walls, named by letter clockwise as seen from above. "Left" and "right" are as seen standing in the room facing the wall; positions along a wall are measured from its left end.`,
      ...wallLines(input, frames),
    ].join('\n'),
    ['Devices already recorded in this room:', ...deviceLines(input, frames)].join('\n'),
    target >= 0
      ? `The person says the photo shows wall ${wallLetter(target)}.`
      : 'The person did not say which wall the photo shows.',
    imagesNote(input.earlier.length),
    ['Device types to report:', ...typeLines(input)].join('\n'),
    `Report the following.

wall: the letter of the wall the photo mainly shows, or null if it shows no wall clearly.

references: image points of places whose position on a wall is known, as many as you can see clearly. For a wall: what = "wall_corner", ref = its letter, and the corner where it meets the floor (bottom_left, bottom_right) or the ceiling (top_left, top_right) at its left or right end. For a listed opening: what = "opening_corner", ref = its O-number, and the corner of its frame (top_left, top_right, bottom_left, bottom_right; the bottom of a door is at the floor). Left and right are as seen in the photo. Report only corners you can see in the photo, not hidden ones and not ones outside it.

features: every device of the listed types you see in the photo. deviceType: as listed above. wall: the letter of the wall it is on, or "${CEILING}". box: tight around the device. count and props: as listed for the type; leave out props you cannot see. confidence: 0–1. existing: the E-number if it is one of the devices already recorded above, else null.`,
  ].join('\n\n');
  return { system: PHOTO_SYSTEM, text, images: [input.image, ...input.earlier] };
}
