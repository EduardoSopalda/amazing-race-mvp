import type { Checkpoint } from "./types";

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lon points, in metres (haversine). */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * A checkpoint with radiusMeters 0 has no real-world fence - this is what the
 * desk-race test data uses (doc's own "not tied to real GPS coordinates"
 * placeholders) - and unlocks immediately without waiting for a GPS fix.
 */
export function checkpointRequiresGps(checkpoint: Checkpoint): boolean {
  return checkpoint.radiusMeters > 0;
}
