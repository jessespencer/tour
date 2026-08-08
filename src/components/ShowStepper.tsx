import { shows } from '../data/shows';
import { showById, venueById } from '../lib/derive';
import { formatDate } from '../lib/format';
import { sortShows } from '../lib/geo';
import type { Show } from '../types';

const chronology = sortShows(shows);

interface ShowStepperProps {
  selectedShowId: string | null;
  activeLegIds: Set<string>;   // stepping walks only highlighted legs
  onStep: (showId: string) => void;
}

function neighbors(list: Show[], selected: Show | undefined) {
  if (list.length === 0) return { prev: null, next: null };
  if (!selected) return { prev: list[list.length - 1], next: list[0] };
  const idx = list.findIndex((s) => s.id === selected.id);
  if (idx >= 0) return { prev: list[idx - 1] ?? null, next: list[idx + 1] ?? null };
  // selected show's leg is filtered out — step relative to its date
  const after = list.findIndex((s) => s.date > selected.date);
  if (after === -1) return { prev: list[list.length - 1], next: null };
  return { prev: list[after - 1] ?? null, next: list[after] };
}

export function ShowStepper({ selectedShowId, activeLegIds, onStep }: ShowStepperProps) {
  const list = chronology.filter((s) => activeLegIds.has(s.legId));
  const selected = selectedShowId ? showById.get(selectedShowId) : undefined;
  const { prev, next } = neighbors(list, selected);
  const venue = selected ? venueById.get(selected.venueId) : undefined;

  return (
    <div className="stepper">
      <button
        type="button"
        className="stepper-btn"
        disabled={!prev}
        onClick={() => prev && onStep(prev.id)}
        aria-label="Previous show"
      >
        <svg viewBox="0 0 8 12" aria-hidden="true">
          <path d="M7 1 L2 6 L7 11" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      <span className="stepper-label">
        {selected && venue ? (
          <>
            <span className="stepper-venue">{venue.name || 'Venue TBD'}</span>
            <span className="stepper-date">{formatDate(selected.date)}</span>
          </>
        ) : (
          <span className="stepper-date">{list.length} shows</span>
        )}
      </span>

      <button
        type="button"
        className="stepper-btn"
        disabled={!next}
        onClick={() => next && onStep(next.id)}
        aria-label="Next show"
      >
        <svg viewBox="0 0 8 12" aria-hidden="true">
          <path d="M1 1 L6 6 L1 11" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
    </div>
  );
}
