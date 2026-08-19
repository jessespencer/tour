import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition'; // registers selection.transition for animated zooms
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { merge, mesh } from 'topojson-client';
import type { Topology, GeometryCollection, Polygon, MultiPolygon } from 'topojson-specification';
import statesTopo from 'us-atlas/states-albers-10m.json';
import countiesTopo from 'us-atlas/counties-albers-10m.json';
import {
  legRoutes,
  photoPoints,
  photoThumb,
  venueDots,
  type PhotoPoint,
  type RouteSegment,
  type VenueDot,
} from '../lib/derive';
import { formatDate } from '../lib/format';
import { projection } from '../lib/geo';
import type { Photo } from '../types';

interface StreetBucket {
  key: string;
  d: string;
  alpha: number; // edge-fade level baked in at load time
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface StreetLayers {
  major: StreetBucket[];
  minor: StreetBucket[];
  bldg: StreetBucket[];
  labels: StreetLabel[];
}

const STREETS_INDEX_K = 5; // fetch the tiny chunk index once the user commits to zooming
const STREETS_FETCH_K = 10; // start pulling street chunks near the viewport
const STREETS_MAJOR_K = 14;
const STREETS_MINOR_K = 28;
const STREET_NAMES_K = 380; // street-name labels ease in past this zoom
const BLDG_K = 110; // building footprints ease in past this zoom
const LABEL_STEP = 0.09; // anchor spacing along a way, viewBox units (~440 m)
// Labels are assigned a fixed priority level at load: level g claims a cell in
// grid g (viewBox units) and shows past LABEL_LVL_K[g]. Deterministic, so the
// visible set never reshuffles while zooming — it only gains fading-in layers.
const LABEL_GRIDS = [1.2, 0.3, 0.12];
const LABEL_LVL_K = [STREET_NAMES_K, 900, 2000, 4200];
const MAX_K = 8000; // ~600 m viewport — block level

interface StreetSpot {
  x: number;
  y: number;
  rNear: number; // full residential grid extent, viewBox units
  rFar: number; // arterials-only extent
  rBldg: number; // building-footprint extent
}

interface StreetWay {
  n?: string; // OSM name, when tagged
  c: [number, number][];
}

interface StreetLabel {
  name: string;
  x: number;
  y: number;
  angle: number; // degrees, flipped to keep text upright
  alpha: number;
  lvl?: number; // priority level, set by assignLabelLevels
}

/** One pass over a chunk's labels (arterials first): each label takes the
 *  coarsest free grid cell and blocks that spot in every finer grid, so
 *  density grows with zoom without any per-frame reselection. */
function assignLabelLevels(labels: StreetLabel[]): StreetLabel[] {
  const seen = LABEL_GRIDS.map(() => new Set<string>());
  return labels.map((lb) => {
    let lvl = LABEL_GRIDS.length; // deepest tier: only near max zoom
    for (let g = 0; g < LABEL_GRIDS.length; g++) {
      const key = `${Math.round(lb.x / LABEL_GRIDS[g])}:${Math.round(lb.y / LABEL_GRIDS[g])}`;
      if (!seen[g].has(key)) {
        lvl = g;
        for (let h = g; h < LABEL_GRIDS.length; h++) {
          seen[h].add(`${Math.round(lb.x / LABEL_GRIDS[h])}:${Math.round(lb.y / LABEL_GRIDS[h])}`);
        }
        break;
      }
    }
    return { ...lb, lvl };
  });
}

interface StreetChunkMeta {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface StreetsIndex {
  spots: StreetSpot[];
  chunks: StreetChunkMeta[];
}

/** Deterministic 0–1 hash from a coordinate — used to dissolve street edges. */
function hash01(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Edge falloff: full strength through 55% of a spot's radius, then a long
 *  smoothstep that reaches ~0.1 at the actual data edge so the boundary
 *  dissolves instead of cutting. t = distance / spot radius. */
function fadeAlpha(t: number): number {
  if (t <= 0.55) return 1;
  if (t >= 1.1) return 0;
  const u = (t - 0.55) / 0.55;
  return 1 - u * u * (3 - 2 * u);
}

/** Group projected street polylines into ~10 km spatial buckets so only
 *  buckets intersecting the viewport are rendered. Each way gets an edge-fade
 *  alpha from its distance to the nearest tour spot (quantized into bands so
 *  ways sharing a cell+band merge into one path); ways near the edge are also
 *  probabilistically dropped, which reads as a feathered dissolve. */
function buildStreetBuckets(
  ways: StreetWay[],
  tier: 'major' | 'minor',
  keyPrefix: string,
  spots: StreetSpot[],
): { buckets: StreetBucket[]; labels: StreetLabel[] } {
  const CELL = 2; // viewBox units ≈ 10 km
  const cells = new Map<string, { d: string; alpha: number; x0: number; y0: number; x1: number; y1: number }>();
  const labels: StreetLabel[] = [];
  for (const way of ways) {
    let d = '';
    let first = true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const projected: [number, number][] = [];
    for (const pt of way.c) {
      const p = projection(pt);
      if (!p) {
        first = true;
        continue;
      }
      projected.push(p);
      d += `${first ? 'M' : 'L'}${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      first = false;
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    if (!d) continue;

    const mid = projected.length >> 1;
    const [mx, my] = projected[mid];
    let t = Infinity;
    for (const s of spots) {
      const r = tier === 'major' ? s.rFar : s.rNear;
      if (r <= 0) continue;
      const rel = Math.hypot(mx - s.x, my - s.y) / r;
      if (rel < t) t = rel;
    }
    const alpha = fadeAlpha(t);
    if (alpha <= 0) continue;
    if (hash01(mx, my) > Math.min(1, alpha * 1.8 + 0.05)) continue; // dissolve
    const qa = Math.ceil(alpha * 5) / 5; // 5 opacity bands

    // Anchor labels along named ways every LABEL_STEP so even a viewport much
    // shorter than the way still contains one; text angled along the street,
    // flipped upright. Dedupe at render time keeps overview density sane.
    if (way.n && alpha > 0.55 && projected.length >= 2) {
      let next = LABEL_STEP / 2;
      let walked = 0;
      let emitted = 0;
      for (let i = 1; i < projected.length; i++) {
        const [ax, ay] = projected[i - 1];
        const [bx, by] = projected[i];
        const seg = Math.hypot(bx - ax, by - ay);
        while (walked + seg >= next) {
          const f = (next - walked) / seg;
          let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
          if (angle > 90) angle -= 180;
          if (angle < -90) angle += 180;
          labels.push({
            name: way.n,
            x: ax + (bx - ax) * f,
            y: ay + (by - ay) * f,
            angle,
            alpha,
          });
          emitted++;
          next += LABEL_STEP;
        }
        walked += seg;
      }
      // OSM often splits a street into per-block ways shorter than the anchor
      // step — give those one midpoint anchor so the street still labels.
      if (emitted === 0 && walked > 0.008) {
        const [ax, ay] = projected[Math.max(0, mid - 1)];
        const [bx, by] = projected[Math.min(projected.length - 1, mid + 1)];
        let angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        labels.push({ name: way.n, x: mx, y: my, angle, alpha });
      }
    }

    const key = `${keyPrefix}:${Math.round(x0 / CELL)}:${Math.round(y0 / CELL)}:${qa}`;
    const cell = cells.get(key);
    if (cell) {
      cell.d += d;
      cell.x0 = Math.min(cell.x0, x0);
      cell.y0 = Math.min(cell.y0, y0);
      cell.x1 = Math.max(cell.x1, x1);
      cell.y1 = Math.max(cell.y1, y1);
    } else {
      cells.set(key, { d, alpha: qa, x0, y0, x1, y1 });
    }
  }
  return { buckets: [...cells.entries()].map(([key, c]) => ({ key, ...c })), labels };
}

/** Building footprints — closed rings, faded at the (tighter) building radius. */
function buildBldgBuckets(
  rings: [number, number][][],
  keyPrefix: string,
  spots: StreetSpot[],
): StreetBucket[] {
  const CELL = 1; // ~5 km cells; footprint data is dense and local
  const cells = new Map<string, { d: string; alpha: number; x0: number; y0: number; x1: number; y1: number }>();
  for (const ring of rings) {
    let d = '';
    let first = true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    let mx = 0, my = 0, n = 0;
    for (const pt of ring) {
      const p = projection(pt);
      if (!p) {
        first = true;
        continue;
      }
      d += `${first ? 'M' : 'L'}${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      first = false;
      mx += p[0];
      my += p[1];
      n++;
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    if (!d || n === 0) continue;
    d += 'Z';
    mx /= n;
    my /= n;

    let t = Infinity;
    for (const s of spots) {
      if (s.rBldg <= 0) continue;
      const rel = Math.hypot(mx - s.x, my - s.y) / s.rBldg;
      if (rel < t) t = rel;
    }
    const alpha = fadeAlpha(t);
    if (alpha <= 0) continue;
    if (hash01(mx, my) > Math.min(1, alpha * 1.8 + 0.05)) continue; // dissolve
    const qa = Math.ceil(alpha * 5) / 5;

    const key = `${keyPrefix}:${Math.round(x0 / CELL)}:${Math.round(y0 / CELL)}:${qa}`;
    const cell = cells.get(key);
    if (cell) {
      cell.d += d;
      cell.x0 = Math.min(cell.x0, x0);
      cell.y0 = Math.min(cell.y0, y0);
      cell.x1 = Math.max(cell.x1, x1);
      cell.y1 = Math.max(cell.y1, y1);
    } else {
      cells.set(key, { d, alpha: qa, x0, y0, x1, y1 });
    }
  }
  return [...cells.entries()].map(([key, c]) => ({ key, ...c }));
}

const topo = statesTopo as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;

// Lower 48 only — Alaska, Hawaii, Puerto Rico dropped from the basemap.
const EXCLUDED_FIPS = new Set(['02', '15', '72']);

function segmentProgress(seg: RouteSegment, day: number): number {
  if (day >= seg.toDay) return 1;
  if (day <= seg.fromDay || seg.toDay === seg.fromDay) return 0;
  return (day - seg.fromDay) / (seg.toDay - seg.fromDay);
}

type Hover =
  | { kind: 'venue'; dot: VenueDot; x: number; y: number }
  | { kind: 'photo'; photos: Photo[]; x: number; y: number };

interface TileCluster {
  key: string;
  x: number;
  y: number;
  points: PhotoPoint[];  // chronological
  rot: number;           // deterministic small rotation, hand-placed feel
}

export interface FlyRequest {
  venueId: string;
  seq: number; // bump to re-fly to the same venue
}

interface MapCanvasProps {
  activeLegIds: Set<string>;
  timeDays: number;
  selectedVenueId: string | null;
  onSelectVenue: (venueId: string) => void;
  onOpenPhotos: (photos: Photo[], index: number) => void;
  flyTo: FlyRequest | null;
}

export function MapCanvas({
  activeLegIds,
  timeDays,
  selectedVenueId,
  onSelectVenue,
  onOpenPhotos,
  flyTo,
}: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const behaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<Hover | null>(null);
  const [streetsIndex, setStreetsIndex] = useState<StreetsIndex | null>(null);
  const [chunkLayers, setChunkLayers] = useState<Record<string, StreetLayers>>({});
  const indexRequested = useRef(false);
  const chunksRequested = useRef<Set<string>>(new Set());

  const countiesPath = useMemo(() => {
    const t = countiesTopo as unknown as Topology<{ counties: GeometryCollection }>;
    const kept: GeometryCollection = {
      type: 'GeometryCollection',
      geometries: t.objects.counties.geometries.filter(
        (g) => !EXCLUDED_FIPS.has(String(g.id).slice(0, 2)),
      ),
    };
    return geoPath()(mesh(t, kept, (a, b) => a !== b)) ?? '';
  }, []);

  const { nationPath, statesPath, viewBox, vb, extent } = useMemo(() => {
    const path = geoPath(); // us-atlas geometry is preprojected — identity path
    const kept = topo.objects.states.geometries.filter(
      (g) => !EXCLUDED_FIPS.has(String(g.id)),
    ) as Array<Polygon | MultiPolygon>;
    const nation = merge(topo, kept);
    const keptCollection: GeometryCollection = { type: 'GeometryCollection', geometries: kept };
    const [[x0, y0], [x1, y1]] = path.bounds(nation);
    const pad = 14;
    const vbRect = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    return {
      nationPath: path(nation) ?? '',
      statesPath: path(mesh(topo, keptCollection, (a, b) => a !== b)) ?? '',
      viewBox: `${vbRect.x} ${vbRect.y} ${vbRect.w} ${vbRect.h}`,
      vb: vbRect,
      extent: [
        [x0 - pad, y0 - pad],
        [x1 + pad, y1 + pad],
      ] as [[number, number], [number, number]],
    };
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = select(svgRef.current);
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, MAX_K])
      .translateExtent(extent)
      .on('zoom', (event) => setT(event.transform));
    svg.call(behavior);
    behaviorRef.current = behavior;
    return () => {
      svg.on('.zoom', null);
      behaviorRef.current = null;
    };
  }, [extent]);

  const flyToVenue = useCallback(
    (venueId: string) => {
      const dot = venueDots.find((d) => d.venue.id === venueId);
      const svgEl = svgRef.current;
      const behavior = behaviorRef.current;
      if (!dot || !svgEl || !behavior) return;

      const K = 5;
      const cw = svgEl.clientWidth;
      const ch = svgEl.clientHeight;
      const s = Math.min(cw / vb.w, ch / vb.h); // rendered px per viewBox unit
      const ox = (cw - vb.w * s) / 2; // letterbox offsets from preserveAspectRatio
      const oy = (ch - vb.h * s) / 2;

      // Land the venue in the part of the stage the detail panel doesn't cover:
      // left of the side panel on desktop, above the bottom sheet on mobile.
      const isMobile = window.innerWidth <= 760;
      const targetX = isMobile ? cw / 2 : Math.max(cw / 2 - 195, cw * 0.25);
      const targetY = isMobile ? ch * 0.35 : ch / 2;
      const vtx = vb.x + (targetX - ox) / s;
      const vty = vb.y + (targetY - oy) / s;
      const target = zoomIdentity
        .translate(vtx - K * dot.point[0], vty - K * dot.point[1])
        .scale(K);

      const sel = select(svgEl);
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        sel.call(behavior.transform, target);
      } else {
        sel.transition().duration(850).call(behavior.transform, target);
      }
    },
    [vb],
  );

  useEffect(() => {
    if (flyTo) flyToVenue(flyTo.venueId);
  }, [flyTo, flyToVenue]);

  const resetView = () => {
    const svgEl = svgRef.current;
    const behavior = behaviorRef.current;
    if (!svgEl || !behavior) return;
    const sel = select(svgEl);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sel.call(behavior.transform, zoomIdentity);
    } else {
      sel.transition().duration(650).call(behavior.transform, zoomIdentity);
    }
  };

