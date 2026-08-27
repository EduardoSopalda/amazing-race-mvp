import { RaceEngine } from "@/game/engine";
import type { RaceConfig, Team } from "@/game/types";
import teamsData from "@/challenges/teams.example.json";
import checkpointsData from "@/challenges/deskrace.example.json";

// A single in-process, in-memory race for the whole server. This is enough
// for Phase 2 ("four phones can play a desk race") on one machine on one
// Wi-Fi network. It does NOT survive a server restart and will NOT work
// across multiple serverless instances - a real database (doc §11) is a
// later phase, needed once this moves off a laptop.
declare global {
  // eslint-disable-next-line no-var
  var __barcelonaRaceEngine: RaceEngine | undefined;
}

function buildEngine(): RaceEngine {
  const teams = teamsData.teams as Team[];
  const config: RaceConfig = { checkpoints: checkpointsData.checkpoints as RaceConfig["checkpoints"] };
  return new RaceEngine(config, teams);
}

export function getEngine(): RaceEngine {
  if (!globalThis.__barcelonaRaceEngine) {
    globalThis.__barcelonaRaceEngine = buildEngine();
  }
  return globalThis.__barcelonaRaceEngine;
}
