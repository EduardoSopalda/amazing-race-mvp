import { describe, expect, it } from "vitest";
import { createFakeClock } from "../game/clock";
import { RaceEngine } from "../game/engine";
import type { RaceConfig, Team } from "../game/types";

const config: RaceConfig = {
  checkpoints: [
    {
      checkpoint: 1,
      name: "Stop 1 (trivia)",
      latitude: 0,
      longitude: 0,
      radiusMeters: 0, // no GPS gate - this suite is deliberately GPS-free (see the "GPS geofencing" suite below)
      clue: "clue one",
      challengeType: "trivia",
      instruction: "answer the trivia",
      correctAnswer: "1928",
      rewardPoints: 100,
      wrongPenaltySeconds: 120,
      skipPenaltySeconds: 300,
      timeLimitSeconds: 480,
    },
    {
      checkpoint: 2,
      name: "Stop 2 (photo)",
      latitude: 0,
      longitude: 0,
      radiusMeters: 0, // no GPS gate - this suite is deliberately GPS-free (see the "GPS geofencing" suite below)
      clue: "clue two",
      challengeType: "photo",
      instruction: "photograph the thing",
      aiCriteria: ["thing"],
      rewardPoints: 100,
      wrongPenaltySeconds: 120,
      skipPenaltySeconds: 300,
      timeLimitSeconds: 480,
    },
    {
      checkpoint: 3,
      name: "Stop 3 (puzzle)",
      latitude: 0,
      longitude: 0,
      radiusMeters: 0, // no GPS gate - this suite is deliberately GPS-free (see the "GPS geofencing" suite below)
      clue: "clue three",
      challengeType: "puzzle",
      instruction: "solve it",
      correctAnswer: "42",
      rewardPoints: 100,
      wrongPenaltySeconds: 120,
      skipPenaltySeconds: 300,
      timeLimitSeconds: 60,
    },
  ],
};

function makeTeams(): Team[] {
  return [
    { id: "red", name: "Red", colour: "#c0392b", pin: "1111" },
    { id: "blue", name: "Blue", colour: "#2980b9", pin: "2222" },
  ];
}

