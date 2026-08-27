import type { RaceEngine } from "@/game/engine";

export interface AdminTeamSnapshot {
  id: string;
  name: string;
  colour: string;
  hasStarted: boolean;
  finished: boolean;
  checkpoint: {
    index: number;
    total: number;
    name: string;
    challengeType: string;
    arrived: boolean;
    canSkip: boolean;
  } | null;
  penaltySeconds: number;
  skipSeconds: number;
  points: number;
  adjustedTimeSeconds: number | null;
  lastGps: {
    atMs: number;
    accepted: boolean;
    distanceMeters?: number;
    accuracyMeters?: number;
    reason?: string;
  } | null;
}

/** Everything the organiser dashboard needs, for every team, in one call. */
export function buildAdminSnapshot(engine: RaceEngine): AdminTeamSnapshot[] {
  return engine.publicTeams().map((team) => {
    const hasStarted = engine.hasStarted(team.id);
    if (!hasStarted) {
      return {
        ...team,
        hasStarted: false,
        finished: false,
        checkpoint: null,
        penaltySeconds: 0,
        skipSeconds: 0,
        points: 0,
        adjustedTimeSeconds: null,
        lastGps: null,
      };
    }

    const progress = engine.progress(team.id);
    const position = engine.checkpointPosition(team.id);
    const activeCheckpoint = engine.currentCheckpoint(team.id);

    const lastGpsEvent = [...engine.events]
      .reverse()
      .find((e) => e.type === "gps_reported" && e.teamId === team.id);

    return {
      ...team,
      hasStarted: true,
      finished: progress.finishedAtMs !== null,
      checkpoint:
        activeCheckpoint && position
          ? {
              index: position.index,
              total: position.total,
              name: activeCheckpoint.name,
              challengeType: activeCheckpoint.challengeType,
              arrived: engine.currentUnlockedAtMs(team.id) !== null,
              canSkip: engine.canSkip(team.id),
            }
          : null,
      penaltySeconds: progress.penaltySeconds,
      skipSeconds: progress.skipSeconds,
      points: progress.points,
      adjustedTimeSeconds: engine.adjustedTimeSeconds(team.id),
      lastGps: lastGpsEvent
        ? {
            atMs: lastGpsEvent.atMs,
            accepted: Boolean(lastGpsEvent.data?.accepted),
            distanceMeters: lastGpsEvent.data?.distanceMeters as number | undefined,
            accuracyMeters: lastGpsEvent.data?.accuracyMeters as number | undefined,
            reason: lastGpsEvent.data?.reason as string | undefined,
          }
        : null,
    };
  });
}
