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
      radiusMeters: 50,
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
      radiusMeters: 50,
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
      radiusMeters: 50,
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
    const judged = engine.submitJudgement("red", "correct", "AI green, 96% confidence");
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
          radiusMeters: 50,
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
