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

export type Verdict = "correct" | "incorrect";

export interface CheckpointAttempt {
  checkpointNumber: number;
  unlockedAtMs: number;
  submittedAtMs: number;
  verdict: Verdict;
  penaltySeconds: number;
  /** True if this attempt was a skip rather than a submission. */
  skipped: boolean;
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
  | "answer_submitted"
  | "judgement_submitted"
  | "checkpoint_passed"
  | "checkpoint_failed"
  | "checkpoint_skipped"
  | "team_finished"
  | "manual_unlock";

export interface GameEvent {
  type: GameEventType;
  teamId: string;
  checkpoint?: number;
  atMs: number;
  data?: Record<string, unknown>;
}

export interface SubmitResult {
  outcome: "correct" | "incorrect" | "skipped";
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
