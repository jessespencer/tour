import type { CSSProperties } from 'react';
import { legs } from '../data/legs';
import { legRoutes, photosByShow } from '../lib/derive';
import { formatRange } from '../lib/format';

interface LegRailProps {
  selectedLegIds: Set<string>; // empty = all tours
  onSelect: (legId: string, additive: boolean) => void;
  onClear: () => void;
}

const photoCounts = new Map(
  legRoutes.map((r) => [r.leg.id, r.shows.reduce((n, s) => n + (photosByShow.get(s.id)?.length ?? 0), 0)]),
);

// Every leg's color as an equal slice — the swatch for "all tours".
const allSwatch = `conic-gradient(${legs
  .map((l, i) => `${l.color} ${(i / legs.length) * 100}% ${((i + 1) / legs.length) * 100}%`)
  .join(', ')})`;

export function LegRail({ selectedLegIds, onSelect, onClear }: LegRailProps) {
  const all = selectedLegIds.size === 0;
  return (
    <nav className="leg-rail" aria-label="Tours">
      <button
        type="button"
        className={all ? 'leg-item leg-item--all leg-item--selected' : 'leg-item leg-item--all'}
        aria-pressed={all}
        onClick={onClear}
      >
        <span className="leg-swatch leg-swatch--all" style={{ background: allSwatch }} aria-hidden="true" />
        <span className="leg-text">
          <span className="leg-name leg-name--full">All tours</span>
          <span className="leg-name leg-name--short" aria-hidden="true">
            All
          </span>
        </span>
      </button>

      {legs.map((leg) => {
        const route = legRoutes.find((r) => r.leg.id === leg.id);
        const count = route?.shows.length ?? 0;
        const photos = photoCounts.get(leg.id) ?? 0;
        const selected = selectedLegIds.has(leg.id);
        return (
          <button
            key={leg.id}
            type="button"
            className={selected ? 'leg-item leg-item--selected' : 'leg-item'}
            style={{ '--leg-color': leg.color } as CSSProperties}
            aria-pressed={selected}
            onClick={(e) => onSelect(leg.id, e.shiftKey || e.metaKey || e.ctrlKey)}
          >
            <span className="leg-swatch" style={{ background: leg.color }} aria-hidden="true" />
            <span className="leg-text">
              <span className="leg-name leg-name--full">{leg.name}</span>
              <span className="leg-name leg-name--short" aria-hidden="true">
                {leg.shortName}
              </span>
              <span className="leg-meta">
                {formatRange(leg.startDate, leg.endDate)} · {count} {count === 1 ? 'show' : 'shows'}
                {photos > 0 && ` · ${photos} photos`}
              </span>
            </span>
          </button>
        );
      })}

      <p className="leg-hint">Shift-click to compare tours</p>
    </nav>
  );
}
