import type { AiPass } from '../pass.ts';
import { interpretPhoto, type PhotoSuggestOptions } from './interpret.ts';
import { photoPrompt } from './prompt.ts';
import { PhotoInput, PhotoOutput } from './schema.ts';
import { validatePhoto } from './validate.ts';

/** Reads devices and known wall points off a photo of a room (M11 decision 5, ADR 0011). */
export const photoPass: AiPass<PhotoInput, PhotoOutput, PhotoSuggestOptions> = {
  id: 'photo',
  inputSchema: PhotoInput,
  outputSchema: PhotoOutput,
  prompt: photoPrompt,
  validate: validatePhoto,
  toSuggestions: interpretPhoto,
};