  useEffect(() => {
    if (t.k < STREETS_INDEX_K || indexRequested.current) return;
    indexRequested.current = true;
    fetch('/streets/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          spots: [number, number, number, number, number][]; // lng, lat, near/far/bldg m
          chunks: { id: string; b: [number, number, number, number] }[]; // lon/lat bounds
        } | null) => {
          if (!data) return;
          const metersToUnits = (lng: number, lat: number, m: number) => {
            const p0 = projection([lng, lat]);
            const p1 = projection([lng, lat + m / 111320]);
            return p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0;
          };
          const spots = data.spots.flatMap(([lng, lat, near, far, bldg]) => {
            const p = projection([lng, lat]);
            if (!p) return [];
            return [{
              x: p[0],
              y: p[1],
              rNear: metersToUnits(lng, lat, near),
              rFar: metersToUnits(lng, lat, far),
              rBldg: metersToUnits(lng, lat, bldg ?? 0),
            }];
          });
          const chunks = data.chunks.flatMap(({ id, b }) => {
            const corners = (
              [[b[0], b[1]], [b[0], b[3]], [b[2], b[1]], [b[2], b[3]]] as [number, number][]
            )
              .map((c) => projection(c))
              .filter((p): p is [number, number] => p !== null);
            if (corners.length === 0) return [];
            const pad = 0.5; // conic curvature can bow edges past the corner box
            return [{
              id,
              x0: Math.min(...corners.map((c) => c[0])) - pad,
              y0: Math.min(...corners.map((c) => c[1])) - pad,
              x1: Math.max(...corners.map((c) => c[0])) + pad,
              y1: Math.max(...corners.map((c) => c[1])) + pad,
            }];
          });
          setStreetsIndex({ spots, chunks });
        },
      )
      .catch(() => {}); // streets data absent — the layer just never appears
  }, [t.k]);

  // Pull only chunk files whose bounds land within half a viewport of the view.
  useEffect(() => {
    if (!streetsIndex || t.k < STREETS_FETCH_K) return;
    const vx0 = (vb.x - t.x) / t.k;
    const vy0 = (vb.y - t.y) / t.k;
    const vw = vb.w / t.k;
    const vh = vb.h / t.k;
    const mx = vw / 2;
    const my = vh / 2;
    for (const c of streetsIndex.chunks) {
      if (c.x1 < vx0 - mx || c.x0 > vx0 + vw + mx || c.y1 < vy0 - my || c.y0 > vy0 + vh + my) {
        continue;
      }
      if (chunksRequested.current.has(c.id)) continue;
      chunksRequested.current.add(c.id);
      fetch(`/streets/${c.id}.json`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: { major: StreetWay[]; minor: StreetWay[]; bldg?: [number, number][][] } | null) => {
          if (!data) return;
          const major = buildStreetBuckets(data.major, 'major', `M${c.id}`, streetsIndex.spots);
          const minor = buildStreetBuckets(data.minor, 'minor', `m${c.id}`, streetsIndex.spots);
          const layers = {
            major: major.buckets,
            minor: minor.buckets,
            bldg: buildBldgBuckets(data.bldg ?? [], `b${c.id}`, streetsIndex.spots),
            // arterials first — they win the coarse (earliest-visible) label slots
            labels: assignLabelLevels([...major.labels, ...minor.labels]),
          };
          setChunkLayers((prev) => ({ ...prev, [c.id]: layers }));
        })
        .catch(() => {});
    }
  }, [t, streetsIndex, vb]);

  const k = t.k;
  // k^0.8 keeps marks readable at street-level zoom without ballooning
  const dotR = 3.8 / k ** 0.8;
  const symbolStroke = 1.2 / k ** 0.8;

  // zoom-dependent clustering: photos within ~56 screen px stack into one tile
  // pile. Regroup only at half-octave zoom steps, and key clusters by their
  // lead photo (not the grid cell) so unchanged piles keep their DOM nodes —
  // cell-derived keys remounted every <image> on each regroup and flickered.
  const kq = 2 ** (Math.round(Math.log2(k) * 2) / 2);
  const clusters = useMemo<TileCluster[]>(() => {
    const cell = 56 / kq;
    const cells = new Map<string, PhotoPoint[]>();
    for (const pp of photoPoints) {
      if (pp.day > timeDays) continue;
      const key = `${Math.round(pp.point[0] / cell)}:${Math.round(pp.point[1] / cell)}`;
      const list = cells.get(key) ?? [];
      list.push(pp);
      cells.set(key, list);
    }
    return [...cells.values()].map((points) => {
      const lead = points[0].photo.id;
      let h = 0;
      for (const ch of lead) h = (h * 31 + ch.charCodeAt(0)) | 0;
      return {
        key: `${lead}:${points.length}`,
        x: points.reduce((s, p) => s + p.point[0], 0) / points.length,
        y: points.reduce((s, p) => s + p.point[1], 0) / points.length,
        points,
        rot: (Math.abs(h) % 9) - 4,
      };
    });
  }, [kq, timeDays]);

  return (
    <>
      <svg
        ref={svgRef}
        className="map-canvas"
        viewBox={viewBox}
        role="img"
        aria-label="Map of the United States showing every tour stop, connected by route lines colored per tour leg"
      >
        <g transform={`translate(${t.x},${t.y}) scale(${k})`}>
          <path d={nationPath} className="map-nation" strokeWidth={1.1 / k} />
          <path d={statesPath} className="map-states" strokeWidth={0.6 / k} />
          <path
            d={countiesPath}
            className="map-counties"
            strokeWidth={0.35 / k}
            style={{ opacity: Math.min(1, Math.max(0, (k - 3) / 2)) }}
          />

          {streetsIndex && k > STREETS_MAJOR_K && (() => {
            const vx0 = (vb.x - t.x) / k;
            const vy0 = (vb.y - t.y) / k;
            const vx1 = vx0 + vb.w / k;
            const vy1 = vy0 + vb.h / k;
            const visible = (b: StreetBucket) =>
              b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1;
            const loaded = Object.values(chunkLayers);
            // Tiers ease in over a few zoom levels instead of popping at a threshold.
            const majorRamp = Math.min(1, (k - STREETS_MAJOR_K) / 6);
            const minorRamp = Math.min(1, Math.max(0, (k - STREETS_MINOR_K) / 10));
            const bldgRamp = Math.min(1, Math.max(0, (k - BLDG_K) / 70));

            // Labels: viewport-cull, gate by each label's fixed level. Set
            // membership is stable while zooming — levels only fade in.
            const labels: StreetLabel[] = [];
            if (k >= STREET_NAMES_K) {
              outer: for (const l of loaded) {
                for (const lb of l.labels) {
                  if (k < LABEL_LVL_K[Math.min(lb.lvl ?? LABEL_GRIDS.length, LABEL_LVL_K.length - 1)]) continue;
                  if (lb.x < vx0 || lb.x > vx1 || lb.y < vy0 || lb.y > vy1) continue;
                  labels.push(lb);
                  if (labels.length >= 160) break outer;
                }
              }
            }

            return (
              <g className="map-streets">
                {bldgRamp > 0 &&
                  loaded.flatMap((l) =>
                    l.bldg.filter(visible).map((b) => (
                      <path
                        key={b.key}
                        d={b.d}
                        className="map-bldg"
                        strokeWidth={0.3 / k}
                        strokeOpacity={b.alpha * bldgRamp}
                      />
                    )),
                  )}
                {minorRamp > 0 &&
                  loaded.flatMap((l) =>
                    l.minor.filter(visible).map((b) => (
                      <path
                        key={b.key}
                        d={b.d}
                        className="street-minor"
                        strokeWidth={0.7 / k}
                        strokeOpacity={b.alpha * minorRamp}
                      />
                    )),
                  )}
                {loaded.flatMap((l) =>
                  l.major.filter(visible).map((b) => (
                    <path
                      key={b.key}
                      d={b.d}
                      className="street-major"
                      strokeWidth={1.1 / k}
                      strokeOpacity={b.alpha * majorRamp}
                    />
                  )),
                )}
                {labels.map((lb) => {
                  const lvlK = LABEL_LVL_K[Math.min(lb.lvl ?? LABEL_GRIDS.length, LABEL_LVL_K.length - 1)];
                  const fade = Math.min(1, (k - lvlK) / (lvlK * 0.45));
                  return (
                    <text
                      key={`${lb.name}:${lb.x.toFixed(3)}:${lb.y.toFixed(3)}`}
                      className="street-name"
                      x={lb.x}
                      y={lb.y}
                      dy={-2.2 / k}
                      fontSize={10.5 / k}
                      transform={`rotate(${lb.angle} ${lb.x} ${lb.y})`}
                      opacity={lb.alpha * fade}
                    >
                      {lb.name}
                    </text>
                  );
                })}
              </g>
            );
          })()}

          {legRoutes.map(({ leg, segments }) => (
            <g
              key={leg.id}
              className={activeLegIds.has(leg.id) ? 'leg-route' : 'leg-route leg-route--off'}
              stroke={leg.color}
              strokeWidth={1.8 / k}
              // The glow filter forces an offscreen surface scaled by k — past
              // ~8x it's sub-pixel anyway, and at street zoom the giant surface
              // glitches (dark wedge artifacts) and re-rasters every frame.
              style={k < 8 ? { filter: `drop-shadow(0 0 ${3 / k}px ${leg.color}66)` } : undefined}
            >
              {segments.map((seg, i) => {
                if (!seg.path) return null;
                const progress = segmentProgress(seg, timeDays);
                if (progress <= 0) return null;
                // Dash-based progress only while animating: pathLength
                // normalization has float error that leaves a visible gap
                // at the venue dot when magnified to street zoom.
                if (progress >= 1) return <path key={i} d={seg.path} />;
                return (
                  <path
                    key={i}
                    d={seg.path}
                    pathLength={1}
                    strokeDasharray="1"
                    strokeDashoffset={1 - progress}
                  />
                );
              })}
            </g>
          ))}

          {clusters.map((c) => {
            const active = c.points.some((pp) => activeLegIds.has(pp.legId));
            const list = c.points.map((pp) => pp.photo);
            const w = 44 / k;
            const behind = c.points.slice(1, 3);
            const first = list[0];
            return (
              <g
                key={c.key}
                className={active ? 'photo-tile' : 'photo-tile photo-tile--off'}
                transform={`translate(${c.x},${c.y}) rotate(${c.rot})`}
                role="button"
                tabIndex={active ? 0 : -1}
                aria-label={`${list.length} photo${list.length > 1 ? 's' : ''}, ${formatDate(first.takenAt.slice(0, 10))}`}
                onClick={() => onOpenPhotos(list, 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenPhotos(list, 0);
                  }
                }}
                onMouseEnter={(e) => setHover({ kind: 'photo', photos: list, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ kind: 'photo', photos: list, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
              >
                {behind
                  .map((pp, i) => (
                    <g
                      key={pp.photo.id}
                      transform={`translate(${((i + 1) * 5) / k},${((i + 1) * -4) / k}) rotate(${(i + 1) * 5})`}
                    >
                      <image
                        href={photoThumb(pp.photo)}
                        x={-w / 2}
                        y={-w / 2}
                        width={w}
                        height={w}
                        preserveAspectRatio="xMidYMid slice"
                      />
                      <rect x={-w / 2} y={-w / 2} width={w} height={w} className="tile-frame" strokeWidth={symbolStroke} />
                    </g>
                  ))
                  .reverse()}
                <image
                  href={photoThumb(first)}
                  x={-w / 2}
                  y={-w / 2}
                  width={w}
                  height={w}
                  preserveAspectRatio="xMidYMid slice"
                />
                <rect x={-w / 2} y={-w / 2} width={w} height={w} className="tile-frame" strokeWidth={symbolStroke} />
                {first.kind === 'video' && (
                  <path
                    d={`M${-4 / k},${-6 / k} L${7 / k},0 L${-4 / k},${6 / k} Z`}
                    className="tile-play"
                  />
                )}
                {list.length > 1 && (
                  <g transform={`translate(${w / 2},${-w / 2}) scale(${1 / k})`}>
                    <circle r={7.5} className="tile-count-bg" />
                    <text className="tile-count" fontSize={8.5} dy={3} textAnchor="middle">
                      {list.length}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

          {selectedVenueId &&
            (() => {
              const dot = venueDots.find((d) => d.venue.id === selectedVenueId);
              if (!dot || dot.firstDay > timeDays) return null;
              // Screen-space radius: tiny user-unit circles get flattened into
              // visible polygons at extreme zoom.
              return (
                <g transform={`translate(${dot.point[0]},${dot.point[1]}) scale(${1 / k})`}>
                  <circle className="dot-select-ring" r={dotR * 2.6 * k} strokeWidth={symbolStroke * k} />
                </g>
              );
            })()}

          {venueDots.map((dot) => {
            const { venue, point, color, shows, firstDay } = dot;
            if (firstDay > timeDays) return null; // not reached yet on the timeline
            const active = shows.some((s) => activeLegIds.has(s.legId));
            const unknown = venue.name === '';
            return (
              <g
                key={venue.id}
                className={active ? 'dot' : 'dot dot--off'}
                role="button"
                tabIndex={active ? 0 : -1}
                aria-label={`${venue.name || 'Venue TBD'}, ${venue.city}, ${venue.state}`}
                onClick={() => onSelectVenue(venue.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectVenue(venue.id);
                  }
                }}
                onMouseEnter={(e) => setHover({ kind: 'venue', dot, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ kind: 'venue', dot, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(null)}
              >
                {/* Screen-space geometry inside a 1/k group — user-unit-sized
                    circles get flattened into visible polygons at deep zoom. */}
                <g transform={`translate(${point[0]},${point[1]}) scale(${1 / k})`}>
                  {!unknown && <circle r={dotR * 2 * k} fill={color} className="dot-halo" />}
                  <circle
                    r={dotR * k}
                    fill={unknown ? 'var(--ground)' : color}
                    stroke={unknown ? color : 'var(--ground)'}
                    strokeWidth={symbolStroke * k}
                    strokeDasharray={unknown ? '3 2' : undefined}
                    className="dot-core"
                  />
                </g>
              </g>
            );
          })}
        </g>
      </svg>

      {k > 1.02 && (
        <button type="button" className="map-reset" onClick={resetView} aria-label="Reset map view">
          <svg viewBox="0 0 14 14" aria-hidden="true">
            <path
              d="M1 5V1h4M9 1h4v4M13 9v4H9M5 13H1V9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
      )}

      {hover && hover.kind === 'venue' && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="tooltip-venue">{hover.dot.venue.name || 'Venue TBD'}</div>
          <div className="tooltip-city">
            {hover.dot.venue.city}, {hover.dot.venue.state}
          </div>
          {hover.dot.shows.slice(0, 4).map((s) => (
            <div key={s.id} className="tooltip-date">
              {formatDate(s.date)}
            </div>
          ))}
          {hover.dot.shows.length > 4 && (
            <div className="tooltip-date">+{hover.dot.shows.length - 4} more</div>
          )}
        </div>
      )}

      {hover && hover.kind === 'photo' && (
        <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="tooltip-date">
            {formatDate(hover.photos[0].takenAt.slice(0, 10))}
            {hover.photos.length > 1 && ` · ${hover.photos.length} items`}
          </div>
        </div>
      )}
    </>
  );
}
