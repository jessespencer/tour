import { legs } from '../data/legs';
import { shows } from '../data/shows';
import { venues } from '../data/venues';
import type { Leg, Show, Venue } from '../types';
import { estimatedRoadMiles, projectVenue, segmentPath, sortShows } from './geo';

export const venueById = new Map<string, Venue>(venues.map((v) => [v.id, v]));
export const legById = new Map<string, Leg>(legs.map((l) => [l.id, l]));

export interface LegRoute {
  leg: Leg;
  shows: Show[];        // chronological
  paths: string[];      // one segment per consecutive pair of distinct venues
  miles: number;        // est. road miles across the leg
}

export const legRoutes: LegRoute[] = legs.map((leg) => {
  const legShows = sortShows(shows.filter((s) => s.legId === leg.id));
  const paths: string[] = [];
  let miles = 0;

  for (let i = 1; i < legShows.length; i++) {
    const from = venueById.get(legShows[i - 1].venueId);
    const to = venueById.get(legShows[i].venueId);
    if (!from || !to) continue;
    miles += estimatedRoadMiles(from, to);
    const a = projectVenue(from);
    const b = projectVenue(to);
    if (!a || !b) continue;
    const d = segmentPath(a, b);
    if (d) paths.push(d);
  }

  return { leg, shows: legShows, paths, miles: Math.round(miles) };
});

export interface VenueDot {
  venue: Venue;
  point: [number, number];
  shows: Show[];        // every show at this venue, across legs
  color: string;        // color of the first leg that played it
}

// One dot per venue — repeat venues cluster into a single dot that knows
// all of its shows, rather than stacking marks.
export const venueDots: VenueDot[] = venues.flatMap((venue) => {
  const point = projectVenue(venue);
  if (!point) return [];
  const venueShows = sortShows(shows.filter((s) => s.venueId === venue.id));
  if (venueShows.length === 0) return [];
  const color = legById.get(venueShows[0].legId)?.color ?? 'currentColor';
  return [{ venue, point, shows: venueShows, color }];
});

export const totals = {
  shows: shows.length,
  miles: legRoutes.reduce((sum, r) => sum + r.miles, 0),
  years: `${shows[0].date.slice(0, 4)}–${shows[shows.length - 1].date.slice(0, 4)}`,
};
