import { shows } from '../data/shows';
import { legById, venueById } from '../lib/derive';
import { formatDate } from '../lib/format';
import { sortShows } from '../lib/geo';

const allShows = sortShows(shows);

interface ListViewProps {
  activeLegIds: Set<string>;
  onSelectVenue: (venueId: string) => void;
}

export function ListView({ activeLegIds, onSelectVenue }: ListViewProps) {
  return (
    <ol className="list-view" aria-label="All shows, chronological">
      {allShows.map((show) => {
        const venue = venueById.get(show.venueId);
        const leg = legById.get(show.legId);
        if (!venue || !leg) return null;
        const active = activeLegIds.has(show.legId);
        return (
          <li key={show.id} className={active ? 'list-row' : 'list-row list-row--dim'}>
            <button type="button" onClick={() => onSelectVenue(venue.id)}>
              <span className="run-date">{formatDate(show.date)}</span>
              <span className="list-swatch" style={{ background: leg.color }} aria-hidden="true" />
              <span className="run-venue">
                {venue.name || 'Venue TBD'}
                <span className="run-city">
                  {venue.city}, {venue.state}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
