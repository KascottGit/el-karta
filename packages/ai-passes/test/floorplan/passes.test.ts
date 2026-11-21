import {
  acceptSuggestions,
  applyEdit,
  checkSpace,
  createSuggestionKinds,
  type Suggestion,
} from '@el-karta/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ModelBuilder } from '../../../core/test/builder.ts';
import {
  createPassRegistry,
  floorplanLocatePass,
  floorplanPass,
  planCropBox,
  validateFloorplan,
  validateLocate,
} from '../../src/index.ts';
import { optionsFor, output, testPlan } from './fixtures.ts';

const image = { mimeType: 'image/png', data: 'iVBORw0KGgo=' };

describe('planCropBox', () => {
  it('crops to the located plan with a margin, in whole pixels inside the image', () => {
    const box = planCropBox(
      { found: true, box: { xmin: 100, ymin: 200, xmax: 600, ymax: 700 } },
      { width: 2000, height: 1000 },
    );
    // The plan is 1000 × 500 px; 4 % of its longer side is 40 px.
    expect(box).toEqual({ x: 160, y: 160, width: 1080, height: 580 });
  });

  it('stops at the image edges', () => {
    const box = planCropBox(
      { found: true, box: { xmin: 0, ymin: 10, xmax: 1000, ymax: 990 } },
      { width: 1000, height: 1000 },
    );
    expect(box).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
  });

  it('is the whole image when no plan was found', () => {
    expect(planCropBox({ found: false, box: null }, { width: 800, height: 600 })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });
});

describe('validators', () => {
  it('asks the locate call again for a missing or inverted box', () => {
    expect(validateLocate({ found: true, box: null }).map((i) => i.code)).toEqual([
      'ai.box-missing',
    ]);
    expect(
      validateLocate({ found: true, box: { xmin: 500, ymin: 0, xmax: 400, ymax: 900 } }).map(
        (i) => i.code,
      ),
    ).toEqual(['ai.box-invalid']);
    expect(validateLocate({ found: false, box: null })).toEqual([]);
  });

  it('errors on coordinates far outside the image and rooms without walls', () => {
    const issues = validateFloorplan(
      output({
        rooms: [
          {
            name: 'Kök',
            type: 'kitchen',
            point: { x: 1200, y: 10 },
            box: null,
            area: null,
            outdoor: false,
          },
        ],
      }),
    );
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      ['ai.coordinate-out-of-range', 'error'],
      ['ai.no-walls', 'error'],
    ]);
  });

  it('accepts rounding just outside the image and only warns about degenerate items', () => {
    const issues = validateFloorplan(
      output({
        walls: [
          { a: { x: -4, y: 0 }, b: { x: 1004, y: 0 }, exterior: true, thickness: null },
          { a: { x: 5, y: 5 }, b: { x: 5, y: 5 }, exterior: false, thickness: null },
        ],
      }),
    );
    expect(issues.map((i) => [i.code, i.severity])).toEqual([['ai.wall-zero-length', 'warning']]);
  });

  it('the plan fixtures are valid', () => {
    expect(validateFloorplan(testPlan().output)).toEqual([]);
  });
});

describe('pass definitions', () => {
  it('register under their ids', () => {
    const registry = createPassRegistry([floorplanLocatePass, floorplanPass]);
    expect(registry.ids()).toEqual(['floorplan-locate', 'floorplan']);
  });

  it('send the image and tell the model when it sees a tile', () => {
    const frame = { x: 0, y: 0, width: 1000, height: 800 };
    const whole = floorplanPass.prompt({ image, frame, tile: false });
    const tile = floorplanPass.prompt({ image, frame, tile: true });
    expect(whole.images).toEqual([image]);
    expect(whole.text).not.toContain('one part of a larger plan');
    expect(tile.text).toContain('one part of a larger plan');
    expect(whole.text).toContain('Sovrum');
    expect(floorplanLocatePass.prompt({ image }).images).toEqual([image]);
  });

  it('keep the typical sizes out of the prompt', () => {
    const { text } = floorplanPass.prompt({
      image,
      frame: { x: 0, y: 0, width: 1, height: 1 },
      tile: false,
    });
    expect(text).not.toMatch(/0[.,]6 ?m|0[.,]85|2[.,]0 ?m/);
  });

  it('have output schemas that convert to JSON Schema for structured output', () => {
    for (const pass of [floorplanLocatePass, floorplanPass]) {
      const schema = z.toJSONSchema(pass.outputSchema);
      expect(schema.type).toBe('object');
    }
    expect(floorplanPass.outputSchema.parse(testPlan().output)).toEqual(testPlan().output);
  });

  it('turn into suggestions that accept into a valid floor in one edit', () => {
    const b = new ModelBuilder();
    const model = b.build();
    const floor = b.floors[0]!;
    const plan = testPlan({ rotation: 25 });
    const drafts = floorplanPass.toSuggestions(plan.output, optionsFor(plan), () => b.id());
    const suggestions: Suggestion[] = drafts.map((d) => ({
      ...d,
      projectId: model.project.id,
      floorId: floor.id,
      runId: null,
      pass: 'floorplan',
      source: 'ai:floorplan:test',
      status: 'pending',
    }));
    const kinds = createSuggestionKinds();
    const accepted = acceptSuggestions(
      kinds,
      suggestions,
      suggestions.map((s) => s.id),
    );
    const { model: next } = applyEdit(model, accepted.edit);
    const data = next.floors[floor.id]!;
    expect(Object.keys(data.data.walls)).toHaveLength(6);
    expect(Object.keys(data.data.openings)).toHaveLength(4);
    expect(Object.keys(data.data.rooms)).toHaveLength(3);
    expect(checkSpace(data)).toEqual([]);
  });

  it('suggest a printed ceiling height as the floor height', () => {
    const plan = testPlan();
    const drafts = floorplanPass.toSuggestions(
      { ...plan.output, ceilingHeight: 2.55 },
      optionsFor(plan, { floorHeight: 2.5 }),
      () => crypto.randomUUID(),
    );
    expect(drafts.filter((d) => d.kind === 'floor-height').map((d) => d.payload)).toEqual([
      { height: 2.55 },
    ]);
    const same = floorplanPass.toSuggestions(
      { ...plan.output, ceilingHeight: 2.5 },
      optionsFor(plan, { floorHeight: 2.5 }),
      () => crypto.randomUUID(),
    );
    expect(same.some((d) => d.kind === 'floor-height')).toBe(false);
  });

  it('suggest nothing from the locate pass', () => {
    expect(
      floorplanLocatePass.toSuggestions({ found: true, box: null }, undefined, () => ''),
    ).toEqual([]);
  });
});
