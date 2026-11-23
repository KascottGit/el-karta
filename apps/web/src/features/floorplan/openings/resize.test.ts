import type { Opening, Wall } from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { pt, wall } from '../walls/test-fixtures';
import {
  MIN_OPENING_HEIGHT,
  MIN_OPENING_WIDTH,
  moveOpeningEdge,
  openingFrame,
  setOpeningSill,
  setOpeningTop,
  slideOpeningTo,
  type OpeningFrame,
} from './resize';

const w = wall(pt(0, 0), pt(5, 0), 0.2, 'w');
const opening = (
  id: string,
  offset: number,
  width = 1,
  kind: Opening['kind'] = 'door',
): Opening => ({
  id,
  wallId: 'w',
  kind,
  offset,
  width,
  height: kind === 'window' ? 1.2 : 2.1,
  ...(kind === 'window' ? { sill: 0.9 } : {}),
  provenance: { status: 'manual' },
});
const frame = (others: Opening[] = [], onWall: Wall = w, floorHeight = 2.5): OpeningFrame => ({
  wall: onWall,
  others,
  floorHeight,
});

describe('openingFrame', () => {
  it('is the wall, the other openings on it and the floor height', () => {
    const door = opening('d', 1);
    const other = opening('o', 3);
    const elsewhere = { ...opening('e', 0), wallId: 'x' };
    const floor = { walls: { w }, openings: { d: door, o: other, e: elsewhere }, height: 2.6 };
    expect(openingFrame(floor, door)).toEqual({ wall: w, others: [other], floorHeight: 2.6 });
    expect(openingFrame({ ...floor, walls: {} }, door)).toBeNull();
  });
});

describe('slideOpeningTo', () => {
  it('moves the opening and keeps its width', () => {
    expect(slideOpeningTo(frame(), opening('d', 1), 2.25)).toMatchObject({
      offset: 2.25,
      width: 1,
    });
  });

  it('stops at the wall ends', () => {
    expect(slideOpeningTo(frame(), opening('d', 1), -3)?.offset).toBe(0);
    expect(slideOpeningTo(frame(), opening('d', 1), 9)?.offset).toBe(4);
  });

  it('stays off its neighbours', () => {
    const others = [opening('o', 2)];
    expect(slideOpeningTo(frame(others), opening('d', 0), 1.7)?.offset).toBe(1);
    expect(slideOpeningTo(frame(others), opening('d', 0), 2.9)?.offset).toBe(3);
  });

  it('brings an opening beyond the wall end back onto the wall', () => {
    expect(slideOpeningTo(frame(), opening('d', 4.6), 4.6)?.offset).toBe(4);
  });

  it('is null when the opening fits nowhere on its wall', () => {
    expect(slideOpeningTo(frame(), opening('d', 0, 6), 1)).toBeNull();
  });

  it('rounds to whole centimetres when asked', () => {
    expect(slideOpeningTo(frame(), opening('d', 1), 2.2349, true)?.offset).toBe(2.23);
    expect(slideOpeningTo(frame(), opening('d', 1), 2.2349)?.offset).toBe(2.2349);
  });
});

