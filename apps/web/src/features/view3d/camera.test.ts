import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { fitCamera } from './camera';

describe('fitCamera', () => {
  const bounds = { min: { x: 10, y: -5, z: 0 }, max: { x: 70, y: 25, z: 30 } };

  it.each([0.46, 1, 2.2])('shows every corner of the bounds tightly at aspect %s', (aspect) => {
    const fit = fitCamera(bounds, aspect);
    const camera = new PerspectiveCamera(45, aspect, fit.near, fit.far);
    camera.position.set(...fit.position);
    camera.lookAt(...fit.target);
    camera.updateMatrixWorld();
    let widest = 0;
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          // Plan (x, y, z) is three.js (x, z, y).
          const ndc = new Vector3(x, z, y).project(camera);
          expect(Math.abs(ndc.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.y)).toBeLessThanOrEqual(1);
          expect(Math.abs(ndc.z)).toBeLessThanOrEqual(1);
          widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
        }
    // The bounds fill the view, apart from the margin.
    expect(widest).toBeGreaterThan(0.9);
  });

  it('looks at the centre from above and from the plan’s bottom edge', () => {
    const fit = fitCamera(bounds, 1);
    expect(fit.target).toEqual([40, 15, 10]);
    expect(fit.position[1]).toBeGreaterThan(fit.target[1]);
    // Plan y grows downwards on screen; the camera stands at larger plan y (three.js z).
    expect(fit.position[2]).toBeGreaterThan(fit.target[2]);
  });
});