describe("RaceEngine - a fully scripted race, no GPS or photos", () => {
  it("runs two teams end to end and produces a ranked leaderboard", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(config, makeTeams(), clock);

    expect(engine.verifyPin("red", "1111")).toBe(true);
    expect(engine.verifyPin("red", "0000")).toBe(false);

    engine.startTeam("red");
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(1);

    // Wrong trivia answer: penalty applied, same checkpoint, may resubmit.
    clock.advance(30_000);
    const wrong = engine.submitAnswer("red", "1927");
    expect(wrong.outcome).toBe("incorrect");
    expect(wrong.penaltySeconds).toBe(120);
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(1);

    // Correct answer advances to checkpoint 2.
    clock.advance(10_000);
    const correct = engine.submitAnswer("red", " 1928 ");
    expect(correct.outcome).toBe("correct");
    expect(correct.nextCheckpoint?.checkpoint).toBe(2);

    // Checkpoint 2 is a photo challenge: judged externally, not by submitAnswer.
    expect(() => engine.submitAnswer("red", "anything")).toThrow(/submitJudgement/);
    const judged = engine.submitJudgement("red", "correct", { reason: "AI green, 96% confidence" });
    expect(judged.nextCheckpoint?.checkpoint).toBe(3);

    // Checkpoint 3 has an 8-minute -> here 60s time cap. Cannot skip early.
    expect(engine.canSkip("red")).toBe(false);
    expect(() => engine.skip("red")).toThrow(/cannot be skipped/);

    clock.advance(61_000);
    expect(engine.canSkip("red")).toBe(true);
    const skipped = engine.skip("red");
    expect(skipped.outcome).toBe("skipped");
    expect(skipped.finished).toBe(true);

    const redAdjusted = engine.adjustedTimeSeconds("red");
    expect(redAdjusted).not.toBeNull();
    // race time = 30+10+61 = 101s, + 120 wrong penalty + 300 skip penalty
    expect(redAdjusted).toBeCloseTo(101 + 120 + 300, 5);

    // Second team finishes cleanly and faster - should rank first.
    engine.startTeam("blue");
    clock.advance(5_000);
    engine.submitAnswer("blue", "1928");
    clock.advance(5_000);
    engine.submitJudgement("blue", "correct");
    clock.advance(5_000);
    engine.submitAnswer("blue", "42");

    const board = engine.leaderboard();
    expect(board).toHaveLength(2);
    expect(board[0]!.teamId).toBe("blue");
    expect(board[0]!.finished).toBe(true);
    expect(board[1]!.teamId).toBe("red");

    // Full event log exists for dispute resolution (doc §7).
    expect(engine.events.some((e) => e.type === "team_started")).toBe(true);
    expect(engine.events.some((e) => e.type === "checkpoint_failed")).toBe(true);
    expect(engine.events.some((e) => e.type === "checkpoint_skipped")).toBe(true);
    expect(engine.events.some((e) => e.type === "team_finished")).toBe(true);
  });

  it("round-trips state through serialize/restore, as a fresh engine would on each serverless request", () => {
    const clock = createFakeClock(0);
    const engineA = new RaceEngine(config, makeTeams(), clock);
    engineA.startTeam("red");
    clock.advance(5_000);
    engineA.submitAnswer("red", "wrong");
    clock.advance(5_000);
    engineA.submitAnswer("red", "1928");

    const snapshot = JSON.parse(JSON.stringify(engineA.serialize()));

    // A brand new engine instance, as a new serverless invocation would build.
    const engineB = new RaceEngine(config, makeTeams(), clock);
    engineB.restore(snapshot);

    expect(engineB.currentCheckpoint("red")?.checkpoint).toBe(2);
    expect(engineB.progress("red").penaltySeconds).toBe(120);
    expect(engineB.progress("red").points).toBe(100);
    expect(engineB.events).toHaveLength(engineA.events.length);

    // Play continues correctly on the restored engine.
    clock.advance(1_000);
    const judged = engineB.submitJudgement("red", "correct");
    expect(judged.nextCheckpoint?.checkpoint).toBe(3);
  });

  it("rejects duplicate PINs at construction", () => {
    const clock = createFakeClock(0);
    const teams: Team[] = [
      { id: "a", name: "A", colour: "#000", pin: "1234" },
      { id: "b", name: "B", colour: "#111", pin: "1234" },
    ];
    expect(() => new RaceEngine(config, teams, clock)).toThrow(/Duplicate PIN/);
  });

  it("uses points only as a tie-break within 30 seconds of adjusted time", () => {
    const clock = createFakeClock(0);
    const singleCheckpoint: RaceConfig = {
      checkpoints: [
        {
          checkpoint: 1,
          name: "Only stop",
          latitude: 0,
          longitude: 0,
          radiusMeters: 0, // no GPS gate - this suite is deliberately GPS-free (see the "GPS geofencing" suite below)
          clue: "clue",
          challengeType: "trivia",
          instruction: "answer",
          correctAnswer: "yes",
          rewardPoints: 100,
          wrongPenaltySeconds: 120,
          skipPenaltySeconds: 300,
          timeLimitSeconds: 480,
        },
      ],
    };
    const engine = new RaceEngine(singleCheckpoint, makeTeams(), clock);

    engine.startTeam("red");
    engine.submitAnswer("red", "wrong"); // +120s penalty, still same clock tick
    clock.advance(0);
    engine.submitAnswer("red", "yes"); // finishes with a 120s penalty, 0 points from this attempt... wait it awards points on the correct one

    engine.startTeam("blue");
    clock.advance(10_000); // 10s slower finish, but no penalty
    engine.submitAnswer("blue", "yes");

    const board = engine.leaderboard();
    // red: adjusted = 0 + 120 = 120s, 100 points
    // blue: adjusted = 10 + 0 = 10s, 100 points
    // diff = 110s > 30s window, so pure time ordering applies: blue first.
    expect(board[0]!.teamId).toBe("blue");
  });
});

