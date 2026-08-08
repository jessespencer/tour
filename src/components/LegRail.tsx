import type { CSSProperties } from 'react';
import { legs } from '../data/legs';
import { legRoutes } from '../lib/derive';
import { formatRange } from '../lib/format';

interface LegRailProps {
  selectedLegIds: Set<string>;  // empty = no focus, everything lit
  onToggle: (legId: string) => void;
}

export function LegRail({ selectedLegIds, onToggle }: LegRailProps) {
  const focused = selectedLegIds.size > 0;
  return (
    <nav className={focused ? 'leg-rail leg-rail--focused' : 'leg-rail'} aria-label="Tour legs">
      {legs.map((leg) => {
        const route = legRoutes.find((r) => r.leg.id === leg.id);
        const count = route?.shows.length ?? 0;
        const selected = selectedLegIds.has(leg.id);
        return (
          <button
            key={leg.id}
            type="button"
            className={selected ? 'leg-item leg-item--selected' : 'leg-item'}
            style={{ '--leg-color': leg.color } as CSSProperties}
            aria-pressed={selected}
            onClick={() => onToggle(leg.id)}
          >
            <span className="leg-swatch" style={{ background: leg.color }} aria-hidden="true" />
            <span className="leg-text">
              <span className="leg-name leg-name--full">{leg.name}</span>
              <span className="leg-name leg-name--short" aria-hidden="true">
                {leg.shortName}
              </span>
              <span className="leg-meta">
                {formatRange(leg.startDate, leg.endDate)} · {count} {count === 1 ? 'show' : 'shows'}
              </span>
            </span>
          </button>
        );
      })}
    </nav>
  );
}
