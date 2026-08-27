import type { RaceEngine } from "@/game/engine";
import { SELF_CHECKED_TYPES } from "@/game/types";

export interface TeamStatePayload {
  team: { id: string; name: string; colour: string };
  started: boolean;
  finished: boolean;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  penaltySeconds: number;
  skipSeconds: number;
  points: number;
  adjustedTimeSeconds: number | null;
  checkpoint: {
    index: number;
    total: number;
    name: string;
    clue: string;
    instruction: string;
    challengeType: string;
    selfChecked: boolean;
    unlockedAtMs: number | null;
    timeLimitSeconds: number;
    canSkip: boolean;
  } | null;
  serverNowMs: number;
}

/** Builds the client-safe race state for one team - never includes correctAnswer or aiCriteria. */
export function buildTeamStatePayload(engine: RaceEngine, teamId: string): TeamStatePayload {
  const team = engine.publicTeams().find((t) => t.id === teamId);
  if (!team) throw new Error("Unknown team");

  const started = engine.hasStarted(teamId);
  if (!started) {
    return {
      team,
      started: false,
      finished: false,
      startedAtMs: null,
      finishedAtMs: null,
      penaltySeconds: 0,
      skipSeconds: 0,
      points: 0,
      adjustedTimeSeconds: null,
      checkpoint: null,
      serverNowMs: Date.now(),
    };
  }

  const progress = engine.progress(teamId);
  const position = engine.checkpointPosition(teamId);
  const activeCheckpoint = engine.currentCheckpoint(teamId);

  return {
    team,
    started: true,
    finished: progress.finishedAtMs !== null,
    startedAtMs: progress.startedAtMs,
    finishedAtMs: progress.finishedAtMs,
    penaltySeconds: progress.penaltySeconds,
    skipSeconds: progress.skipSeconds,
    points: progress.points,
    adjustedTimeSeconds: engine.adjustedTimeSeconds(teamId),
    checkpoint:
      activeCheckpoint && position
        ? {
            index: position.index,
            total: position.total,
            name: activeCheckpoint.name,
            clue: activeCheckpoint.clue,
            instruction: activeCheckpoint.instruction,
            challengeType: activeCheckpoint.challengeType,
            selfChecked: SELF_CHECKED_TYPES.has(activeCheckpoint.challengeType),
            unlockedAtMs: engine.currentUnlockedAtMs(teamId),
            timeLimitSeconds: activeCheckpoint.timeLimitSeconds,
            canSkip: engine.canSkip(teamId),
          }
        : null,
    serverNowMs: Date.now(),
  };
}
