# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Concept and full spec in
`docs/CONCEPT.md`.

## Status: Phase 2 - Player PWA

Per the build sequence in the concept doc (§13):

- **Phase 1 (done):** the race engine - teams, PINs, checkpoints, scoring,
  penalties, a server-authoritative clock. `tests/engine.test.ts` runs a
  scripted two-team race with no GPS or photos.
- **Phase 2 (done):** a Next.js player PWA on top of that engine - team
  login by PIN, the current checkpoint's clue and countdown, submitting a
  text answer, skipping after the time cap, and a minimal read-only
  leaderboard. Done when four phones can play a desk race - verified against
  the running dev server (see `Running` below).

Still not built: real GPS geofencing (Phase 3), photo capture (Phase 4), AI
photo judging (Phase 5), and the organiser dashboard (Phase 6). The desk-race
checkpoints therefore only use self-checked challenge types (trivia,
observation, puzzle, navigation, qr) - photo and interaction challenges will
work once Phases 4-5 land; the player screen shows a placeholder for them
today instead of crashing.

```
game/
  types.ts     Checkpoint, Team, TeamState, GameEvent, LeaderboardEntry
  clock.ts     Clock interface + a fake clock for deterministic tests
  scoring.ts   adjusted time, leaderboard ranking with the 30s tie-break rule
  engine.ts    RaceEngine: startTeam, submitAnswer, submitJudgement, skip,
               manualUnlock, leaderboard, publicTeams, progress
lib/
  raceStore.ts   process-wide RaceEngine singleton (in-memory - see Limits)
  session.ts     the team session cookie name
  teamState.ts   builds the client-safe state payload (never leaks answers)
app/
  page.tsx                 landing
  team/login/page.tsx      PIN login
  team/page.tsx            current checkpoint, countdown, submit, skip
  leaderboard/page.tsx     public read-only standings
  api/teams                GET public team list
  api/team/login           POST {teamId, pin} -> sets session cookie, starts clock
  api/team/state           GET current race state for the logged-in team
  api/team/submit          POST {answer} for self-checked challenge types
  api/team/skip            POST skip (only once the time cap has passed)
  api/team/logout          POST clears the session cookie
  api/leaderboard          GET public standings
challenges/
  teams.example.json       TEST DATA - 4 example teams with PINs
  deskrace.example.json    TEST DATA - 5 self-checked-only checkpoints
  barcelona.example.json   TEST DATA from Phase 1 - includes photo challenges,
                            not usable end-to-end until Phase 5
tests/
  engine.test.ts
```

## Running

```
npm install
npm run test        # engine unit tests
npm run typecheck
npm run dev          # starts on 0.0.0.0:3000 so phones on the same Wi-Fi can reach it
```

For a real desk race across four phones: run `npm run dev` on your laptop,
find its LAN IP (e.g. `ipconfig getifaddr en0` on macOS), and open
`http://<that-ip>:3000` on each phone. Each team logs in at `/team/login`
with their PIN from `challenges/teams.example.json` - that also starts their
race clock. `/leaderboard` is public and needs no login.

## Limits of this phase

- **State is in-memory and single-process.** One `RaceEngine` lives in server
  memory (`lib/raceStore.ts`). Restarting `next dev`, or ever deploying to a
  serverless platform with multiple instances, loses or fragments race state.
  A real database (doc §11) is a later phase - fine for a laptop desk race,
  not for a real event.
- **No synchronised staggered start.** The real event has an organiser start
  all teams together (doc §15); here each team's clock starts the moment
  they log in. A "start the race" admin control is Phase 6.
- **Session cookie is not hardened.** It stores the team ID directly after a
  correct PIN check - fine for a friendly one-off event on trusted phones,
  not a security boundary.

## What's not built yet

GPS geofencing, photo capture, AI judging, the organiser dashboard (manual
unlock / override AI / review queue), and all of Phase 7-8 hardening and
polish. See `docs/CONCEPT.md` §13 for the full phase list, and §18 for the
open decisions (area, checkpoint count, privacy retention) that need answers
before Phase 3 starts.

The checkpoints in `challenges/*.example.json` are all placeholders for
testing. The concept doc's own recommended first move: freeze the real 10
Barcelona checkpoints and walk the loop before writing any more code.