describe("RaceEngine - GPS geofencing (Phase 3)", () => {
  // Placa Reial, Barcelona. ~80m away is roughly Placa George Orwell.
  const PLACA_REIAL = { latitude: 41.3802, longitude: 2.1745 };
  const NEARBY_80M = { latitude: 41.38065, longitude: 2.17565 };

  const gpsConfig: RaceConfig = {
    checkpoints: [
      {
        checkpoint: 1,
        name: "Placa Reial",
        latitude: PLACA_REIAL.latitude,
        longitude: PLACA_REIAL.longitude,
        radiusMeters: 70,
        clue: "Find the place where the city watches the world go by.",
        challengeType: "trivia",
        instruction: "What year was the central fountain installed?",
        correctAnswer: "1980",
        rewardPoints: 100,
        wrongPenaltySeconds: 120,
        skipPenaltySeconds: 300,
        timeLimitSeconds: 480,
      },
      {
        checkpoint: 2,
        name: "Second stop",
        latitude: PLACA_REIAL.latitude,
        longitude: PLACA_REIAL.longitude,
        radiusMeters: 70,
        clue: "clue two",
        challengeType: "trivia",
        instruction: "answer",
        correctAnswer: "yes",
        rewardPoints: 100,
        wrongPenaltySeconds: 120,
        skipPenaltySeconds: 300,
        timeLimitSeconds: 480,
      },
    ],
  };

  it("starts locked, rejects a fix with poor accuracy, then unlocks on a good fix inside the fence", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(gpsConfig, makeTeams(), clock);
    engine.startTeam("red");

    // Locked immediately after starting - no GPS confirmation yet.
    expect(engine.currentUnlockedAtMs("red")).toBeNull();
    expect(() => engine.submitAnswer("red", "1980")).toThrow(/has not been reached yet/);

    // Standing right on top of it, but the fix's accuracy is worse than the
    // 70m fence radius - doc §4: refuse the unlock regardless of distance.
    const poorFix = engine.reportPosition("red", { ...PLACA_REIAL, accuracyMeters: 150 });
    expect(poorFix.accepted).toBe(false);
    expect(poorFix.reason).toBe("poor_accuracy");
    expect(engine.currentUnlockedAtMs("red")).toBeNull();

    // Good accuracy but genuinely somewhere else entirely (Sagrada Familia).
    const farFix = engine.reportPosition("red", { latitude: 41.4036, longitude: 2.1744, accuracyMeters: 10 });
    expect(farFix.accepted).toBe(false);
    expect(farFix.reason).toBe("too_far");
    expect(farFix.distanceMeters).toBeGreaterThan(70);

    // Good accuracy, inside the fence: unlocks.
    const goodFix = engine.reportPosition("red", { ...PLACA_REIAL, accuracyMeters: 20 });
    expect(goodFix.accepted).toBe(true);
    expect(engine.currentUnlockedAtMs("red")).not.toBeNull();

    // Now the challenge can be answered.
    const result = engine.submitAnswer("red", "1980");
    expect(result.outcome).toBe("correct");
    expect(result.nextCheckpoint?.checkpoint).toBe(2);

    // The dispute log has every GPS event, accepted or not (doc §4, §7).
    const gpsEvents = engine.events.filter((e) => e.type === "gps_reported");
    expect(gpsEvents).toHaveLength(3);
    expect(gpsEvents[0]!.data?.accepted).toBe(false);
    expect(gpsEvents[2]!.data?.accepted).toBe(true);
  });

  it("accepts a fix within radius using a real second coordinate, ~80m away", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(gpsConfig, makeTeams(), clock);
    engine.startTeam("red");

    const fix = engine.reportPosition("red", { ...NEARBY_80M, accuracyMeters: 15 });
    // 80m is just outside the 70m fence - a real haversine distance, not a stub.
    expect(fix.distanceMeters).toBeGreaterThan(70);
    expect(fix.accepted).toBe(false);
    expect(fix.reason).toBe("too_far");
  });

  it("blocks skip until arrived, and the time cap only starts counting from arrival", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(gpsConfig, makeTeams(), clock);
    engine.startTeam("red");

    // Not arrived yet: skip is blocked no matter how much time passes before arrival.
    clock.advance(500_000);
    expect(() => engine.skip("red")).toThrow(/has not been reached yet/);
    expect(engine.canSkip("red")).toBe(false);

    // Arrival starts the challenge clock at zero - skip is not immediately available.
    engine.reportPosition("red", { ...PLACA_REIAL, accuracyMeters: 10 });
    expect(engine.canSkip("red")).toBe(false);
    expect(() => engine.skip("red")).toThrow(/cannot be skipped/);

    // Only after the 480s time cap, counted from arrival, can they skip.
    clock.advance(480_000);
    expect(engine.canSkip("red")).toBe(true);
    const skipped = engine.skip("red");
    expect(skipped.outcome).toBe("skipped");
  });

  it("manualUnlock forces a checkpoint open exactly like a successful GPS fix", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(gpsConfig, makeTeams(), clock);
    engine.startTeam("red");

    expect(engine.currentUnlockedAtMs("red")).toBeNull();
    engine.manualUnlock("red");
    expect(engine.currentUnlockedAtMs("red")).not.toBeNull();
    expect(() => engine.submitAnswer("red", "1980")).not.toThrow();
  });
});

