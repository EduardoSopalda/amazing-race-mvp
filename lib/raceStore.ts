import { Redis } from "@upstash/redis";
import { RaceEngine } from "@/game/engine";
import type { RaceConfig, SerializedRace, Team } from "@/game/types";
import deskTeamsData from "@/challenges/teams.example.json";
import deskCheckpointsData from "@/challenges/deskrace.example.json";
import barcelonaTeamsData from "@/challenges/teams.barcelona.json";
import barcelonaCheckpointsData from "@/challenges/barcelona-route.json";

// Which route is live is a deploy-time switch, not a code change: set
// RACE_ROUTE=barcelona (env var, e.g. in Vercel's Environment Variables) for
// the real event; leave it unset for the desk-race test data. Defaults to
// desk-race so nothing about the currently-deployed site changes until this
// is deliberately flipped for game day.
const ROUTE = process.env.RACE_ROUTE === "barcelona" ? "barcelona" : "deskrace";

function buildTeamsAndConfig(): { teams: Team[]; config: RaceConfig } {
  const teamsData = ROUTE === "barcelona" ? barcelonaTeamsData : deskTeamsData;
  const checkpointsData = ROUTE === "barcelona" ? barcelonaCheckpointsData : deskCheckpointsData;
  const teams = teamsData.teams as Team[];
  const config: RaceConfig = { checkpoints: checkpointsData.checkpoints as RaceConfig["checkpoints"] };
  return { teams, config };
}

// On Vercel, each request can land on a different serverless instance with
// its own empty memory - a module-level singleton doesn't survive that. So
// state is persisted to Upstash Redis (connected via Vercel's Storage tab,
// which injects KV_REST_API_URL / KV_REST_API_TOKEN) and every request
// builds a fresh engine, restores the last snapshot, and saves it back.
//
// Locally, with no KV env vars set, this falls back to the old in-memory
// singleton behaviour from Phase 2 - `npm run dev` still needs no setup.
let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  redis = url && token ? new Redis({ url, token }) : null;
  return redis;
}

declare global {
  // eslint-disable-next-line no-var
  var __barcelonaRaceMemory: SerializedRace | undefined;
}

// Keyed by route so flipping RACE_ROUTE never mixes desk-test state with
// real-event state, even against the same Redis store.
const RACE_KEY = `barcelona-race:state:v1:${ROUTE}`;

async function loadSnapshot(): Promise<SerializedRace | null> {
  const kv = getRedis();
  if (kv) return (await kv.get<SerializedRace>(RACE_KEY)) ?? null;
  return globalThis.__barcelonaRaceMemory ?? null;
}

async function saveSnapshot(snapshot: SerializedRace): Promise<void> {
  const kv = getRedis();
  if (kv) {
    await kv.set(RACE_KEY, snapshot);
    return;
  }
  globalThis.__barcelonaRaceMemory = snapshot;
}

/**
 * Loads the race, hands it to `fn`, then persists whatever `fn` did before
 * returning its result. Every route handler goes through this instead of
 * holding an engine reference across requests.
 */
export async function withEngine<T>(fn: (engine: RaceEngine) => T | Promise<T>): Promise<T> {
  const { teams, config } = buildTeamsAndConfig();
  const engine = new RaceEngine(config, teams);

  const snapshot = await loadSnapshot();
  if (snapshot) engine.restore(snapshot);

  const result = await fn(engine);

  await saveSnapshot(engine.serialize());
  return result;
}