describe('moveOpeningEdge', () => {
  it('moves the end edge and keeps the start', () => {
    expect(moveOpeningEdge(frame(), opening('d', 1), 'end', 2.5)).toMatchObject({
      offset: 1,
      width: 1.5,
    });
  });

  it('moves the start edge and keeps the end', () => {
    const moved = moveOpeningEdge(frame(), opening('d', 1), 'start', 0.4);
    expect(moved?.offset).toBeCloseTo(0.4);
    expect(moved!.offset + moved!.width).toBeCloseTo(2);
  });

  it('stops at the wall ends', () => {
    expect(moveOpeningEdge(frame(), opening('d', 1), 'end', 7)).toMatchObject({
      offset: 1,
      width: 4,
    });
    expect(moveOpeningEdge(frame(), opening('d', 1), 'start', -2)).toMatchObject({
      offset: 0,
      width: 2,
    });
  });

  it('stops at the neighbouring openings, touching them', () => {
    const others = [opening('l', 0, 0.5), opening('r', 3, 1)];
    expect(moveOpeningEdge(frame(others), opening('d', 1), 'end', 3.6)).toMatchObject({
      offset: 1,
      width: 2,
    });
    expect(moveOpeningEdge(frame(others), opening('d', 1), 'start', 0.2)).toMatchObject({
      offset: 0.5,
      width: 1.5,
    });
  });

  it('keeps the minimum width when an edge is dragged past the other', () => {
    expect(moveOpeningEdge(frame(), opening('d', 1), 'end', 0.2)).toMatchObject({
      offset: 1,
      width: MIN_OPENING_WIDTH,
    });
    const moved = moveOpeningEdge(frame(), opening('d', 1), 'start', 4);
    expect(moved?.width).toBe(MIN_OPENING_WIDTH);
    expect(moved?.offset).toBeCloseTo(2 - MIN_OPENING_WIDTH);
  });

  it('is null when a neighbour leaves no room for the minimum width', () => {
    const squeezed = { ...opening('d', 1), width: 0.05 };
    expect(moveOpeningEdge(frame([opening('r', 1.05)]), squeezed, 'end', 2)).toBeNull();
  });

  it('rounds the width to whole centimetres when asked, unless a limit is nearer', () => {
    expect(moveOpeningEdge(frame(), opening('d', 1), 'end', 2.4567, true)?.width).toBe(1.46);
    expect(moveOpeningEdge(frame(), opening('d', 1), 'end', 2.4567)?.width).toBeCloseTo(1.4567);
    const shortWall = wall(pt(0, 0), pt(2.345, 0), 0.2, 'w');
    expect(
      moveOpeningEdge(frame([], shortWall), opening('d', 1), 'end', 2.344, true)?.width,
    ).toBeCloseTo(1.345);
  });

  it('works on a wall drawn in any direction', () => {
    const diagonal = wall(pt(3, 4), pt(0, 0), 0.2, 'w');
    expect(moveOpeningEdge(frame([], diagonal), opening('d', 1), 'end', 9)?.width).toBe(4);
  });
});

describe('setOpeningTop', () => {
  it('sets the height of a door', () => {
    expect(setOpeningTop(frame(), opening('d', 1), 2.2)?.height).toBe(2.2);
  });

  it('moves a window top and keeps its sill', () => {
    expect(setOpeningTop(frame(), opening('n', 1, 1, 'window'), 2.4)).toMatchObject({
      sill: 0.9,
      height: 1.5,
    });
  });

  it('stops at the wall height, or the floor height for a wall without one', () => {
    expect(setOpeningTop(frame(), opening('d', 1), 3)?.height).toBe(2.5);
    const tall = { ...w, height: 2.8 };
    expect(setOpeningTop(frame([], tall), opening('d', 1), 3)?.height).toBe(2.8);
    expect(setOpeningTop(frame(), opening('n', 1, 1, 'window'), 3)?.height).toBeCloseTo(1.6);
  });

  it('keeps the minimum height', () => {
    expect(setOpeningTop(frame(), opening('d', 1), -1)?.height).toBe(MIN_OPENING_HEIGHT);
    expect(setOpeningTop(frame(), opening('n', 1, 1, 'window'), 0.5)?.height).toBe(
      MIN_OPENING_HEIGHT,
    );
  });

  it('is null for a window whose sill leaves no room below the top of the wall', () => {
    const high = { ...opening('n', 1, 1, 'window'), sill: 2.45 };
    expect(setOpeningTop(frame(), high, 2.5)).toBeNull();
  });

  it('rounds the height to whole centimetres when asked', () => {
    expect(setOpeningTop(frame(), opening('d', 1), 2.0449, true)?.height).toBe(2.04);
    expect(setOpeningTop(frame(), opening('d', 1), 2.0449)?.height).toBe(2.0449);
  });
});

describe('setOpeningSill', () => {
  const window = opening('n', 1, 1, 'window');

  it('moves the sill and keeps the top', () => {
    const moved = setOpeningSill(frame(), window, 0.5);
    expect(moved?.sill).toBe(0.5);
    expect(moved!.sill! + moved!.height).toBeCloseTo(2.1);
  });

  it('stops at the floor and keeps the minimum height', () => {
    expect(setOpeningSill(frame(), window, -1)).toMatchObject({ sill: 0, height: 2.1 });
    const moved = setOpeningSill(frame(), window, 3);
    expect(moved?.height).toBeCloseTo(MIN_OPENING_HEIGHT);
    expect(moved?.sill).toBeCloseTo(2);
  });

  it('is null for a door or a passage, which have no sill', () => {
    expect(setOpeningSill(frame(), opening('d', 1), 0.5)).toBeNull();
    expect(setOpeningSill(frame(), opening('p', 1, 1, 'passage'), 0.5)).toBeNull();
  });

  it('rounds the sill to whole centimetres when asked', () => {
    expect(setOpeningSill(frame(), window, 0.7351, true)?.sill).toBe(0.74);
    expect(setOpeningSill(frame(), window, 0.7351)?.sill).toBe(0.7351);
  });
});
