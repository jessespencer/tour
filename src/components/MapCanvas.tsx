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
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface StreetLayers {
  major: StreetBucket[];
  minor: StreetBucket[];
}

const STREETS_PREFETCH_K = 5; // start loading once the user commits to zooming
const STREETS_MAJOR_K = 14;
const STREETS_MINOR_K = 32;

/** Group projected street polylines into ~10 km spatial buckets so only
 *  buckets intersecting the viewport are rendered. */
function buildStreetBuckets(lines: [number, number][][], tier: string): StreetBucket[] {
  const CELL = 2; // viewBox units ≈ 10 km
  const cells = new Map<string, { d: string; x0: number; y0: number; x1: number; y1: number }>();
  for (const line of lines) {
    let d = '';
    let first = true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const pt of line) {
      const p = projection(pt);
      if (!p) {
        first = true;
        continue;
      }
      d += `${first ? 'M' : 'L'}${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      first = false;
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    if (!d) continue;
    const key = `${tier}:${Math.round(x0 / CELL)}:${Math.round(y0 / CELL)}`;
    const cell = cells.get(key);
    if (cell) {
      cell.d += d;
      cell.x0 = Math.min(cell.x0, x0);
      cell.y0 = Math.min(cell.y0, y0);
      cell.x1 = Math.max(cell.x1, x1);
      cell.y1 = Math.max(cell.y1, y1);
    } else {
      cells.set(key, { d, x0, y0, x1, y1 });
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
  const [streets, setStreets] = useState<StreetLayers | null>(null);
  const streetsRequested = useRef(false);

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
      .scaleExtent([1, 2400])
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
    if (t.k < STREETS_PREFETCH_K || streetsRequested.current) return;
    streetsRequested.current = true;
    fetch('/streets.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { major: [number, number][][]; minor: [number, number][][] } | null) => {
        if (!data) return;
        setStreets({
          major: buildStreetBuckets(data.major, 'M'),
          minor: buildStreetBuckets(data.minor, 'm'),
        });
      })
      .catch(() => {}); // streets.json absent — the layer just never appears
  }, [t.k]);

  const k = t.k;
  // k^0.8 keeps marks readable at street-level zoom without ballooning
  const dotR = 3.8 / k ** 0.8;
  const symbolStroke = 1.2 / k ** 0.8;

  // zoom-dependent clustering: photos within ~56 screen px stack into one tile pile
  const kq = Math.round(k * 4) / 4;
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
    return [...cells.entries()].map(([key, points]) => {
      let h = 0;
      for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
      return {
        key,
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
            style={{ opacity: k >= 4 && k < STREETS_MINOR_K ? 1 : 0 }}
          />

          {streets && k >= STREETS_MAJOR_K && (() => {
            const vx0 = (vb.x - t.x) / k;
            const vy0 = (vb.y - t.y) / k;
            const vx1 = vx0 + vb.w / k;
            const vy1 = vy0 + vb.h / k;
            const visible = (b: StreetBucket) =>
              b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1;
            return (
              <g className="map-streets">
                {k >= STREETS_MINOR_K &&
                  streets.minor.filter(visible).map((b) => (
                    <path key={b.key} d={b.d} className="street-minor" strokeWidth={0.7 / k} />
                  ))}
                {streets.major.filter(visible).map((b) => (
                  <path key={b.key} d={b.d} className="street-major" strokeWidth={1.1 / k} />
                ))}
              </g>
            );
          })()}

          {legRoutes.map(({ leg, segments }) => (
            <g
              key={leg.id}
              className={activeLegIds.has(leg.id) ? 'leg-route' : 'leg-route leg-route--off'}
              stroke={leg.color}
              strokeWidth={1.8 / k}
              style={{ filter: `drop-shadow(0 0 ${3 / k}px ${leg.color}66)` }}
            >
              {segments.map((seg, i) => {
                if (!seg.path) return null;
                const progress = segmentProgress(seg, timeDays);
                if (progress <= 0) return null;
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
                  <g transform={`translate(${w / 2},${-w / 2})`}>
                    <circle r={7.5 / k} className="tile-count-bg" />
                    <text className="tile-count" fontSize={8.5 / k} dy={3 / k} textAnchor="middle">
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
              return (
                <circle
                  className="dot-select-ring"
                  cx={dot.point[0]}
                  cy={dot.point[1]}
                  r={dotR * 2.6}
                  strokeWidth={symbolStroke}
                />
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
                {!unknown && <circle cx={point[0]} cy={point[1]} r={dotR * 2} fill={color} className="dot-halo" />}
                <circle
                  cx={point[0]}
                  cy={point[1]}
                  r={dotR}
                  fill={unknown ? 'var(--ground)' : color}
                  stroke={unknown ? color : 'var(--ground)'}
                  strokeWidth={symbolStroke}
                  strokeDasharray={unknown ? `${3 / k} ${2 / k}` : undefined}
                  className="dot-core"
                />
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
