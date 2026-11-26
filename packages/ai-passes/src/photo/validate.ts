import type { Issue } from '@el-karta/core';
import { boxProblem, issue, outsideImage } from '../image.ts';
import { CEILING, deviceIndex, openingIndex, wallIndex } from './refs.ts';
import { deviceTypeKey, type PhotoInput, type PhotoOutput } from './schema.ts';

/** Checks that make the runner retry (every issue here is an error). */
export function validatePhoto(output: PhotoOutput, input: PhotoInput): Issue[] {
  const issues: Issue[] = [];
  const walls = input.walls.length;
  const error = (code: string, params: Record<string, string | number>) =>
    issues.push(issue(code, 'error', params));

  if (output.wall !== null && wallIndex(output.wall, walls) === null)
    error('photo.unknown-wall', { field: 'wall', ref: output.wall });

  output.references.forEach((ref, i) => {
    const field = `references.${i}`;
    if (ref.what === 'wall_corner' && wallIndex(ref.ref, walls) === null)
      error('photo.unknown-wall', { field, ref: ref.ref });
    if (ref.what === 'opening_corner' && openingIndex(ref.ref, input.openings.length) === null)
      error('photo.unknown-opening', { field, ref: ref.ref });
    if (outsideImage(ref.point)) error('photo.point-outside', { field });
  });

  const types = new Map(input.detectable.map((d) => [deviceTypeKey(d), d]));
  output.features.forEach((feature, i) => {
    const field = `features.${i}`;
    const type = types.get(feature.deviceType);
    if (!type) error('photo.unknown-device-type', { field, type: feature.deviceType });
    if (feature.wall !== CEILING && wallIndex(feature.wall, walls) === null)
      error('photo.unknown-wall', { field, ref: feature.wall });
    if (type?.placement === 'wall' && feature.wall === CEILING)
      error('photo.wall-type-on-ceiling', { field, type: feature.deviceType });
    if (feature.existing !== null && deviceIndex(feature.existing, input.devices.length) === null)
      error('photo.unknown-device', { field, ref: feature.existing });
    const problem = boxProblem(feature.box);
    if (problem === 'outside') error('photo.box-outside', { field });
    if (problem === 'inverted') error('photo.box-inverted', { field });
    if (feature.count !== null && type && !type.countable)
      error('photo.count-not-countable', { field, type: feature.deviceType });
    if (feature.count !== null && feature.count < 1) error('photo.count-invalid', { field });
    for (const prop of feature.props) {
      if (type && !type.visibleProps?.[prop.name]?.includes(prop.value))
        error('photo.unknown-prop', { field, prop: prop.name, value: prop.value });
    }
  });
  return issues;
}
