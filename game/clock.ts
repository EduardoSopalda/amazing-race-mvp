/**
 * The server is the only authoritative source of race time (doc §7).
 * All engine methods take time through a Clock so tests can script a race
 * deterministically instead of racing against wall-clock time.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(ms: number): void;
}

export function createFakeClock(startMs = 0): FakeClock {
  let current = startMs;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    set: (ms: number) => {
      current = ms;
    },
  };
}
