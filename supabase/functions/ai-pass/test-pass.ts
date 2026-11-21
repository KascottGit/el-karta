import type { AiPass } from '@el-karta/ai-passes';
import { z } from 'zod';

const Input = z.object({ text: z.string() });
const Output = z.object({ labels: z.array(z.string()) });

/**
 * Registered only with `AI_PROVIDER=fake`, so integration tests can drive the function without
 * depending on a real pass's output schema. An empty `labels` list is an error, to exercise the retry.
 */
export const testEchoPass: AiPass<z.infer<typeof Input>, z.infer<typeof Output>, unknown> = {
  id: 'test-echo',
  inputSchema: Input,
  outputSchema: Output,
  prompt: (input) => ({ system: 'Echo the labels.', text: input.text, images: [] }),
  validate: (output) =>
    output.labels.length === 0 ? [{ code: 'test.empty', severity: 'error', ids: [] }] : [],
  toSuggestions: () => [],
};
