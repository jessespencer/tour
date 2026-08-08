import { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath } from 'd3-geo';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomTransform } from 'd3-zoom';
import { merge, mesh } from 'topojson-client';
import type { Topology, GeometryCollection, Polygon, MultiPolygon } from 'topojson-specification';
import statesTopo from 'us-atlas/states-albers-10m.json';
import { legRoutes, venueDots, type VenueDot } from '../lib/derive';
import { formatDate } from '../lib/format';

const topo = statesTopo as unknown as Topology<{ states: GeometryCollection; nation: GeometryCollection }>;

// Lower 48 only — Alaska, Hawaii, Puerto Rico dropped from the basemap.
const EXCLUDED_FIPS = new Set(['02', '15', '72']);

interface Hover {
  dot: VenueDot;
  x: number;
  y: number;
}

interface MapCanvasProps {
  activeLegIds: Set<string>;
}

export function MapCanvas({ activeLegIds }: MapCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [t, setT] = useState<ZoomTransform>(zoomIdentity);
  const [hover, setHover] = useState<Hover | null>(null);

  const { nationPath, statesPath, viewBox, extent } = useMemo(() => {
    const path = geoPath(); // us-atlas geometry is preprojected — identity path
    const kept = topo.objects.states.geometries.filter(
      (g) => !EXCLUDED_FIPS.has(String(g.id)),
    ) as Array<Polygon | MultiPolygon>;
    const nation = merge(topo, kept);
    const keptCollection: GeometryCollection = { type: 'GeometryCollection', geometries: kept };
    const [[x0, y0], [x1, y1]] = path.bounds(nation);
    const pad = 14;
    return {
      nationPath: path(nation) ?? '',
      statesPath: path(mesh(topo, keptCollection, (a, b) => a !== b)) ?? '',
      viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`,
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
    return () => {
      svg.on('.zoom', null);
    };
  }, [extent]);

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

          {legRoutes.map(({ leg, paths }) => (
            <g
              key={leg.id}
              className={activeLegIds.has(leg.id) ? 'leg-route' : 'leg-route leg-route--off'}
              stroke={leg.color}
              strokeWidth={1.8 / k}
              style={{ filter: `drop-shadow(0 0 ${3 / k}px ${leg.color}66)` }}
            >
              {paths.map((d, i) => (
                <path key={i} d={d} />
              ))}
            </g>
          ))}

          {venueDots.map((dot) => {
            const { venue, point, color, shows } = dot;
            const active = shows.some((s) => activeLegIds.has(s.legId));
            const unknown = venue.name === '';
            return (
              <g
                key={venue.id}
                className={active ? 'dot' : 'dot dot--off'}
                onMouseEnter={(e) => setHover({ dot, x: e.clientX, y: e.clientY })}
                onMouseMove={(e) => setHover({ dot, x: e.clientX, y: e.clientY })}
                onMouseLeave={() => setHover(null)}
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

      {hover && (
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
    </>
  );
}
