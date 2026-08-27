# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Original engineering spec in
`docs/CONCEPT.md`. The actual event script - written by Gab, full text in
`docs/BARCELONA-SCRIPT.md` - is adapted into `challenges/barcelona-route.json`;
see **The real route** below for what changed in that adaptation.

## Status: Phase 6 - organiser dashboard, on top of the real route

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
  instead of auto-penalising"). The dashboard below can now override any of
  these three - see "Override AI" under Organiser dashboard.

The desk-race checkpoints (`challenges/deskrace.example.json`) still use
`radiusMeters: 0` (no GPS gate), so Phases 1-3 remain fully desk-testable.
Checkpoint 6 is now a real `photo` checkpoint ("photograph a coffee cup or
mug") so the whole photo pipeline is testable today without traveling
anywhere.

- **Phase 6 (done, minimal):** an organiser dashboard at `/admin` - live
  status for all four teams (current checkpoint, arrived/GPS-pending,
  penalties, points), a manual-unlock button for a team stuck on a bad GPS
  fix or a closed location, penalty buttons matching Gab's own rule table
  (minor/skipped/cheating, or a custom amount + reason), and an AI-override
  panel that shows the last photo submitted on a team's current checkpoint
  (the image itself, when Blob is connected) alongside the AI's verdict and
  reasoning, with buttons to force it correct or incorrect. Password-gated
  by an `ORGANISER_KEY` env var - see "Organiser dashboard" below.

Still not built: Phase 7-8 hardening/polish (a live map, an offline upload
queue, duplicate-fix handling, course close). See "What's not built yet"
below for exactly what that leaves unautomated on the real route.

## The real route

`challenges/barcelona-route.json` (paired with `challenges/teams.barcelona.json`)
is the actual event, adapted from Gab's script - 12 stops, real GPS
coordinates, a Roadblock, a Detour, a per-team Secret Mission, and a final
memory challenge. Switch to it with an env var, without touching code:

```
RACE_ROUTE=barcelona npm run dev     # local
```

or set `RACE_ROUTE=barcelona` in Vercel's Environment Variables for the real
event, and leave it unset everywhere else - it defaults to the desk-race, so
nothing about the currently-deployed site changes until this is deliberately
flipped. State is keyed separately per route, so flipping back and forth
never mixes desk-test progress with real-event progress.

**Two new engine features exist because the real script needed them:**
- `Checkpoint.teamOverrides` - a checkpoint's clue/instruction/criteria can
  differ per team id. Used for the Secret Mission (checkpoint 11), where
  each of the four colours gets a genuinely different task.
- `RaceEngine.applyPenalty(teamId, seconds, reason)` - a host-applied time
  penalty for a rule violation (not a wrong submission). Matches Gab's own
  penalty table (page 6 of the script): minor +2min, skipped requirement
  +5min, deliberate cheating +10min. No admin UI calls this yet - it's an
  engine hook, callable directly if you need it before Phase 6 exists.

**What was simplified from the original script, and why** (each is also
called out in that checkpoint's own `_note` field in the JSON):

| Stop | Original | Simplified to |
|---|---|---|
| 1 - Arc de Triomf | Best photo across all 4 teams gets a 3-min head start | Photo still judged pass/fail; the cross-team "best" comparison isn't automated - a host has to eyeball all four and award it manually if you want to keep it |
| 4 - Lost in Barcelona | 6 separate required photos; 1st/2nd/3rd/4th completion-order bonus | 1 combined photo with the most iconic elements; completion-order bonus dropped (needs live cross-team timing) |
| 5 - Roadblock | Video proof of the team saying a learned Catalan phrase | Photo of the team with the stranger who taught them - proves they found someone, doesn't verify the phrase. Real verification is a host judgement call, in person |
| 7 - Chocolate challenge | Video of the blindfolded hands-free feeding | Photo of the moment - a weaker check than video; lean on host judgement if it looks off |
| 9 - Detour | A real choice between Brains (5 trivia questions) and Balls (30 football touches on video) | Fixed to one Brains question - the app has no branching-choice mechanic yet. A team that wants to do Balls instead can have a host verify it in person and call `manualUnlock()` for them |

Everything else (stops 2, 3, 6, 8, 10, the BARCINO trivia stop, the Secret
Mission, and the Final Memory Challenge) matches the script directly,
including its own specific penalty numbers where it gave one (BARCINO's
2-minute wrong-answer wait, the Final Memory Challenge's 60-second one).

**Before game day:** change the PINs in `challenges/teams.barcelona.json`
(currently copied from the desk-race placeholders), and walk the real route
once with a phone to confirm each `radiusMeters` fence and GPS accuracy
actually work at that spot - doc §1's own advice, and now there's a real
mechanism to test it against instead of a guess.

## Organiser dashboard

Set an `ORGANISER_KEY` env var (any password you choose - locally in
`.env.local`, on Vercel in Environment Variables), then open `/admin/login`.
With no `ORGANISER_KEY` set, `/admin/login` refuses every attempt outright
rather than defaulting open.

Once logged in, `/admin` polls every 4 seconds and shows, per team: whether
they've started, their current checkpoint and challenge type, whether GPS
has confirmed arrival yet, penalties/skips/points, and (once finished) their
adjusted time. Three actions:

- **Manually unlock current checkpoint** - for a team stuck on a bad GPS fix
  or a closed/inaccessible location (doc §9/§10). Disabled once already
  arrived. Calls `RaceEngine.manualUnlock()`.
- **Apply penalty** - Gab's own rule-table presets (minor +2min, skipped
  +5min, deliberate cheating +10min) plus a custom seconds+reason field.
  Calls `RaceEngine.applyPenalty()`, which requires a reason and rejects
  negative values.
- **Override AI** - once a team has submitted a photo/interaction
  challenge, the dashboard shows that submission (the photo itself if Blob
  is connected, otherwise just the AI's verdict and reasoning) with two
  buttons: force it correct (advances the team, awards points) or incorrect
  (applies the normal wrong-answer penalty, lets them retry). This is the
  literal "override AI" doc §13 lists for Phase 6 - it works on green/red/
  amber verdicts alike, calling the same `RaceEngine.submitJudgement()`
  path a team's own submission uses, just with `reason: "Organiser
  override"`. Only shown for the team's *current* checkpoint - once they've
  moved on, the button for the old one disappears.

This is deliberately minimal (doc §13's own bar for Phase 6: "you can
unstick a team without touching the database") - no live map, no queued
review list of every ambiguous case across all teams, no synchronised start
button. See "What's not built yet".

```
game/
  types.ts     Checkpoint, Team, TeamState, GameEvent, LeaderboardEntry,
               GpsFix, GpsFixResult, Verdict (correct/incorrect/ambiguous)
  clock.ts     Clock interface + a fake clock for deterministic tests
  geofence.ts  haversine distanceMeters(), checkpointRequiresGps()
  scoring.ts   adjusted time, leaderboard ranking with the 30s tie-break rule
  engine.ts    RaceEngine: startTeam, reportPosition, submitAnswer,
               submitJudgement (correct/incorrect/ambiguous), skip,
               manualUnlock, applyPenalty, leaderboard, publicTeams, progress
lib/
  raceStore.ts   withEngine(): loads state, runs a request, persists it back -
                 Upstash Redis if KV_REST_API_URL/TOKEN are set, else an
                 in-memory fallback for local dev (see Deploying). Also
                 picks desk-race vs. real route based on RACE_ROUTE.
  session.ts     the team session cookie name
  teamState.ts   builds the client-safe state payload (never leaks answers,
                 aiCriteria, or the checkpoint's exact coordinates)
  anthropic.ts   Anthropic client singleton (reads ANTHROPIC_API_KEY)
  photoJudge.ts  judgePhoto(): vision call + structured output (zod) ->
                 {verdict, confidence, reason}
  blobStore.ts   uploadPhoto(): Vercel Blob, or null when unconfigured
  adminAuth.ts   the organiser cookie name + isValidAdminCookie() (checked
                 against ORGANISER_KEY on every admin request)
  adminState.ts  buildAdminSnapshot(): per-team status for the dashboard,
                 including each team's last GPS event and last AI judgement
app/
  page.tsx                 landing
  team/login/page.tsx      PIN login
  team/page.tsx            current checkpoint: GPS status while locked,
                            countdown/submit/skip once arrived, camera
                            capture for photo/interaction checkpoints
  leaderboard/page.tsx     public read-only standings
  admin/login/page.tsx     organiser password login
  admin/page.tsx           organiser dashboard - see "Organiser dashboard"
  api/teams                GET public team list
  api/team/login           POST {teamId, pin} -> sets session cookie, starts clock
  api/team/state           GET current race state for the logged-in team
  api/team/gps             POST {latitude, longitude, accuracyMeters} - geofence check
  api/team/submit          POST {answer} for self-checked challenge types
  api/team/photo           POST {imageBase64, mediaType} - AI-judged challenges
  api/team/skip             POST skip (only once arrived AND the time cap has passed)
  api/team/logout          POST clears the session cookie
  api/leaderboard          GET public standings
  api/admin/login          POST {password} -> sets organiser session cookie
  api/admin/logout         POST clears the organiser session cookie
  api/admin/teams          GET status of every team (organiser only)
  api/admin/unlock         POST {teamId} -> RaceEngine.manualUnlock()
  api/admin/penalty        POST {teamId, seconds, reason} -> RaceEngine.applyPenalty()
  api/admin/override       POST {teamId, verdict} -> RaceEngine.submitJudgement()
                            with reason "Organiser override"
challenges/
  teams.example.json       TEST DATA - 4 example teams with PINs (desk-race)
  deskrace.example.json    TEST DATA - 6 checkpoints: 5 self-checked
                            (radiusMeters: 0), 1 photo (also radiusMeters: 0)
  teams.barcelona.json     REAL EVENT teams - same 4 colours, change the PINs
  barcelona-route.json     REAL EVENT route - 12 stops adapted from Gab's
                            script, see "The real route" above
  barcelona.example.json   TEST DATA from Phase 1 - superseded by
                            barcelona-route.json, kept for reference
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
but not durably stored (`photoUrl: null` in the response). Set
`ORGANISER_KEY` in `.env.local` too if you want to try the dashboard at
`/admin/login` locally - any password you choose.

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
5. Add `ORGANISER_KEY` (any password) so `/admin/login` works - see
   "Organiser dashboard" above.
6. When you're ready for the real event (not before), add `RACE_ROUTE` =
   `barcelona` to switch off the desk-race data - see "The real route" above.
7. Deploy (or redeploy after adding the env vars above).

## Limits of this phase

- **No organiser queue for ambiguous photos.** Doc §5/§9 says amber cases go
  to a human. "Ambiguous" still just applies no penalty and lets the team
  retake the photo, rather than landing in a queue for you to resolve on the
  dashboard - a reasonable stand-in for a 4x4 pilot, but not the real design.
- **No synchronised staggered start.** The real event has an organiser start
  all teams together (doc §15); here each team's clock starts the moment
  they log in. The dashboard has no "start the race" button.
- **Admin session is as lightly secured as the team one.** The organiser
  cookie holds `ORGANISER_KEY` itself - fine for a friendly one-off event
  where only you have the password, not a security boundary against someone
  who obtains it.
- **Session cookie is not hardened.** Same caveat for teams: it stores the
  team ID directly after a correct PIN check.
- **Redis is one shared key, not a queryable database.** `withEngine()`
  reads and rewrites a single JSON blob per request - fine for a 4x4 pilot
  and for the dashboard's live-status view, but doc §11's fuller
  Postgres/Supabase model (separate tables for teams, events, submissions)
  would be needed for a real queryable history or a live map.
- **AI judging cost.** Each photo submission is one `claude-opus-5` vision
  call. Budget for it (doc §11 flags this explicitly) - a lower-cost model
  is a reasonable swap in `lib/photoJudge.ts` if per-photo cost matters more
  than judging accuracy for your event; that's a call for whoever runs the
  event, not one made silently here.

## What's not built yet

Beyond the minimal dashboard: a live map, a review *queue* (today you can
override the current checkpoint for a team you're already looking at, but
there's no single list of every ambiguous submission across all four teams
to work through), a "start the race" button for a synchronised staggered
start, and Phase 7-8 hardening (offline upload queue, duplicate-fix
handling, course close). Also still missing: branching Detours (a real
choice between two challenges), multi-photo checkpoints (submit several
photos as one gated step), cross-team bonuses (best photo, completion order
- need comparing teams against each other, which the engine doesn't do),
and video submissions (AI judging is photo-only right now). See "The real
route" above for exactly which stops that affects today, and
`docs/CONCEPT.md` §13 for the original phase list.

`challenges/deskrace.example.json` and `barcelona.example.json` remain test
placeholders. `challenges/barcelona-route.json` is the real event route -
walk it once with a phone before game day (doc §1's own advice) to confirm
each `radiusMeters` fence actually works at that spot; that walk is also
the natural time to test the photo challenges on-site and decide whether
any of the simplifications above need a second look.