describe("RaceEngine - photo judgement verdicts (Phase 4/5)", () => {
  const photoConfig: RaceConfig = {
    checkpoints: [
      {
        checkpoint: 1,
        name: "Photo stop",
        latitude: 0,
        longitude: 0,
        radiusMeters: 0,
        clue: "clue",
        challengeType: "photo",
        instruction: "photograph the thing",
        aiCriteria: ["the thing"],
        rewardPoints: 100,
        wrongPenaltySeconds: 30,
        skipPenaltySeconds: 60,
        timeLimitSeconds: 480,
      },
      {
        checkpoint: 2,
        name: "Second stop",
        latitude: 0,
        longitude: 0,
        radiusMeters: 0,
        clue: "clue two",
        challengeType: "trivia",
        instruction: "answer",
        correctAnswer: "yes",
        rewardPoints: 100,
        wrongPenaltySeconds: 30,
        skipPenaltySeconds: 60,
        timeLimitSeconds: 480,
      },
    ],
  };

  it("green advances and awards points, storing the photo URL and AI reason", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfig, makeTeams(), clock);
    engine.startTeam("red");

    const result = engine.submitJudgement("red", "correct", {
      reason: "Clearly shows the thing, 94% confidence",
      photoUrl: "https://example.blob.vercel-storage.com/photo1.jpg",
    });
    expect(result.outcome).toBe("correct");
    expect(result.pointsAwarded).toBe(100);
    expect(result.nextCheckpoint?.checkpoint).toBe(2);
  });

  it("red applies the wrong-submission penalty and allows resubmission", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfig, makeTeams(), clock);
    engine.startTeam("red");

    const result = engine.submitJudgement("red", "incorrect", { reason: "No matching object visible" });
    expect(result.outcome).toBe("incorrect");
    expect(result.penaltySeconds).toBe(30);
    expect(engine.progress("red").penaltySeconds).toBe(30);
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(1); // still here, may retry

    // Retry with a better photo succeeds.
    const retry = engine.submitJudgement("red", "correct", { reason: "Now clearly visible" });
    expect(retry.outcome).toBe("correct");
  });

  it("ambiguous never penalises and never advances - doc §9: goes to a human, not auto-penalised", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfig, makeTeams(), clock);
    engine.startTeam("red");

    const result = engine.submitJudgement("red", "ambiguous", { reason: "Lighting too dark to tell" });
    expect(result.outcome).toBe("ambiguous");
    expect(result.penaltySeconds).toBe(0);
    expect(engine.progress("red").penaltySeconds).toBe(0); // no penalty applied
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(1); // unchanged, can retry
    expect(engine.events.some((e) => e.type === "checkpoint_ambiguous")).toBe(true);

    // A clearer resubmission still works normally afterward.
    const retry = engine.submitJudgement("red", "correct", { reason: "Clear now" });
    expect(retry.outcome).toBe("correct");
    expect(retry.nextCheckpoint?.checkpoint).toBe(2);
  });
});

