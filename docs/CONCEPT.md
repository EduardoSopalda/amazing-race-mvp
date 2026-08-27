# Barcelona Race - Concept Proposal

Transcribed from `Barcelona_Race_Concept_Redraft.pdf` (concept proposal, August
2026). This is the source of truth for scope and rules until it is revised.

## 1. At a glance

Four teams of four. One official game phone per team. Ten to twelve
checkpoints on a walkable loop. About 90-150 minutes of racing, plus briefing
and a finish drink.

Game loop: reach a place, GPS unlocks the clue, solve the challenge, submit a
photo or answer, AI or the organiser judges, next checkpoint.

Win condition: lowest adjusted race time. Points are a tie-break and a
live-leaderboard flavour, not a second championship.

What is modern about it: a mobile web app instead of paper clues, server-side
time, geofenced unlocks, AI for routine photo judging, a live organiser
dashboard and map.

What this is not: a claim that no GPS hunt exists in Barcelona. The case for
building is control, custom clues, and a reusable engine - or it is a
learning project (see §8).

**Recommended first move:** do not start by writing the whole application.
Freeze 10 checkpoints and their rules, walk them with a phone, then build the
smallest app that can run that loop on four real devices.

## 2. The idea

Part scavenger hunt, part Amazing Race, part city exploration, delivered
through a mobile web app rather than paper clues and clipboards.

Core principles: simple (one game phone per team), physical (GPS unlocks, it
does not complete), competitive (time/penalties/submissions live on the
server), flexible (photo, trivia, observation, puzzle, search, QR,
interaction), modern not automatic (AI judges routine photos, ambiguous cases
go to a human in one click), fair in a real city (design for urban GPS,
crowds, closed doors).

## 3. How the game works

Pilot size is 4x4; the engine should not hard-code four teams. Each team gets
a name, colour and PIN.

Game phone is the official device: supplies GPS, receives clues, captures
official photos, shows game status. Second phone allowed for maps,
translation, research - not as a second GPS/camera source or to split the
team. Recommendation for the first event: teams stay together.

Server is the official race clock; phones only display it.

Checkpoint flow: reach location -> unlock -> receive clue -> solve challenge
-> submit evidence -> AI or human verification -> result -> next checkpoint.
A skip-with-penalty option stops a team from dying on one puzzle.

## 4. GPS and checkpoint activation

Browser requests location with explicit permission. A checkpoint is a
coordinate plus an activation radius. Recommended first-event radii: 60-80m
in open squares/Eixample, 80-120m in the Gothic Quarter and other urban
canyons.

Smartphone GNSS under open sky is often ~5m; between tall streets commonly
15-50m with occasional wrong-side-of-street fixes. GPS must be one proof
layer, never the only one - combine geofence + photo/QR/answer. Walk every
fence with the same class of phone the teams will use, at the time of day
you will race.

Record on every GPS event: team ID, checkpoint ID, lat, lon, accuracy,
timestamp, whether the fence accepted the fix. If accuracy is worse than the
fence radius, refuse the unlock (or offer an organiser override). Show a
simple GPS status: good / poor / unavailable.

## 5. Photo challenges and AI judging

A vision model evaluates a submitted photo against a written specification
and returns correct / incorrect / ambiguous, a confidence score, a short
reason, and a penalty recommendation.

Traffic-light model: GREEN auto-accept (clearly correct), AMBER organiser
decides (ambiguous / low confidence), RED auto-reject (clearly wrong). AI
never has absolute authority - amber lands on a one-click organiser queue.

Compress photos on device before upload. Store the file against team,
checkpoint, server timestamp and GPS fix at submit time. Strip/ignore EXIF
location after judging.

## 6. Suggested challenge types

| Type | Example | Verification |
|---|---|---|
| Photo | Photograph a red door with a lion's head. | AI vision, amber to organiser |
| Trivia | Find the year a building was inaugurated. | Exact answer / rule |
| Search | Use the second phone to confirm a historical fact visible on site. | Answer, requires presence |
| Puzzle | Solve a puzzle presented at the location. | Answer or organiser |
| Interaction | Find someone wearing a team shirt and take a photo. | AI + human; consent first |
| Observation | How many windows on the second floor of this facade? | Answer; must be on site |
| Navigation | Infer the next location from a riddle. | GPS arrival |
| QR | Find a hidden QR that unlocks the next stage. | QR + GPS |

Research/observation challenges must require presence (not Googleable from
elsewhere). Interaction challenges must never require photographing
unwilling strangers - plant a willing extra if needed.

