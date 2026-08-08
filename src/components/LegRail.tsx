import { legs } from '../data/legs';
import { legRoutes } from '../lib/derive';
import { formatRange } from '../lib/format';

interface LegRailProps {
  activeLegIds: Set<string>;
  onToggle: (legId: string) => void;
}

export function LegRail({ activeLegIds, onToggle }: LegRailProps) {
  return (
    <nav className="leg-rail" aria-label="Tour legs">
      {legs.map((leg) => {
        const route = legRoutes.find((r) => r.leg.id === leg.id);
        const count = route?.shows.length ?? 0;
        const active = activeLegIds.has(leg.id);
        return (
          <button
            key={leg.id}
            type="button"
            className={active ? 'leg-item' : 'leg-item leg-item--off'}
            aria-pressed={active}
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
