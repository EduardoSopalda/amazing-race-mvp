import { Redis } from "@upstash/redis";
import { RaceEngine } from "@/game/engine";
import type { RaceConfig, SerializedRace, Team } from "@/game/types";
import teamsData from "@/challenges/teams.example.json";
import checkpointsData from "@/challenges/deskrace.example.json";

const RACE_KEY = "barcelona-race:state:v1";

function buildTeamsAndConfig(): { teams: Team[]; config: RaceConfig } {
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
