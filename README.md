# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Concept and full spec in
`docs/CONCEPT.md`.

## Status: Phase 3 - GPS geofencing

Per the build sequence in the concept doc (§13):

- **Phase 1 (done):** the race engine - teams, PINs, checkpoints, scoring,
  penalties, a server-authoritative clock. `tests/engine.test.ts` runs a
  scripted two-team race with no GPS or photos.
- **Phase 2 (done):** a Next.js player PWA on top of that engine - team
  login by PIN, the current checkpoint's clue and countdown, submitting a
  text answer, skipping after the time cap, and a minimal read-only
  leaderboard.
- **Phase 3 (done):** real GPS geofencing (doc §4). A checkpoint with a
  `radiusMeters > 0` now stays locked until the player's phone reports a
  position inside that fence - the accuracy gate is checked first (a fix
  worse than the fence radius is refused outright, regardless of distance),
  matching the doc exactly. Once a fix lands inside the fence, the
  checkpoint unlocks and its challenge timer starts. Verified with real
  haversine coordinates (Placa Reial, Barcelona) in `tests/engine.test.ts`
  and with real browser geolocation via Playwright (near/far scenarios).

The desk-race checkpoints (`challenges/deskrace.example.json`) all use
`radiusMeters: 0`, which means no fence at all - they unlock immediately, as
before, so the existing desk-race flow is unaffected. A checkpoint only goes
through the GPS gate once it has real coordinates and a real radius.

Still not built: photo capture (Phase 4), AI photo judging (Phase 5), and
the organiser dashboard (Phase 6). Self-checked-only challenge types
(trivia, observation, puzzle, navigation, qr) work end to end; photo and
interaction challenges will work once Phases 4-5 land - the player screen
shows a placeholder for them today instead of crashing.

```
game/
  types.ts     Checkpoint, Team, TeamState, GameEvent, LeaderboardEntry,
               GpsFix, GpsFixResult
  clock.ts     Clock interface + a fake clock for deterministic tests
  geofence.ts  haversine distanceMeters(), checkpointRequiresGps()
  scoring.ts   adjusted time, leaderboard ranking with the 30s tie-break rule
  engine.ts    RaceEngine: startTeam, reportPosition, submitAnswer,
               submitJudgement, skip, manualUnlock, leaderboard,
               publicTeams, progress
lib/
  raceStore.ts   withEngine(): loads state, runs a request, persists it back -
                 Upstash Redis if KV_REST_API_URL/TOKEN are set, else an
                 in-memory fallback for local dev (see Deploying)
  session.ts     the team session cookie name
  teamState.ts   builds the client-safe state payload (never leaks answers
                 or the checkpoint's exact coordinates)
app/
  page.tsx                 landing
  team/login/page.tsx      PIN login
  team/page.tsx            current checkpoint: GPS status while locked,
                            countdown/submit/skip once arrived
  leaderboard/page.tsx     public read-only standings
  api/teams                GET public team list
  api/team/login           POST {teamId, pin} -> sets session cookie, starts clock
  api/team/state           GET current race state for the logged-in team
  api/team/gps             POST {latitude, longitude, accuracyMeters} - geofence check
  api/team/submit          POST {answer} for self-checked challenge types
  api/team/skip            POST skip (only once arrived AND the time cap has passed)
  api/team/logout          POST clears the session cookie
  api/leaderboard          GET public standings
challenges/
  teams.example.json       TEST DATA - 4 example teams with PINs
  deskrace.example.json    TEST DATA - 5 checkpoints, all radiusMeters: 0 (no GPS gate)
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

For a real desk race across four phones on one Wi-Fi network: run
`npm run dev` on your laptop, find its LAN IP (e.g. `ipconfig getifaddr en0`
on macOS), and open `http://<that-ip>:3000` on each phone. Each team logs in
at `/team/login` with their PIN from `challenges/teams.example.json` - that
also starts their race clock. `/leaderboard` is public and needs no login.
With no `KV_REST_API_URL`/`KV_REST_API_TOKEN` set, race state lives in
server memory for this mode - fine for one laptop, reset on restart.

## Deploying (e.g. Vercel)

Serverless hosting runs each request on a possibly-different, possibly-cold
instance, so the in-memory fallback above does not work there - state would
randomly reset or fork between teams. `lib/raceStore.ts` persists to Upstash
Redis instead whenever it's configured:

1. Import this repo as a Vercel project (Vercel dashboard -> Add New ->
   Project -> the `amazing-race-mvp` GitHub repo).
2. In the project's **Storage** tab, create/connect an **Upstash for Redis**
   database. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` into
   the project's environment automatically - no code changes needed.
3. Deploy. Every request now loads the race snapshot from Redis, applies the
   action, and saves it back - see `withEngine()` in `lib/raceStore.ts`.

## Limits of this phase

- **No synchronised staggered start.** The real event has an organiser start
  all teams together (doc §15); here each team's clock starts the moment
  they log in. A "start the race" admin control is Phase 6.
- **Session cookie is not hardened.** It stores the team ID directly after a
  correct PIN check - fine for a friendly one-off event on trusted phones,
  not a security boundary.
- **Redis is one shared key, not a queryable database.** `withEngine()`
  reads and rewrites a single JSON blob per request - fine for a 4x4 pilot,
  but doc §11's fuller Postgres/Supabase model (separate tables for teams,
  events, submissions) is still the right call once photos and an admin
  dashboard need to query history (Phases 4-6).

## What's not built yet

Photo capture, AI judging, the organiser dashboard (manual unlock / override
AI / review queue - `RaceEngine.manualUnlock()` exists and works, there is
just no UI or API route for an organiser to call it yet), and all of
Phase 7-8 hardening and polish. See `docs/CONCEPT.md` §13 for the full phase
list, and §18 for the open decisions (area, checkpoint count, privacy
retention) that need answers before real checkpoints are written.

The checkpoints in `challenges/*.example.json` are all placeholders for
testing. The concept doc's own recommended first move: freeze the real 10
Barcelona checkpoints and walk the loop, phone in hand, checking GPS
accuracy at each one - now that real GPS gating exists, that walk is what
actually proves a fence radius is workable, not just a guess.
