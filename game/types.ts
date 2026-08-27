export type ChallengeType =
  | "photo"
  | "trivia"
  | "search"
  | "puzzle"
  | "interaction"
  | "observation"
  | "navigation"
  | "qr";

// Challenge types whose answer the engine can check itself, given a string.
// "photo" and "interaction" require an external verdict (AI or organiser) via submitJudgement.
export const SELF_CHECKED_TYPES: ReadonlySet<ChallengeType> = new Set([
  "trivia",
  "search",
  "puzzle",
  "observation",
  "navigation",
  "qr",
]);

export interface Checkpoint {
  checkpoint: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  clue: string;
  challengeType: ChallengeType;
  instruction: string;
  /** Required for self-checked types. Case-insensitive, trimmed exact match. */
  correctAnswer?: string;
  /** Required for "photo" type. Informational for the (future) AI judging layer. */
  aiCriteria?: string[];
  rewardPoints: number;
  wrongPenaltySeconds: number;
  skipPenaltySeconds: number;
  timeLimitSeconds: number;
}

export interface RaceConfig {
  checkpoints: Checkpoint[];
}

export interface Team {
  id: string;
  name: string;
  colour: string;
  pin: string;
}

export type Verdict = "correct" | "incorrect" | "ambiguous";

export interface CheckpointAttempt {
  checkpointNumber: number;
  unlockedAtMs: number;
  submittedAtMs: number;
  verdict: Verdict;
  penaltySeconds: number;
  /** True if this attempt was a skip rather than a submission. */
  skipped: boolean;
  /** Set for photo/interaction attempts - the AI's or organiser's stated reason. */
  reason?: string;
  /** Vercel Blob URL, when photo storage is configured. */
  photoUrl?: string;
}

export interface TeamState {
  teamId: string;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  /** Index into config.checkpoints of the checkpoint the team is currently on. */
  currentIndex: number;
  currentUnlockedAtMs: number | null;
  penaltySeconds: number;
  skipSeconds: number;
  points: number;
  attempts: CheckpointAttempt[];
}

export type GameEventType =
  | "team_started"
  | "checkpoint_unlocked"
  | "gps_reported"
  | "answer_submitted"
  | "judgement_submitted"
  | "checkpoint_passed"
  | "checkpoint_failed"
  | "checkpoint_ambiguous"
  | "checkpoint_skipped"
  | "team_finished"
  | "manual_unlock";

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
}

export type GpsRejectReason = "poor_accuracy" | "too_far";

export interface GpsFixResult {
  accepted: boolean;
  distanceMeters: number;
  accuracyMeters: number;
  reason?: GpsRejectReason;
}

export interface GameEvent {
  type: GameEventType;
  teamId: string;
  checkpoint?: number;
  atMs: number;
  data?: Record<string, unknown>;
}

export interface SubmitResult {
  outcome: "correct" | "incorrect" | "ambiguous" | "skipped";
  penaltySeconds: number;
  pointsAwarded: number;
  nextCheckpoint: Checkpoint | null;
  finished: boolean;
}

export interface LeaderboardEntry {
  teamId: string;
  finished: boolean;
  checkpointsCleared: number;
  totalCheckpoints: number;
  adjustedTimeSeconds: number | null;
  points: number;
}

/**
 * A JSON-safe snapshot of everything RaceEngine mutates. Team/checkpoint
 * config is not included - it is static and rebuilt from the challenge
 * files on every request. Used to persist race state across serverless
 * invocations (see lib/raceStore.ts).
 */
export interface SerializedRace {
  stateByTeam: Array<[string, TeamState]>;
  events: GameEvent[];
}
