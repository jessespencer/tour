import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import 'd3-transition'; // registers selection.transition for animated zooms
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import { merge, mesh } from 'topojson-client';
import type { Topology, GeometryCollection, Polygon, MultiPolygon } from 'topojson-specification';
import statesTopo from 'us-atlas/states-albers-10m.json';
import {
  legRoutes,
  photoMarkers,
  photoThumb,
  venueDots,
  type PhotoMarker,
  type RouteSegment,
  type VenueDot,
} from '../lib/derive';
import { formatDate } from '../lib/format';
import type { Photo } from '../types';

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
  | { kind: 'photo'; marker: PhotoMarker; x: number; y: number };

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
      .scaleExtent([1, 9])
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

  const k = t.k;
  const dotR = 3.8 / Math.sqrt(k);

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

          {photoMarkers.map((marker) => {
            if (marker.firstDay > timeDays) return null;
            const active = activeLegIds.has(marker.legId);
            const size = 4.6 / Math.sqrt(k);
            return (
              <g
                key={marker.key}
                className={active ? 'photo-marker' : 'photo-marker photo-marker--off'}
                role="button"
                tabIndex={active ? 0 : -1}
                aria-label={`${marker.photos.length} photo${marker.photos.length > 1 ? 's' : ''} taken here`}
                onClick={() => onOpenPhotos(marker.photos, 0)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpenPhotos(marker.photos, 0);
                  }
                }}
                onMouseEnter={(e) => setHover({ kind: 'photo', marker, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ kind: 'photo', marker, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={marker.point[0] - size / 2}
                  y={marker.point[1] - size / 2}
                  width={size}
                  height={size}
                  transform={`rotate(45 ${marker.point[0]} ${marker.point[1]})`}
                  strokeWidth={1 / Math.sqrt(k)}
                />
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
                  strokeWidth={1.2 / Math.sqrt(k)}
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
                  strokeWidth={(unknown ? 1 : 1.2) / Math.sqrt(k)}
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
        <div className="tooltip tooltip--photo" style={{ left: hover.x, top: hover.y }}>
          <img
            src={photoThumb(hover.marker.photos[0])}
            alt=""
            className="tooltip-thumb"
            loading="lazy"
          />
          <div className="tooltip-date">
            {formatDate(hover.marker.photos[0].takenAt.slice(0, 10))}
            {hover.marker.photos.length > 1 && ` · ${hover.marker.photos.length} photos`}
          </div>
        </div>
      )}
    </>
  );
}