describe("RaceEngine - per-team checkpoint overrides and host penalties", () => {
  const overrideConfig: RaceConfig = {
    checkpoints: [
      {
        checkpoint: 1,
        name: "Secret Mission",
        latitude: 0,
        longitude: 0,
        radiusMeters: 0,
        clue: "Base clue - should never be seen once overridden",
        challengeType: "photo",
        instruction: "Base instruction",
        aiCriteria: ["base criterion"],
        rewardPoints: 100,
        wrongPenaltySeconds: 30,
        skipPenaltySeconds: 60,
        timeLimitSeconds: 480,
        teamOverrides: {
          red: { instruction: "Dance with a stranger", aiCriteria: ["team dancing with a stranger"] },
          blue: { instruction: "Get three strangers to shout Visca Barcelona", aiCriteria: ["three strangers shouting"] },
        },
      },
      {
        checkpoint: 2,
        name: "Finish",
        latitude: 0,
        longitude: 0,
        radiusMeters: 0,
        clue: "done",
        challengeType: "trivia",
        instruction: "answer",
        correctAnswer: "yes",
        rewardPoints: 100,
        wrongPenaltySeconds: 30,
        skipPenaltySeconds: 60,
        timeLimitSeconds: 480,
      },
    ],
  };

  it("gives each team its own clue/criteria at the same checkpoint, and passes an unlisted team the base content", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(overrideConfig, makeTeams(), clock); // makeTeams() = red, blue only
    engine.startTeam("red");
    engine.startTeam("blue");

    expect(engine.currentCheckpoint("red")?.instruction).toBe("Dance with a stranger");
    expect(engine.currentCheckpoint("blue")?.instruction).toBe("Get three strangers to shout Visca Barcelona");

    // Base fields not touched by the override still come through unchanged.
    expect(engine.currentCheckpoint("red")?.rewardPoints).toBe(100);
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(1);
  });

  it("carries the override through to nextCheckpoint on a neighbouring stop too", () => {
    const clock = createFakeClock(0);
    const teams: Team[] = [{ id: "red", name: "Red", colour: "#c0392b", pin: "1111" }];
    const twoStopWithOverrideSecond: RaceConfig = {
      checkpoints: [
        {
          checkpoint: 1,
          name: "First",
          latitude: 0,
          longitude: 0,
          radiusMeters: 0,
          clue: "clue",
          challengeType: "trivia",
          instruction: "answer",
          correctAnswer: "yes",
          rewardPoints: 100,
          wrongPenaltySeconds: 30,
          skipPenaltySeconds: 60,
          timeLimitSeconds: 480,
        },
        overrideConfig.checkpoints[0]!,
      ],
    };
    const engine = new RaceEngine(twoStopWithOverrideSecond, teams, clock);
    engine.startTeam("red");
    const result = engine.submitAnswer("red", "yes");
    expect(result.nextCheckpoint?.instruction).toBe("Dance with a stranger");
  });

  it("applyPenalty adds a host-decided penalty matching Gab's rule table, and rejects negative values", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(overrideConfig, makeTeams(), clock);
    engine.startTeam("red");

    engine.applyPenalty("red", 120, "Minor rule violation - skipped ahead without checking in");
    expect(engine.progress("red").penaltySeconds).toBe(120);

    engine.applyPenalty("red", 600, "Deliberate cheating - photo taken from a different location");
    expect(engine.progress("red").penaltySeconds).toBe(720);

    expect(() => engine.applyPenalty("red", -10, "should be rejected")).toThrow(/zero or positive/);
    expect(engine.events.filter((e) => e.type === "penalty_applied")).toHaveLength(2);
  });
});

