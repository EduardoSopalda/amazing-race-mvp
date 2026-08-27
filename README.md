# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Concept and full spec in
`docs/CONCEPT.md`.

## Status: Phase 1 - Engine

Per the build sequence in the concept doc (§13), this repo currently ships
**only** the race engine: teams, PINs, checkpoints, scoring, penalties, and a
server-authoritative clock. No GPS, no photo capture, no UI yet. Done when a
scripted race can be completed without GPS or photos - see `tests/engine.test.ts`.

```
game/
  types.ts     Checkpoint, Team, TeamState, GameEvent, LeaderboardEntry
  clock.ts     Clock interface + a fake clock for deterministic tests
  scoring.ts   adjusted time, leaderboard ranking with the 30s tie-break rule
  engine.ts    RaceEngine: startTeam, submitAnswer, submitJudgement, skip,
               manualUnlock, leaderboard
challenges/
  barcelona.example.json   TEST DATA - not a real, walked route
tests/
  engine.test.ts
```

## Running

```
npm install
npm run test
npm run typecheck
```

## What's not built yet

Everything past Phase 1 in the doc's build sequence: the player PWA, real
GPS geofencing, photo capture and AI judging, the organiser dashboard, and
hardening for a real afternoon in Barcelona. See `docs/CONCEPT.md` §13 for
the full phase list, and §18 for the open decisions (area, checkpoint count,
privacy retention) that need answers before the next phase starts.

The checkpoints in `challenges/barcelona.example.json` are placeholders for
testing the engine only. The concept doc's own recommended first move: freeze
the real 10 checkpoints and walk the loop before writing any more code.
