# Barcelona Race

A GPS-based team-building race: teams walk Barcelona, unlock clues on arrival,
submit evidence, and compete on a server clock. Original engineering spec in
`docs/CONCEPT.md`. The actual event script - written by Gab, full text in
`docs/BARCELONA-SCRIPT.md` - is adapted into `challenges/barcelona-route.json`;
see **The real route** below for what changed in that adaptation.

## Status: player visual skin, on top of Phase 7 hardening and the real route

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

- **Phase 7 (started):** hardening for "a walk-through in Barcelona doesn't
  need a laptop rescue" (doc §13). Every player submission (`submit`,
  `skip`, and especially `photo` - the largest, slowest payload) now
  retries automatically on a network failure or 5xx, with backoff, up to 3
  attempts. A photo that still fails after that isn't lost or force a
  retake: it's kept client-side and a "Retry upload" button resends the
  exact same compressed image once signal returns. A 4xx (bad request,
  wrong checkpoint type) fails immediately instead of retrying, since
  retrying a request the server already understood and rejected wastes
  time without changing the outcome. Verified with Playwright simulating a
  dropped connection: an upload that fails twice then succeeds never shows
  the retry button (silent auto-recovery); one that fails all three
  attempts shows it, preserves the photo, and a manual retry after
  "signal returns" completes normally.

  On top of that: retrying only helps if a retry can't double-count. Every
  `submit`/`skip`/`photo` call now carries a client-generated
  `idempotencyKey` (one `crypto.randomUUID()` per logical attempt, reused
  across that attempt's automatic retries and, for photos, its manual
  "Retry upload" too). The server caches the last submission per team by
  that key: a retry of a request that actually landed - the response was
  just lost in transit - replays the original result instead of
  re-scoring, double-advancing, or (for photos) paying for a second AI
  judging call. A genuinely new attempt always carries a fresh key, so it
  is never mistaken for a duplicate. This specifically covers the case
  that matters most and is easy to get wrong: a submission that *advances
  or finishes the checkpoint* before its response is lost, where the
  team's "current checkpoint" has already moved on by the time the retry
  arrives - covered by both a unit test and a live Playwright check (see
  below). Concurrent overlapping requests, as opposed to sequential
  retries, can still both miss the cache before either has written it -
  not fixed here, and unlikely to matter for four teams on one event.

  Verified two ways: `tests/engine.test.ts` covers submitAnswer,
  submitJudgement, and skip replaying a cached result instead of
  re-applying penalties/points, including the specific "the submission
  that finished the race gets retried" case. Live, with the AI judging
  call stubbed to log every real invocation: a Playwright run let a photo
  submission actually reach and finish on the server, then used
  `route.fetch()` + `route.abort()` to simulate the client losing that
  response before the real client-side retry fired - the server log
  showed exactly one AI judging call despite two requests reaching it, and
  the team finished with 600 points, not 700.

Still not built: the rest of Phase 7 (GPS drift mitigation, poor-signal
detection during GPS reporting itself, concurrent-request dedup) and
Phase 8 polish (a live map, richer challenge types, course close). See
"What's not built yet" below for exactly what that leaves unautomated on
the real route.

## Player visual skin: the Gab Lab race dossier

The site runs the **gab-lab-final** design pack's "locked direction" -
a black/paper/yellow "race dossier" identity (Bebas Neue display,
Fraunces serif clue text, IBM Plex Mono telemetry) across `/`,
`/team/login`, and `/team`, replacing an earlier "torn route envelope"
skin entirely (see git history if you need it - it's gone from the
working tree, not layered underneath). `/admin` and `/leaderboard` are
still the original plain dark UI, untouched, on purpose.

