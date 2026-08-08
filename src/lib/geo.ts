import { geoAlbersUsa } from 'd3-geo';
import type { Show, Venue } from '../types';

// us-atlas TopoJSON is preprojected with exactly this projection into a
// 975×610 viewport — venue coordinates must go through the same one.
export const MAP_WIDTH = 975;
export const MAP_HEIGHT = 610;

export const projection = geoAlbersUsa().scale(1300).translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);

export function projectVenue(venue: Venue): [number, number] | null {
  return projection([venue.lng, venue.lat]);
}

/** Stable chronological order: by date, ties broken by position in the data file. */
export function sortShows(shows: Show[]): Show[] {
  return shows
    .map((show, index) => ({ show, index }))
    .sort((a, b) => a.show.date.localeCompare(b.show.date) || a.index - b.index)
    .map((entry) => entry.show);
}

const EARTH_RADIUS_MI = 3958.8;
const ROAD_FACTOR = 1.18; // great-circle → estimated road miles

export function greatCircleMiles(a: Venue, b: Venue): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

export function estimatedRoadMiles(a: Venue, b: Venue): number {
  return greatCircleMiles(a, b) * ROAD_FACTOR;
}

/**
 * Quadratic curve between two projected points, control point offset
 * perpendicular to the segment — separates out-and-back overlaps and reads
 * hand-drawn rather than machine-plotted.
 */
export function segmentPath(from: [number, number], to: [number, number]): string | null {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.5) return null; // same venue (or next door) — nothing to draw

  const bend = Math.min(length * 0.18, 16);
  const cx = (from[0] + to[0]) / 2 + (-dy / length) * bend;
  const cy = (from[1] + to[1]) / 2 + (dx / length) * bend;
  return `M${from[0]},${from[1]} Q${cx},${cy} ${to[0]},${to[1]}`;
}