## 7. Scoring, penalties and timing

Backend is authoritative for race time, checkpoint timestamps, submissions
and penalties.

**Who wins:** primary ranking is lowest adjusted race time.
`adjusted time = (finish clock - start clock) + penalty seconds + skip seconds`.
Correct challenges award +100 points. Points are the tie-break only if two
teams finish within 30 seconds of each other on adjusted time.

- Wrong submission: +120s, team may resubmit.
- Skip / failed challenge after the time cap: +300s, then proceed.
- Challenge time cap: 8 minutes from clue unlock. Clock keeps running either way.
- A wrong attempt costs time only when it is wrong; sitting on a puzzle also
  costs time because the race clock never stops.

Timestamp every important action (GPS reached, clue unlocked, evidence
submitted, AI result, accepted/rejected, next checkpoint) - this is the
dispute log.

## 8. Build versus buy

Barcelona already has GPS treasure hunts (GooseChase, Scavify, HuntHopper,
PlayTours, Let's Roam, local operators). Build a custom app only if at least
two are true: you want full control of scoring/penalties/server clock; you
want Barcelona-specific clues and editable AI criteria; you want a reusable
engine for later cities; you accept this as a learning project and will walk
the route before writing code. Otherwise, configure an existing platform and
spend the effort on the route.

## 9. Anti-cheating and fairness

Official game phone is the only source of GPS/official photo evidence.
Server time is official. GPS accuracy checked before a tight fence opens.
Checkpoint completion requires GPS plus a challenge, not GPS alone. Photos
timestamped and bound to team/checkpoint. Every game event logged. Ambiguous
AI decisions go to the organiser. Second-phone rules briefed before start.
Teams stay together on the first event.

## 10. Live organiser dashboard

Separate admin view: click a team to see last GPS position, accuracy,
current checkpoint, submitted evidence, AI result, penalties, event history.
Live map is useful once the core loop works - not required for the first
code drop. Two unglamorous but essential buttons: **manual unlock** (dead
GPS, courtyard, phone on the blink) and **override AI**.

## 11. Technical architecture

| Layer | Recommendation | Note |
|---|---|---|
| Frontend | Next.js / React PWA | Test on iPhone Safari, not only Android Chrome |
| Hosting | Vercel, Fly.io or equivalent | Needs server routes and environment secrets |
| Backend | Serverless API or small Node/Python service | Authoritative clock and scoring |
| Database | Postgres via Supabase or similar | Teams, events, submissions, penalties |
| Photos | Object storage | Compress on device; short retention |
| AI | Vision-capable API | Structured criteria in, verdict out |
| Maps | Mapbox, Google Maps or OSM | Add after the loop works on four phones |
| Realtime | Supabase Realtime or short polling | Leaderboard and admin map |

Budget: vision-API cost per photo, mobile-data size of uploads, battery
drain from continuous geolocation. Player rule: official phone on a charge
pack, screen awake at checkpoints.

## 12. Project structure and configuration

Challenges are configuration, not code - the organiser should be able to
change locations, clues, time limits, points and AI criteria without
rewriting the application.

```
barcelona-race/
  app/team/        player PWA
  app/admin/       organiser dashboard
  app/api/         scoring, GPS, uploads, AI
  components/      TeamDashboard, Countdown, GPSStatus, CameraCapture, ChallengeCard
  game/            checkpoints, scoring, geofencing, rules
  challenges/      barcelona.json
  README.md
```

Example checkpoint:

```json
{
  "checkpoint": 4,
  "name": "Gothic Quarter",
  "latitude": 41.3839,
  "longitude": 2.1761,
  "radiusMeters": 90,
  "clue": "Find the creature watching over the narrow street.",
  "challengeType": "photo",
  "instruction": "Photograph the gargoyle.",
  "aiCriteria": ["stone gargoyle", "mounted on building", "outdoors"],
  "rewardPoints": 100,
  "wrongPenaltySeconds": 120,
  "skipPenaltySeconds": 300,
  "timeLimitSeconds": 480
}
```

## 13. Build sequence

Build in small, testable increments. Do not ask any coding agent for the
entire application in one prompt.

| Phase | What ships | Done when |
|---|---|---|
| 1 Engine | Teams, PINs, checkpoints, clues, scoring, penalties, server clock | A scripted race can be completed without GPS or photos |
| 2 Player PWA | Login, current checkpoint, countdown, clue, submit answer | Four phones can play a desk race |
| 3 GPS | Permission, live fix, accuracy gate, geofence unlock | A real fence opens and refuses a poor fix |
| 4 Photos | Capture, compress, upload, store, bind to team/checkpoint | A photo survives a flaky connection |
| 5 AI judging | Criteria in, green/amber/red out, organiser queue | A known-good and known-bad photo grade correctly |
| 6 Admin | Leaderboard, review queue, manual unlock, override | You can unstick a team without touching the database |
| 7 Hardening | Poor GPS, duplicates, two teams in one fence, dead phone, offline upload | A walk-through in Barcelona does not need a laptop rescue |
| 8 Polish | Live map, richer challenge types, QR, analytics, visual design | Only after phase 7 |

**This repo currently implements Phase 1 only.**

## 14. Barcelona challenge design (for the real event, not yet done)

Target 10-12 checkpoints, Gothic Quarter plus one adjacent district. Mix: 3
photo/AI, 2 observation, 2 research/trivia (on-site only), 1 QR/hidden-object,
1 puzzle, 1 human interaction (consent built in), 1-2 navigation/riddle.

Operational checklist before locking the JSON: walk the full loop at the
planned time of day and record GPS accuracy at each fence; check pedestrian
access/one-way alleys/shade/stairs/mixed-fitness; check opening hours and
ticket lines; rain plan and heat plan; toilets/water/safe finish point; a
one-page safety brief; stagger starts 3-5 minutes or mirrored routes;
language matches what the group actually speaks.

## 15. Example race experience

A worked example timeline (12:40 briefing through 14:45 published times) -
see the source PDF for the full walkthrough.

## 16. Privacy and data

Likely a corporate afternoon in Spain - live location, photos, timestamps
and metadata are personal data.

- Lawful basis: informed, voluntary consent for a one-off game, briefed
  before PINs are issued.
- Minimise: official game phone only for GPS/official photos, no personal
  phone tracking.
- Purpose limit: location unlocks checkpoints and unsticks teams, not a
  post-event movement profile.
- Photos of people: participant faces need consent to keep/share; strangers
  are not props; no social posts of identifiable people without a separate yes.
- Metadata: do not keep EXIF GPS on stored images after judging.
- Retention: delete location trails and submissions 7-30 days after the
  event unless a dispute is open. Write the number down.
- Processors: hosting/object storage/vision API need a processing agreement
  and an EU-aware region if choosable.
- Access: organiser dashboard authenticated; teams see only their own
  evidence plus the public leaderboard.

Interaction challenges: "find someone in a team shirt" means a teammate or a
pre-briefed host, not a tourist on the Rambla.

## 17. Recommended MVP

4+ teams with PINs; 10 configured checkpoints; GPS geofencing with an
accuracy gate; clue unlocking and an 8-minute challenge cap; photo capture,
compress, upload; AI photo verification with amber organiser queue; 2-minute
wrong-answer penalty and 5-minute skip; server-side race clock and
adjusted-time ranking; live leaderboard; organiser review, manual unlock and
AI override; degraded mode (queued upload, last-known map position,
organiser unlock if the phone dies).

## 18. Decisions before development (still open - answer before Phase 3+)

| Decision | Recommendation for event one |
|---|---|
| Area and max walking distance | Gothic Quarter + one adjacent district, under ~4km |
| Number of checkpoints | 10 (12 only if the walk test is easy) |
| Total race duration | 90-150 min plus briefing and finish |
| Second phone | Maps, translation, on-site research. Not official GPS or photos |
| May teams split? | No |
| Scoring | Lowest adjusted time, points as tie-break |
| Must every stop be a photo? | No, mix the types |
| How automatic is AI? | Green/red automatic, amber always human |
| Live map for organiser? | Yes once phase 6 is stable, not in the first code drop |
| Dead phone / no GPS / no signal | Organiser unlock + queued upload + spare power bank |
| Privacy retention | Delete trails and photos within 30 days |
| Start method | Stagger teams 3-5 minutes apart |
| Course close | A hard end time so the finish drink still happens |

## 19. Bottom line

Strongest version: a mobile web game with a real backend where GPS decides
when a checkpoint may unlock, the challenge is the gameplay, photographs are
evidence, AI handles routine visual judging, and an organiser dashboard
keeps a human in charge - plus the unromantic pieces: skip rules, manual
overrides, a walked route, and a privacy limit on how long you keep anyone's
afternoon.

**Next step:** define the first 10 Barcelona checkpoints and their challenge
rules, walk the loop, use that JSON as test data while the MVP is built
through phases 1-7. Software follows the course.
