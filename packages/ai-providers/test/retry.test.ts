import { describe, expect, it } from 'vitest';
import { ProviderError, withRetries, type AbortSignalLike } from '../src/index.ts';

const failWith = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const statusOf = (error: unknown) => (error as { status?: number }).status;

/** A clock that only moves when the code under test sleeps or an attempt takes time. */
function clock() {
  let time = 1_000_000;
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms;
    },
    sleep: (ms: number) => {
      time += ms;
      return Promise.resolve();
    },
  };
}

describe('withRetries', () => {
  it('turns failures into ProviderError kinds: 429 rate_limited, 503 unavailable, 400 error', async () => {
    for (const [status, kind] of [
      [429, 'rate_limited'],
      [503, 'unavailable'],
      [400, 'error'],
    ] as const) {
      const c = clock();
      const error = await withRetries(() => Promise.reject(failWith(status)), {
        label: 'Test',
        statusOf,
        sleep: c.sleep,
        now: c.now,
      }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ kind });
    }
  });

  it('starts no attempt, and no backoff, past the deadline', async () => {
    const c = clock();
    let attempts = 0;
    const error = await withRetries(
      () => {
        attempts++;
        c.advance(10_000);
        return Promise.reject(failWith(503));
      },
      { label: 'Test', statusOf, sleep: c.sleep, now: c.now, deadline: c.now() + 15_000 },
    ).catch((e: unknown) => e);
    // 10 s, 1 s backoff, 10 s: past the deadline, so the third attempt never starts.
    expect(attempts).toBe(2);
    expect(error).toMatchObject({ kind: 'unavailable' });
  });

  it('refuses at once when the deadline has passed', async () => {
    const c = clock();
    let attempts = 0;
    const error = await withRetries(
      () => {
        attempts++;
        return Promise.resolve('ok');
      },
      { label: 'Test', statusOf, now: c.now, deadline: c.now() },
    ).catch((e: unknown) => e);
    expect(attempts).toBe(0);
    expect(error).toMatchObject({
      kind: 'unavailable',
      message: expect.stringMatching(/out of time/) as unknown,
    });
  });

  it('cuts the attempt timeout to the time left', async () => {
    let attempts = 0;
    const started = Date.now();
    const hanging = (signal: AbortSignalLike) => {
      attempts++;
      return new Promise<never>((_resolve, reject) => {
        (signal as AbortSignal).addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    };
    const error = await withRetries(hanging, {
      label: 'Test',
      statusOf,
      timeoutMs: 60_000,
      deadline: started + 30,
      sleep: () => Promise.resolve(),
    }).catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(error).toMatchObject({ kind: 'unavailable' });
    expect(attempts).toBeGreaterThanOrEqual(1);
  });
});
