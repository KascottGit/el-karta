/**
 * The fastest of a few timed runs of `work`, in milliseconds, for performance tests: the full suite
 * runs many test files in parallel, and one run can lose its CPU for longer than the budget.
 * `setup` runs untimed before each run, e.g. to make fresh data that a cache has not seen.
 */
export function fastest<T>(runs: number, setup: () => T, work: (input: T) => void) {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const input = setup();
    const start = performance.now();
    work(input);
    best = Math.min(best, performance.now() - start);
  }
  return best;
}