**Shape.** `/team` uses `.rig` - a CSS grid with an 18px team-colour
`.rail` down the left edge, then `.tele` (telemetry header: `GAB LAB /
BARCELONA`, a live-status word, `TEAM {name}`, a big yellow race/
countdown clock, coordinates + points/checkpoint), `.stage` (a `.dossier`
paper card or a full-panel `.verdict`), and `.thumb` (one yellow
`button.go` + a muted `.skip` link). `/` and `/team/login` use the
simpler `.phone` flex shell instead - no rail, since no team is
confirmed yet at either point.

**Behaviour, not just restyle.** Every outcome still funnels through one
`Verdict` object (`kind: cleared|rejected|hold`, `heading`, `text`,
`cta`, `onCta`) rendered as a full-panel takeover - same pattern as the
previous skin, carried over because it earned its place. New this time:
a **`review` state** while a photo is mid-upload/mid-AI-judging
(`photoBusy`) - the dossier card itself says "PHOTO UNDER REVIEW" with a
disabled "UNDER REVIEW" button, instead of just swapping button label
text. `postJsonWithRetry`, the geolocation watch effect, `compressImage`,
and every `idempotencyKey` call site are untouched, same as always.

**Audio.** `lib/audioRace.ts` - ported from the pack's own inline script
- synthesizes six SFX (unlock, review, verified, rejected, skip, locked)
via raw Web Audio oscillators, no audio files. Wired to the real
events: GPS acceptance, a photo entering review, a correct/wrong verdict,
a skip tap. `boot()` runs on the first tap anywhere (a global click
listener) since starting an `AudioContext` requires a user gesture; muted
state persists to `localStorage` (a per-viewer UI preference, not race
state, so it doesn't belong on the server) and defaults to unmuted unless
`prefers-reduced-motion` is set. A real, permanent mute toggle sits in
the telemetry header - the pack's own `.dock` mute button was
prototype-only chrome, per its own README ("do not ship the prototype
`.dock`").

**Not in the pack, built here, same lesson as last time:** the self-
checked text-answer state (5 of 6 desk-route checkpoints; the pack only
ever demoed the photo flow) - a `.dossier` card with `.field` +
`input[type="text"]`, same real markup principle as before.

**Fonts** are self-hosted via `next/font/google` (Bebas Neue, Fraunces,
IBM Plex Mono) in `app/layout.tsx`, not the pack's own Google Fonts
`<link>` tags - no external request, no flash of unstyled text.

**Logo.** The pack shipped `logo-gablab.jpg` on an opaque white
background; rendered as designed, that's a visible white box floating on
the black UI. Reused the transparent PNG/WebP from the earlier skin
instead (same artwork) - same intent as "do not restyle the mark," just
without shipping a background that clearly wasn't the point.

The pack's own instruction was explicit - "the colorful mark is the
event logo, the UI stays black/cream/yellow, do not restyle the mark" -
and at first that's exactly what shipped: the full-size, full-saturation
logo sitting directly on the flat dossier card. Live, on a real phone, it
read as two different things sharing a screen - a glossy photorealistic
game-cover graphic stacked on a flat monospace field-ops interface - not
one identity. Following the brief correctly isn't the same as it working
once you actually see it at size, and this didn't.

Reworked into `.logo-frame`: a dark bordered card with the same corner
marks as `.dossier`/`.brief`, holding a smaller (`min(230px, 68%)`,
down from `min(320px, 86%)`), desaturated and darkened version of the
same artwork (`saturate(.72) brightness(.92) contrast(1.05)`, plus a
drop-shadow) - the mark itself is untouched, only how it's presented.
It now reads as a sealed badge that's part of the dossier system, not a
sticker pasted on top of it. Verified on `/` and `/team/login` at a
normal and a short (375x667) viewport - the smaller logo actually helped
the short-viewport case, leaving more room before the button.

Two real bugs, found by rendering the actual pack files and the real app
with real data, not by reading the CSS - plus one thing worth naming that
this pack got *right* where the previous one didn't:

- **The standalone dossier prototype already used `height:100dvh` +
  `minmax(0,1fr)` correctly** - unlike the previous pack, it didn't
  reproduce the earlier grid-blowout bug, and `dossier.css` already
  carried everything the dossier card needed (no `.preview`/`.pin input`
  -style gap this time). Confirmed by rendering it directly before
  touching any code, at both a normal and a short (375x667) viewport, not
  assumed from the CSS alone.
- **An anchor's underline bled through a `display:grid` button even with
  `text-decoration:none` on the button itself.** `next/link`'s `<a>`
  wraps `button.ghost` ("View leaderboard"); once `.ghost` was set to
  `display:grid` to center its text, Chromium still painted the ancestor
  anchor's UA-default underline through it - only a genuinely
  atomic-inline box (the UA default for `<button>`) blocks that, and
  `display:grid` isn't one. `text-decoration:none` on the *button* is
  therefore not sufficient; fixed on the anchor instead
  (`.actions a { text-decoration: none; display: block; }`), confirmed
  by reading the button's own `getComputedStyle` (already correct) before
  finding the real cause elsewhere.
- **Field labels and checkpoint place names rendered in whatever case the
  source data happened to use**, not the pack's own all-caps convention -
  `.place`, `.dossier .field label`, and `.brief .field label` were
  missing `text-transform: uppercase`. A cosmetic gap the mock's own
  hardcoded all-caps strings never exposed. Added to all three.

Verified live end to end via Playwright against the real desk-race route
with the AI judging call stubbed: landing → login → all 6 checkpoints
(wrong → rejected → resubmit → correct → cleared, through to the photo
checkpoint), the `review` pending state specifically (captured by
delaying the `/api/team/photo` response so it isn't raced past locally),
finish, leaderboard, and `/admin` - at 390x844 and a short 375x667
viewport. `/admin` and `/leaderboard` confirmed unchanged (the same
pre-existing, unrelated "seconds" input truncation noted before is still
there, still not this patch's to fix).

Two calls made without stopping to ask, both reversible and consistent
with the calls made on the previous skin:

- **Organiser-queue copy stays softened** ("no penalty - try a clearer
  photo, or an organiser can step in") for the ambiguous-photo `hold`
  verdict - still no real cross-team queue (see "What's not built yet").
- **Team Red's rail colour (`#e94b5f`) left as-is**, same reasoning as
  before - the verdict heading text carries the meaning regardless of
  colour.

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
to work through), and a "start the race" button for a synchronised
staggered start.

What Phase 7 still needs beyond the retry/backoff hardening and
per-submission dedup already done: a **true offline queue** - the current
retry logic covers a connection that comes back within a few seconds
(three attempts, a few hundred ms to a few seconds apart); it does not
queue a submission while the phone has *no* signal at all for longer than
that, or survive a page reload/app close mid-upload. Also: a genuine
*double-tap* (two clicks of the same button, not a network retry) is still
only prevented client-side, by disabling the button while `busy` - the
idempotency key covers the server retrying the same logical request, not
two independent requests each with their own key; concurrent overlapping
requests can still both miss the server-side cache before either has
written it. And GPS drift/poor-signal detection beyond the existing
accuracy gate.

Also still missing: branching Detours (a real choice between two
challenges), multi-photo checkpoints (submit several photos as one gated
step), cross-team bonuses (best photo, completion order - need comparing
teams against each other, which the engine doesn't do), and video
submissions (AI judging is photo-only right now). See "The real route"
above for exactly which stops that affects today, and `docs/CONCEPT.md`
§13 for the original phase list.

`challenges/deskrace.example.json` and `barcelona.example.json` remain test
placeholders. `challenges/barcelona-route.json` is the real event route -
walk it once with a phone before game day (doc §1's own advice) to confirm
each `radiusMeters` fence actually works at that spot; that walk is also
the natural time to test the photo challenges on-site and decide whether
any of the simplifications above need a second look.
