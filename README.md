# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Concept and full spec in
`docs/CONCEPT.md`.

## Status: Phase 4/5 - Photo capture and AI judging

Per the build sequence in the concept doc (§13):

- **Phase 1 (done):** the race engine - teams, PINs, checkpoints, scoring,
  penalties, a server-authoritative clock. `tests/engine.test.ts` runs a
  scripted two-team race with no GPS or photos.
- **Phase 2 (done):** a Next.js player PWA on top of that engine - team
  login by PIN, the current checkpoint's clue and countdown, submitting a
  text answer, skipping after the time cap, and a minimal read-only
  leaderboard.
- **Phase 3 (done):** real GPS geofencing (doc §4). A checkpoint with a
  `radiusMeters > 0` stays locked until the player's phone reports a
  position inside that fence - accuracy is checked before distance, so a
  weak fix is refused outright even standing on the spot. Verified with real
  haversine coordinates and real browser geolocation via Playwright.
- **Phase 4/5 (done, built together):** photo capture, upload, and AI
  judging (doc §5). The player takes a photo (`capture="environment"` opens
  the phone camera directly); it's compressed and stripped of EXIF on-device
  by redrawing onto a canvas before upload. A durable copy goes to Vercel
  Blob (best-effort - degrades to judging-only if no Blob store is
  connected). Claude (vision, `claude-opus-5`) grades it against the
  checkpoint's `aiCriteria` and returns a structured verdict - green
  (`correct`) advances and awards points, red (`incorrect`) applies the
  normal wrong-answer penalty and allows resubmission, amber (`ambiguous`)
  applies **no penalty** and lets the team retake the photo (doc §9: "AI
  never has absolute authority" / "ambiguous decisions go to the organiser
  instead of auto-penalising" - with no admin queue built yet, this is the
  honest stand-in until Phase 6 adds one).

