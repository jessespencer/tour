import { legs } from '../data/legs';
import { photos } from '../data/photos';
import { shows } from '../data/shows';
import { venues } from '../data/venues';
import type { Leg, Photo, Show, Venue } from '../types';
import { estimatedRoadMiles, projectVenue, segmentPath, sortShows } from './geo';
import { dayOf } from './time';

export const venueById = new Map<string, Venue>(venues.map((v) => [v.id, v]));
export const legById = new Map<string, Leg>(legs.map((l) => [l.id, l]));
export const showById = new Map<string, Show>(shows.map((s) => [s.id, s]));

export interface RouteSegment {
  path: string | null;  // null when the hop is too short to draw (same venue)
  miles: number;
  fromDay: number;
  toDay: number;
}

export interface LegRoute {
  leg: Leg;
  shows: Show[];        // chronological
  segments: RouteSegment[];
  miles: number;        // est. road miles across the leg
}

export const legRoutes: LegRoute[] = legs.map((leg) => {
  const legShows = sortShows(shows.filter((s) => s.legId === leg.id));
  const segments: RouteSegment[] = [];
  let miles = 0;

  for (let i = 1; i < legShows.length; i++) {
    const prev = legShows[i - 1];
    const curr = legShows[i];
    const from = venueById.get(prev.venueId);
    const to = venueById.get(curr.venueId);
    if (!from || !to) continue;
    const hop = estimatedRoadMiles(from, to);
    miles += hop;
    const a = projectVenue(from);
    const b = projectVenue(to);
    segments.push({
      path: a && b ? segmentPath(a, b) : null,
      miles: hop,
      fromDay: dayOf(prev.date),
      toDay: dayOf(curr.date),
    });
  }

  return { leg, shows: legShows, segments, miles: Math.round(miles) };
});

/** Cumulative est. road miles at a point on the timeline — segments in
 *  progress contribute proportionally, which is what makes the odometer
 *  climb smoothly between show dates. */
export function milesAt(day: number): number {
  let sum = 0;
  for (const route of legRoutes) {
    for (const seg of route.segments) {
      if (day >= seg.toDay) sum += seg.miles;
      else if (day > seg.fromDay && seg.toDay > seg.fromDay) {
        sum += (seg.miles * (day - seg.fromDay)) / (seg.toDay - seg.fromDay);
      }
    }
  }
  return sum;
}

export function showsPlayedAt(day: number): number {
  return shows.reduce((n, s) => (dayOf(s.date) <= day ? n + 1 : n), 0);
}

export interface VenueDot {
  venue: Venue;
  point: [number, number];
  shows: Show[];        // every show at this venue, across legs
  color: string;        // color of the first leg that played it
  firstDay: number;     // timeline day the venue first appears
}

// One dot per venue — repeat venues cluster into a single dot that knows
// all of its shows, rather than stacking marks. Sorted by first show date
// so DOM/tab order follows the chronology.
export const venueDots: VenueDot[] = venues
  .flatMap((venue): VenueDot[] => {
    const point = projectVenue(venue);
    if (!point) return [];
    const venueShows = sortShows(shows.filter((s) => s.venueId === venue.id));
    if (venueShows.length === 0) return [];
    const color = legById.get(venueShows[0].legId)?.color ?? 'currentColor';
    return [{ venue, point, shows: venueShows, color, firstDay: dayOf(venueShows[0].date) }];
  })
  .sort((a, b) => a.firstDay - b.firstDay);

export const photosByShow = new Map<string, Photo[]>();
for (const photo of photos) {
  const list = photosByShow.get(photo.showId) ?? [];
  list.push(photo);
  photosByShow.set(photo.showId, list);
}
for (const list of photosByShow.values()) {
  list.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
}

export function photoThumb(p: Photo): string {
  return `/photos/${p.showId}/${p.id}_t.jpg`;
}

export function photoLarge(p: Photo): string {
  return `/photos/${p.showId}/${p.id}_l.jpg`;
}

export function photoAlt(p: Photo): string {
  const show = showById.get(p.showId);
  const venue = show ? venueById.get(show.venueId) : undefined;
  const where = venue ? `${venue.name || venue.city}, ${venue.city} ${venue.state}` : p.showId;
  return `Photo near ${where} — ${p.takenAt.slice(0, 10)}`;
}

/** GPS-tagged photos plotted at their exact coordinates, clustered when
 *  several were shot in the same spot (~1 km grid). */
export interface PhotoMarker {
  key: string;
  point: [number, number];
  photos: Photo[];       // chronological
  legId: string;
  firstDay: number;
}

export const photoMarkers: PhotoMarker[] = (() => {
  const clusters = new Map<string, Photo[]>();
  for (const p of photos) {
    if (p.lat === undefined || p.lng === undefined) continue;
    const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
    const list = clusters.get(key) ?? [];
    list.push(p);
    clusters.set(key, list);
  }
  const markers: PhotoMarker[] = [];
  for (const [key, list] of clusters) {
    list.sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const first = list[0];
    const point = projectVenue({ lat: first.lat!, lng: first.lng! } as Venue);
    if (!point) continue;
    markers.push({
      key,
      point,
      photos: list,
      legId: showById.get(first.showId)?.legId ?? '',
      firstDay: dayOf(first.takenAt.slice(0, 10)),
    });
  }
  return markers.sort((a, b) => a.firstDay - b.firstDay);
})();

export const totals = {
  shows: shows.length,
  miles: Math.round(legRoutes.reduce((sum, r) => sum + r.miles, 0)),
  years: `${shows[0].date.slice(0, 4)}–${shows[shows.length - 1].date.slice(0, 4)}`,
};
