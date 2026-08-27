import type { LeaderboardEntry } from "./types";

/**
 * Adjusted time = (finish clock - start clock) + penalty seconds + skip seconds.
 * Doc §7.
 */
export function adjustedTimeSeconds(
  startedAtMs: number,
  finishedAtMs: number,
  penaltySeconds: number,
  skipSeconds: number
): number {
  const raceSeconds = (finishedAtMs - startedAtMs) / 1000;
  return raceSeconds + penaltySeconds + skipSeconds;
}

/**
 * Primary ranking: lowest adjusted time. Points are only the tie-break when two
 * finished teams are within 30 seconds of each other on adjusted time (doc §7).
 * Unfinished teams rank below all finished teams, ordered by progress then
 * (elapsed so far + penalties) as a live-standing approximation.
 */
export function rankLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const finished = entries.filter((e) => e.finished && e.adjustedTimeSeconds !== null);
  const unfinished = entries.filter((e) => !e.finished);

  finished.sort((a, b) => {
    const diff = a.adjustedTimeSeconds! - b.adjustedTimeSeconds!;
    if (Math.abs(diff) <= 30) {
      // Within the tie-break window: higher points wins.
      if (a.points !== b.points) return b.points - a.points;
    }
    return diff;
  });

  unfinished.sort((a, b) => {
    if (a.checkpointsCleared !== b.checkpointsCleared) {
      return b.checkpointsCleared - a.checkpointsCleared;
    }
    return b.points - a.points;
  });

  return [...finished, ...unfinished];
}