The desk-race checkpoints (`challenges/deskrace.example.json`) still use
`radiusMeters: 0` (no GPS gate), so Phases 1-3 remain fully desk-testable.
Checkpoint 6 is now a real `photo` checkpoint ("photograph a coffee cup or
mug") so the whole photo pipeline is testable today without traveling
anywhere.

Still not built: the organiser dashboard (Phase 6 - manual unlock, override
AI, a review queue for genuinely stuck ambiguous cases), and Phase 7-8
hardening/polish. `RaceEngine.manualUnlock()` already exists and works;
there's just no admin UI or API route calling it yet.

```
game/
  types.ts     Checkpoint, Team, TeamState, GameEvent, LeaderboardEntry,
               GpsFix, GpsFixResult, Verdict (correct/incorrect/ambiguous)
  clock.ts     Clock interface + a fake clock for deterministic tests
  geofence.ts  haversine distanceMeters(), checkpointRequiresGps()
  scoring.ts   adjusted time, leaderboard ranking with the 30s tie-break rule
  engine.ts    RaceEngine: startTeam, reportPosition, submitAnswer,
               submitJudgement (correct/incorrect/ambiguous), skip,
               manualUnlock, leaderboard, publicTeams, progress
lib/
  raceStore.ts   withEngine(): loads state, runs a request, persists it back -
                 Upstash Redis if KV_REST_API_URL/TOKEN are set, else an
                 in-memory fallback for local dev (see Deploying)
  session.ts     the team session cookie name
  teamState.ts   builds the client-safe state payload (never leaks answers,
                 aiCriteria, or the checkpoint's exact coordinates)
  anthropic.ts   Anthropic client singleton (reads ANTHROPIC_API_KEY)
  photoJudge.ts  judgePhoto(): vision call + structured output (zod) ->
                 {verdict, confidence, reason}
  blobStore.ts   uploadPhoto(): Vercel Blob, or null when unconfigured
app/
  page.tsx                 landing
  team/login/page.tsx      PIN login
  team/page.tsx            current checkpoint: GPS status while locked,
                            countdown/submit/skip once arrived, camera
                            capture for photo/interaction checkpoints
  leaderboard/page.tsx     public read-only standings
  api/teams                GET public team list
  api/team/login           POST {teamId, pin} -> sets session cookie, starts clock
  api/team/state           GET current race state for the logged-in team
  api/team/gps             POST {latitude, longitude, accuracyMeters} - geofence check
  api/team/submit          POST {answer} for self-checked challenge types
  api/team/photo           POST {imageBase64, mediaType} - AI-judged challenges
  api/team/skip             POST skip (only once arrived AND the time cap has passed)
  api/team/logout          POST clears the session cookie
  api/leaderboard          GET public standings
challenges/
  teams.example.json       TEST DATA - 4 example teams with PINs
  deskrace.example.json    TEST DATA - 6 checkpoints: 5 self-checked
                            (radiusMeters: 0), 1 photo (also radiusMeters: 0)
  barcelona.example.json   TEST DATA from Phase 1 - real coordinates, not
                            wired into the default desk-race config
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

For local photo judging you need `ANTHROPIC_API_KEY` set (get one at
[console.anthropic.com](https://console.anthropic.com)) - add it to
`.env.local` (gitignored). Without it, self-checked and GPS checkpoints
still work; the photo checkpoint's AI call will fail with a clear error.
`BLOB_READ_WRITE_TOKEN` is optional locally - without it, photos are judged
but not durably stored (`photoUrl: null` in the response).

For a real desk race across four phones on one Wi-Fi network: run
`npm run dev` on your laptop, find its LAN IP (e.g. `ipconfig getifaddr en0`
on macOS), and open `http://<that-ip>:3000` on each phone. Each team logs in
at `/team/login` with their PIN from `challenges/teams.example.json` - that
also starts their race clock. `/leaderboard` is public and needs no login.

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
3. In **Settings -> Environment Variables**, add `ANTHROPIC_API_KEY` (from
   console.anthropic.com) so photo checkpoints can be judged.
4. Optionally, in **Storage**, create/connect a **Blob** store too, so
   judged photos are kept for the dispute record - Vercel injects
   `BLOB_READ_WRITE_TOKEN` automatically. Without it, photos are still
   judged, just not stored.
5. Deploy (or redeploy after adding the env vars above).

## Limits of this phase

- **No organiser queue for ambiguous photos.** Doc §5/§9 says amber cases go
  to a human. With no admin dashboard yet, "ambiguous" instead applies no
  penalty and lets the team retake the photo - a reasonable stand-in for a
  4x4 pilot, but not the real design. `RaceEngine.manualUnlock()` is ready
  for Phase 6 to build a real queue on top of.
- **No synchronised staggered start.** The real event has an organiser start
  all teams together (doc §15); here each team's clock starts the moment
  they log in. A "start the race" admin control is Phase 6.
- **Session cookie is not hardened.** It stores the team ID directly after a
  correct PIN check - fine for a friendly one-off event on trusted phones,
  not a security boundary.
- **Redis is one shared key, not a queryable database.** `withEngine()`
  reads and rewrites a single JSON blob per request - fine for a 4x4 pilot,
  but doc §11's fuller Postgres/Supabase model (separate tables for teams,
  events, submissions) is still the right call once an admin dashboard
  needs to query history (Phase 6).
- **AI judging cost.** Each photo submission is one `claude-opus-5` vision
  call. Budget for it (doc §11 flags this explicitly) - a lower-cost model
  is a reasonable swap in `lib/photoJudge.ts` if per-photo cost matters more
  than judging accuracy for your event; that's a call for whoever runs the
  event, not one made silently here.

## What's not built yet

The organiser dashboard (Phase 6 - live map, leaderboard review queue,
manual unlock, override AI - the engine methods exist, the UI doesn't), and
Phase 7-8 hardening/polish (offline upload queue, duplicate-fix handling,
course close, etc). See `docs/CONCEPT.md` §13 for the full phase list, and
§18 for the open decisions (area, checkpoint count, privacy retention) that
need answers before real Barcelona checkpoints are written.

The checkpoints in `challenges/*.example.json` are all placeholders for
testing. The concept doc's own recommended first move: freeze the real 10
Barcelona checkpoints and walk the loop, phone in hand, checking GPS
accuracy at each one and testing the photo challenges on-site - now that
real GPS gating and AI judging both exist, that walk is what actually
proves the checkpoints work, not a guess.
