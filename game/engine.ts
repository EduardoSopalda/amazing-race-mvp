import { systemClock, type Clock } from "./clock";
import { adjustedTimeSeconds, rankLeaderboard } from "./scoring";
import {
  SELF_CHECKED_TYPES,
  type Checkpoint,
  type GameEvent,
  type LeaderboardEntry,
  type RaceConfig,
  type SerializedRace,
  type SubmitResult,
  type Team,
  type TeamState,
  type Verdict,
} from "./types";

function normaliseAnswer(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The race engine. Phase 1 scope only (doc §13): teams, PINs, checkpoints,
 * clues, scoring, penalties, server clock. No GPS and no photo capture -
 * geofence unlocking and AI photo judging are separate phases that call into
 * this same state machine (unlockCheckpoint / submitJudgement) once built.
 */
export class RaceEngine {
  private readonly config: RaceConfig;
  private readonly clock: Clock;
  private readonly teamsById: Map<string, Team> = new Map();
  private readonly stateByTeam: Map<string, TeamState> = new Map();
  readonly events: GameEvent[] = [];

  constructor(config: RaceConfig, teams: Team[], clock: Clock = systemClock) {
    if (config.checkpoints.length === 0) {
      throw new Error("RaceConfig must have at least one checkpoint");
    }
    const seenPins = new Set<string>();
    for (const team of teams) {
      if (seenPins.has(team.pin)) {
        throw new Error(`Duplicate PIN "${team.pin}" across teams`);
      }
      seenPins.add(team.pin);
      this.teamsById.set(team.id, team);
    }
    this.config = config;
    this.clock = clock;
  }

  private log(event: Omit<GameEvent, "atMs">): void {
    this.events.push({ ...event, atMs: this.clock.now() });
  }

  private requireTeam(teamId: string): Team {
    const team = this.teamsById.get(teamId);
    if (!team) throw new Error(`Unknown team "${teamId}"`);
    return team;
  }

  private requireState(teamId: string): TeamState {
    const state = this.stateByTeam.get(teamId);
    if (!state) throw new Error(`Team "${teamId}" has not started`);
    return state;
  }

  verifyPin(teamId: string, pin: string): boolean {
    return this.requireTeam(teamId).pin === pin;
  }

  /** Team name/colour only - never expose PINs to a client. */
  publicTeams(): Array<{ id: string; name: string; colour: string }> {
    return [...this.teamsById.values()].map(({ id, name, colour }) => ({ id, name, colour }));
  }

  hasStarted(teamId: string): boolean {
    this.requireTeam(teamId);
    return this.stateByTeam.has(teamId);
  }

  /** 1-based position of the current checkpoint, e.g. 3 of 10. Null once finished. */
  checkpointPosition(teamId: string): { index: number; total: number } | null {
    const state = this.requireState(teamId);
    if (state.finishedAtMs !== null) return null;
    return { index: state.currentIndex + 1, total: this.config.checkpoints.length };
  }

  startTeam(teamId: string): void {
    this.requireTeam(teamId);
    if (this.stateByTeam.has(teamId)) {
      throw new Error(`Team "${teamId}" has already started`);
    }
    const now = this.clock.now();
    const state: TeamState = {
      teamId,
      startedAtMs: now,
      finishedAtMs: null,
      currentIndex: 0,
      currentUnlockedAtMs: now,
      penaltySeconds: 0,
      skipSeconds: 0,
      points: 0,
      attempts: [],
    };
    this.stateByTeam.set(teamId, state);
    this.log({ type: "team_started", teamId });
    this.log({ type: "checkpoint_unlocked", teamId, checkpoint: this.config.checkpoints[0]!.checkpoint });
  }

  currentCheckpoint(teamId: string): Checkpoint | null {
    const state = this.requireState(teamId);
    if (state.finishedAtMs !== null) return null;
    return this.config.checkpoints[state.currentIndex] ?? null;
  }

  /** Seconds since the current checkpoint's clue was unlocked (doc §7: 8-minute cap). */
  elapsedOnCurrentCheckpointSeconds(teamId: string): number {
    const state = this.requireState(teamId);
    if (state.currentUnlockedAtMs === null) return 0;
    return (this.clock.now() - state.currentUnlockedAtMs) / 1000;
  }

  /** Server timestamp the current checkpoint's clue unlocked, for client-side countdowns. */
  currentUnlockedAtMs(teamId: string): number | null {
    return this.requireState(teamId).currentUnlockedAtMs;
  }

  /** Skip is only offered once the challenge time cap has passed (doc §3, §7). */
  canSkip(teamId: string): boolean {
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) return false;
    return this.elapsedOnCurrentCheckpointSeconds(teamId) >= checkpoint.timeLimitSeconds;
  }

  private advance(teamId: string, checkpoint: Checkpoint, pointsAwarded: number): SubmitResult {
    const state = this.requireState(teamId);
    state.currentIndex += 1;
    const next = this.config.checkpoints[state.currentIndex] ?? null;
    const now = this.clock.now();

    if (next) {
      state.currentUnlockedAtMs = now;
      this.log({ type: "checkpoint_unlocked", teamId, checkpoint: next.checkpoint });
      return {
        outcome: "correct",
        penaltySeconds: 0,
        pointsAwarded,
        nextCheckpoint: next,
        finished: false,
      };
    }

    state.currentUnlockedAtMs = null;
    state.finishedAtMs = now;
    this.log({ type: "team_finished", teamId, checkpoint: checkpoint.checkpoint });
    return {
      outcome: "correct",
      penaltySeconds: 0,
      pointsAwarded,
      nextCheckpoint: null,
      finished: true,
    };
  }

  private recordFailedAttempt(
    state: TeamState,
    checkpoint: Checkpoint,
    verdict: Verdict,
    penaltySeconds: number,
    skipped: boolean
  ): void {
    state.attempts.push({
      checkpointNumber: checkpoint.checkpoint,
      unlockedAtMs: state.currentUnlockedAtMs ?? this.clock.now(),
      submittedAtMs: this.clock.now(),
      verdict,
      penaltySeconds,
      skipped,
    });
  }

  /**
   * Submit a string answer for a self-checked challenge type (trivia, search,
   * puzzle, observation, navigation, qr). Photo and interaction challenges go
   * through submitJudgement instead, since their verdict comes from AI or an
   * organiser rather than exact-match text.
   */
  submitAnswer(teamId: string, answer: string): SubmitResult {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    if (!SELF_CHECKED_TYPES.has(checkpoint.challengeType)) {
      throw new Error(
        `Checkpoint ${checkpoint.checkpoint} is challengeType "${checkpoint.challengeType}"; use submitJudgement`
      );
    }
    if (checkpoint.correctAnswer === undefined) {
      throw new Error(`Checkpoint ${checkpoint.checkpoint} has no correctAnswer configured`);
    }

    this.log({ type: "answer_submitted", teamId, checkpoint: checkpoint.checkpoint, data: { answer } });

    const isCorrect = normaliseAnswer(answer) === normaliseAnswer(checkpoint.correctAnswer);
    return this.resolveAttempt(state, checkpoint, isCorrect ? "correct" : "incorrect");
  }

  /**
   * Record the AI or organiser verdict for a photo/interaction challenge.
   * Also the entry point a future AI-judging layer calls after grading an
   * uploaded photo (doc §5): green/red map straight to "correct"/"incorrect",
   * amber is resolved by an organiser before this is called.
   */
  submitJudgement(teamId: string, verdict: Verdict, reason?: string): SubmitResult {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    if (SELF_CHECKED_TYPES.has(checkpoint.challengeType)) {
      throw new Error(
        `Checkpoint ${checkpoint.checkpoint} is challengeType "${checkpoint.challengeType}"; use submitAnswer`
      );
    }

    this.log({
      type: "judgement_submitted",
      teamId,
      checkpoint: checkpoint.checkpoint,
      data: { verdict, reason },
    });

    return this.resolveAttempt(state, checkpoint, verdict);
  }

  private resolveAttempt(state: TeamState, checkpoint: Checkpoint, verdict: Verdict): SubmitResult {
    if (verdict === "correct") {
      state.attempts.push({
        checkpointNumber: checkpoint.checkpoint,
        unlockedAtMs: state.currentUnlockedAtMs ?? this.clock.now(),
        submittedAtMs: this.clock.now(),
        verdict: "correct",
        penaltySeconds: 0,
        skipped: false,
      });
      state.points += checkpoint.rewardPoints;
      this.log({ type: "checkpoint_passed", teamId: state.teamId, checkpoint: checkpoint.checkpoint });
      return this.advance(state.teamId, checkpoint, checkpoint.rewardPoints);
    }

    // Wrong submission: penalty applied, team may resubmit (doc §7).
    state.penaltySeconds += checkpoint.wrongPenaltySeconds;
    this.recordFailedAttempt(state, checkpoint, "incorrect", checkpoint.wrongPenaltySeconds, false);
    this.log({
      type: "checkpoint_failed",
      teamId: state.teamId,
      checkpoint: checkpoint.checkpoint,
      data: { penaltySeconds: checkpoint.wrongPenaltySeconds },
    });
    return {
      outcome: "incorrect",
      penaltySeconds: checkpoint.wrongPenaltySeconds,
      pointsAwarded: 0,
      nextCheckpoint: checkpoint,
      finished: false,
    };
  }

  /** Skip the current checkpoint after the time cap, for a larger penalty (doc §7). */
  skip(teamId: string): SubmitResult {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    if (!this.canSkip(teamId)) {
      throw new Error(
        `Checkpoint ${checkpoint.checkpoint} cannot be skipped yet: time cap is ${checkpoint.timeLimitSeconds}s`
      );
    }

    state.skipSeconds += checkpoint.skipPenaltySeconds;
    this.recordFailedAttempt(state, checkpoint, "incorrect", checkpoint.skipPenaltySeconds, true);
    this.log({
      type: "checkpoint_skipped",
      teamId,
      checkpoint: checkpoint.checkpoint,
      data: { penaltySeconds: checkpoint.skipPenaltySeconds },
    });

    const result = this.advance(teamId, checkpoint, 0);
    return { ...result, outcome: "skipped", penaltySeconds: checkpoint.skipPenaltySeconds };
  }

  /**
   * Organiser override: force the current checkpoint open regardless of GPS
   * state. A no-op on the phase-1 engine (there is no geofence yet) but kept
   * as a stable entry point for the GPS phase, and to log the intervention.
   */
  manualUnlock(teamId: string): void {
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    this.log({ type: "manual_unlock", teamId, checkpoint: checkpoint.checkpoint });
  }

  progress(teamId: string): {
    startedAtMs: number | null;
    finishedAtMs: number | null;
    penaltySeconds: number;
    skipSeconds: number;
    points: number;
  } {
    const state = this.requireState(teamId);
    return {
      startedAtMs: state.startedAtMs,
      finishedAtMs: state.finishedAtMs,
      penaltySeconds: state.penaltySeconds,
      skipSeconds: state.skipSeconds,
      points: state.points,
    };
  }

  adjustedTimeSeconds(teamId: string): number | null {
    const state = this.requireState(teamId);
    if (state.startedAtMs === null || state.finishedAtMs === null) return null;
    return adjustedTimeSeconds(state.startedAtMs, state.finishedAtMs, state.penaltySeconds, state.skipSeconds);
  }

  /**
   * A JSON-safe snapshot of everything mutable (per-team progress + the
   * event log). Team/checkpoint config is not included - it comes back from
   * the same static challenge files on every request. Used to persist race
   * state across serverless invocations, since each one gets a fresh engine.
   */
  serialize(): SerializedRace {
    return {
      stateByTeam: [...this.stateByTeam.entries()],
      events: this.events,
    };
  }

  /** Replaces current progress and event log with a previously serialized snapshot. */
  restore(snapshot: SerializedRace): void {
    this.stateByTeam.clear();
    for (const [teamId, state] of snapshot.stateByTeam) {
      this.stateByTeam.set(teamId, state);
    }
    this.events.length = 0;
    this.events.push(...snapshot.events);
  }

  leaderboard(): LeaderboardEntry[] {
    const entries: LeaderboardEntry[] = [];
    for (const teamId of this.teamsById.keys()) {
      const state = this.stateByTeam.get(teamId);
      if (!state) continue; // team has not started yet
      entries.push({
        teamId,
        finished: state.finishedAtMs !== null,
        checkpointsCleared: state.currentIndex,
        totalCheckpoints: this.config.checkpoints.length,
        adjustedTimeSeconds: this.adjustedTimeSeconds(teamId),
        points: state.points,
      });
    }
    return rankLeaderboard(entries);
  }
}
