import { systemClock, type Clock } from "./clock";
import { checkpointRequiresGps, distanceMeters } from "./geofence";
import { adjustedTimeSeconds, rankLeaderboard } from "./scoring";
import {
  SELF_CHECKED_TYPES,
  type Checkpoint,
  type GameEvent,
  type GpsFix,
  type GpsFixResult,
  type GpsRejectReason,
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
 * The race engine (doc §13 phases 1-3): teams, PINs, checkpoints, scoring,
 * penalties, server clock, and GPS geofenced unlocking. Photo capture and AI
 * judging are still separate phases that call into this same state machine
 * (submitJudgement) once built.
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
    const first = this.config.checkpoints[0]!;
    const state: TeamState = {
      teamId,
      startedAtMs: now,
      finishedAtMs: null,
      currentIndex: 0,
      // GPS-gated checkpoints (radiusMeters > 0) stay locked until reportPosition
      // confirms arrival (doc §4); ungated ones (desk-race test data) unlock now.
      currentUnlockedAtMs: checkpointRequiresGps(first) ? null : now,
      penaltySeconds: 0,
      skipSeconds: 0,
      points: 0,
      attempts: [],
    };
    this.stateByTeam.set(teamId, state);
    this.log({ type: "team_started", teamId });
    if (state.currentUnlockedAtMs !== null) {
      this.log({ type: "checkpoint_unlocked", teamId, checkpoint: first.checkpoint });
    }
  }

  /** Applies a checkpoint's teamOverrides (e.g. a per-colour "Secret Mission"), if any. */
  private resolveForTeam(checkpoint: Checkpoint, teamId: string): Checkpoint {
    const override = checkpoint.teamOverrides?.[teamId];
    if (!override) return checkpoint;
    return { ...checkpoint, ...override };
  }

  currentCheckpoint(teamId: string): Checkpoint | null {
    const state = this.requireState(teamId);
    if (state.finishedAtMs !== null) return null;
    const checkpoint = this.config.checkpoints[state.currentIndex];
    return checkpoint ? this.resolveForTeam(checkpoint, teamId) : null;
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
    const nextRaw = this.config.checkpoints[state.currentIndex];
    const next = nextRaw ? this.resolveForTeam(nextRaw, teamId) : null;
    const now = this.clock.now();

    if (next) {
      state.currentUnlockedAtMs = checkpointRequiresGps(next) ? null : now;
      if (state.currentUnlockedAtMs !== null) {
        this.log({ type: "checkpoint_unlocked", teamId, checkpoint: next.checkpoint });
      }
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

  private requireArrived(state: TeamState, checkpoint: Checkpoint): void {
    if (state.currentUnlockedAtMs === null) {
      throw new Error(
        `Checkpoint ${checkpoint.checkpoint} has not been reached yet - GPS must confirm arrival first`
      );
    }
  }

  /**
   * Record a GPS fix for the team's current checkpoint (doc §4). Accuracy is
   * checked before distance: a fix worse than the fence radius is refused
   * outright, regardless of how close it looks, so a sloppy signal can't
   * fake an arrival. Once a fix lands inside the fence, the checkpoint
   * unlocks and its challenge timer starts.
   */
  reportPosition(teamId: string, fix: GpsFix): GpsFixResult {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);

    const distance = distanceMeters(fix.latitude, fix.longitude, checkpoint.latitude, checkpoint.longitude);

    let accepted: boolean;
    let reason: GpsRejectReason | undefined;
    if (fix.accuracyMeters > checkpoint.radiusMeters) {
      accepted = false;
      reason = "poor_accuracy";
    } else if (distance > checkpoint.radiusMeters) {
      accepted = false;
      reason = "too_far";
    } else {
      accepted = true;
    }

    this.log({
      type: "gps_reported",
      teamId,
      checkpoint: checkpoint.checkpoint,
      data: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMeters: fix.accuracyMeters,
        distanceMeters: distance,
        accepted,
        reason,
      },
    });

    if (accepted && state.currentUnlockedAtMs === null) {
      state.currentUnlockedAtMs = this.clock.now();
    }

    return { accepted, distanceMeters: distance, accuracyMeters: fix.accuracyMeters, reason };
  }

  private recordFailedAttempt(
    state: TeamState,
    checkpoint: Checkpoint,
    verdict: Verdict,
    penaltySeconds: number,
    skipped: boolean,
    options: { reason?: string; photoUrl?: string } = {}
  ): void {
    state.attempts.push({
      checkpointNumber: checkpoint.checkpoint,
      unlockedAtMs: state.currentUnlockedAtMs ?? this.clock.now(),
      submittedAtMs: this.clock.now(),
      verdict,
      penaltySeconds,
      skipped,
      reason: options.reason,
      photoUrl: options.photoUrl,
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
    this.requireArrived(state, checkpoint);
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
   * Record the AI or organiser verdict for a photo/interaction challenge
   * (doc §5). Green ("correct") and red ("incorrect") resolve immediately.
   * Amber ("ambiguous") never auto-penalises (doc §9: "Ambiguous AI
   * decisions go to the organiser instead of auto-penalising") - with no
   * admin queue built yet (Phase 6), the team instead sees why and can
   * resubmit a clearer photo at no cost, same as a real organiser waving
   * them to try again.
   */
  submitJudgement(teamId: string, verdict: Verdict, options: { reason?: string; photoUrl?: string } = {}): SubmitResult {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    this.requireArrived(state, checkpoint);
    if (SELF_CHECKED_TYPES.has(checkpoint.challengeType)) {
      throw new Error(
        `Checkpoint ${checkpoint.checkpoint} is challengeType "${checkpoint.challengeType}"; use submitAnswer`
      );
    }

    this.log({
      type: "judgement_submitted",
      teamId,
      checkpoint: checkpoint.checkpoint,
      data: { verdict, reason: options.reason, photoUrl: options.photoUrl },
    });

    return this.resolveAttempt(state, checkpoint, verdict, options);
  }

  private resolveAttempt(
    state: TeamState,
    checkpoint: Checkpoint,
    verdict: Verdict,
    options: { reason?: string; photoUrl?: string } = {}
  ): SubmitResult {
    if (verdict === "correct") {
      state.attempts.push({
        checkpointNumber: checkpoint.checkpoint,
        unlockedAtMs: state.currentUnlockedAtMs ?? this.clock.now(),
        submittedAtMs: this.clock.now(),
        verdict: "correct",
        penaltySeconds: 0,
        skipped: false,
        reason: options.reason,
        photoUrl: options.photoUrl,
      });
      state.points += checkpoint.rewardPoints;
      this.log({ type: "checkpoint_passed", teamId: state.teamId, checkpoint: checkpoint.checkpoint });
      return this.advance(state.teamId, checkpoint, checkpoint.rewardPoints);
    }

    if (verdict === "ambiguous") {
      state.attempts.push({
        checkpointNumber: checkpoint.checkpoint,
        unlockedAtMs: state.currentUnlockedAtMs ?? this.clock.now(),
        submittedAtMs: this.clock.now(),
        verdict: "ambiguous",
        penaltySeconds: 0,
        skipped: false,
        reason: options.reason,
        photoUrl: options.photoUrl,
      });
      this.log({
        type: "checkpoint_ambiguous",
        teamId: state.teamId,
        checkpoint: checkpoint.checkpoint,
        data: { reason: options.reason },
      });
      return {
        outcome: "ambiguous",
        penaltySeconds: 0,
        pointsAwarded: 0,
        nextCheckpoint: checkpoint,
        finished: false,
      };
    }

    // Wrong submission: penalty applied, team may resubmit (doc §7).
    state.penaltySeconds += checkpoint.wrongPenaltySeconds;
    this.recordFailedAttempt(state, checkpoint, "incorrect", checkpoint.wrongPenaltySeconds, false, options);
    this.log({
      type: "checkpoint_failed",
      teamId: state.teamId,
      checkpoint: checkpoint.checkpoint,
      data: { penaltySeconds: checkpoint.wrongPenaltySeconds, reason: options.reason },
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
    this.requireArrived(state, checkpoint);
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
   * state (doc §9/§10 - dead phone, no signal, closed courtyard). No admin UI
   * calls this yet (that's Phase 6), but the engine behaviour is real: it
   * unlocks the checkpoint exactly as a successful GPS fix would.
   */
  manualUnlock(teamId: string): void {
    const state = this.requireState(teamId);
    const checkpoint = this.currentCheckpoint(teamId);
    if (!checkpoint) throw new Error(`Team "${teamId}" has already finished`);
    if (state.currentUnlockedAtMs === null) {
      state.currentUnlockedAtMs = this.clock.now();
    }
    this.log({ type: "manual_unlock", teamId, checkpoint: checkpoint.checkpoint });
  }

  /**
   * A host-applied penalty for a rule violation rather than a wrong
   * checkpoint submission - e.g. Gab's own house rules: minor violation
   * +2min, skipped requirement +5min, deliberate cheating +10min. No admin
   * UI calls this yet (Phase 6); it's the engine hook for one to call.
   * Negative seconds are rejected - use it to add time, not remove it.
   */
  applyPenalty(teamId: string, seconds: number, reason: string): void {
    const state = this.requireState(teamId);
    if (seconds < 0) {
      throw new Error("Penalty seconds must be zero or positive");
    }
    state.penaltySeconds += seconds;
    this.log({ type: "penalty_applied", teamId, data: { seconds, reason } });
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