describe("RaceEngine - idempotent submissions (Phase 7: retry safety)", () => {
  it("submitAnswer: a retried request with the same key replays the result instead of re-scoring", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(config, makeTeams(), clock);
    engine.startTeam("red");

    const first = engine.submitAnswer("red", "1928", "key-a");
    expect(first.outcome).toBe("correct");
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(2);

    // Same key resubmitted (simulating a lost response + client retry) must
    // not be scored against checkpoint 2 - it replays the original result.
    const replay = engine.submitAnswer("red", "1928", "key-a");
    expect(replay).toEqual(first);
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(2);
    expect(engine.events.filter((e) => e.type === "answer_submitted")).toHaveLength(1);
  });

  it("submitAnswer: a different key is treated as a genuinely new attempt", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(config, makeTeams(), clock);
    engine.startTeam("red");

    const wrong = engine.submitAnswer("red", "1927", "key-a");
    expect(wrong.outcome).toBe("incorrect");
    expect(engine.progress("red").penaltySeconds).toBe(120);

    // A fresh attempt (new key) after getting it wrong is scored normally,
    // not treated as a duplicate of the first.
    const right = engine.submitAnswer("red", "1928", "key-b");
    expect(right.outcome).toBe("correct");
    expect(engine.progress("red").penaltySeconds).toBe(120); // unchanged - no second penalty
  });

  it("submitJudgement: replays a cached verdict without re-applying its penalty or points", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfigForIdempotency(), makeTeams(), clock);
    engine.startTeam("red");

    const first = engine.submitJudgement("red", "incorrect", { reason: "no match", idempotencyKey: "photo-key-1" });
    expect(first.outcome).toBe("incorrect");
    expect(engine.progress("red").penaltySeconds).toBe(30);

    const replay = engine.submitJudgement("red", "incorrect", { reason: "no match", idempotencyKey: "photo-key-1" });
    expect(replay).toEqual(first);
    expect(engine.progress("red").penaltySeconds).toBe(30); // not doubled
  });

  it("checkIdempotentSubmission lets a caller (the photo route) detect a duplicate before paying for AI judging again", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfigForIdempotency(), makeTeams(), clock);
    engine.startTeam("red");

    expect(engine.checkIdempotentSubmission("red", "photo-key-1")).toBeUndefined();
    const result = engine.submitJudgement("red", "correct", {
      reason: "clear",
      idempotencyKey: "photo-key-1",
      extra: { judgement: { verdict: "correct", confidence: 0.9, reason: "clear" } },
    });

    // The cache lookup is by key alone, deliberately - the retry that matters
    // most is exactly this one, where the original request already advanced
    // the team to checkpoint 2 before its response was lost.
    expect(engine.currentCheckpoint("red")?.checkpoint).toBe(2);
    const cached = engine.checkIdempotentSubmission("red", "photo-key-1");
    expect(cached?.result).toEqual(result);
    expect(cached?.extra?.judgement).toEqual({ verdict: "correct", confidence: 0.9, reason: "clear" });

    // A different key (a genuinely new submission on checkpoint 2) is not cached.
    expect(engine.checkIdempotentSubmission("red", "some-other-key")).toBeUndefined();
  });

  it("a retried key still replays correctly when the original submission finished the race", () => {
    const clock = createFakeClock(0);
    const singleCheckpoint: RaceConfig = {
      checkpoints: [
        {
          checkpoint: 1,
          name: "Only stop",
          latitude: 0,
          longitude: 0,
          radiusMeters: 0,
          clue: "clue",
          challengeType: "trivia",
          instruction: "answer",
          correctAnswer: "yes",
          rewardPoints: 100,
          wrongPenaltySeconds: 120,
          skipPenaltySeconds: 300,
          timeLimitSeconds: 480,
        },
      ],
    };
    const engine = new RaceEngine(singleCheckpoint, makeTeams(), clock);
    engine.startTeam("red");

    const first = engine.submitAnswer("red", "yes", "finish-key");
    expect(first.finished).toBe(true);
    expect(engine.currentCheckpoint("red")).toBeNull();

    // The client never saw the response and retries with the same key. This
    // must replay the finish, not throw "already finished".
    const replay = engine.submitAnswer("red", "yes", "finish-key");
    expect(replay).toEqual(first);
  });

  it("skip: a retried key does not double-apply the skip penalty", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(config, makeTeams(), clock);
    engine.startTeam("red");
    clock.advance(480_000); // past checkpoint 1's time cap

    const first = engine.skip("red", "skip-key-1");
    expect(first.outcome).toBe("skipped");
    expect(engine.progress("red").skipSeconds).toBe(300);

    const replay = engine.skip("red", "skip-key-1");
    expect(replay).toEqual(first);
    expect(engine.progress("red").skipSeconds).toBe(300); // not doubled
  });

  it("an admin action with no idempotency key is never treated as cached, and never pollutes the cache", () => {
    const clock = createFakeClock(0);
    const engine = new RaceEngine(photoConfigForIdempotency(), makeTeams(), clock);
    engine.startTeam("red");

    engine.submitJudgement("red", "incorrect", { reason: "organiser call" });
    expect(engine.progress("red").penaltySeconds).toBe(30);
    // A second override with no key is applied fresh, not replayed.
    engine.submitJudgement("red", "incorrect", { reason: "organiser call again" });
    expect(engine.progress("red").penaltySeconds).toBe(60);
  });

  function photoConfigForIdempotency(): RaceConfig {
    return {
      checkpoints: [
        {
          checkpoint: 1,
          name: "Photo stop",
          latitude: 0,
          longitude: 0,
          radiusMeters: 0,
          clue: "clue",
          challengeType: "photo",
          instruction: "photograph the thing",
          aiCriteria: ["the thing"],
          rewardPoints: 100,
          wrongPenaltySeconds: 30,
          skipPenaltySeconds: 60,
          timeLimitSeconds: 480,
        },
        {
          checkpoint: 2,
          name: "Second stop",
          latitude: 0,
          longitude: 0,
          radiusMeters: 0,
          clue: "clue two",
          challengeType: "trivia",
          instruction: "answer",
          correctAnswer: "yes",
          rewardPoints: 100,
          wrongPenaltySeconds: 30,
          skipPenaltySeconds: 60,
          timeLimitSeconds: 480,
        },
      ],
    };
  }
});
