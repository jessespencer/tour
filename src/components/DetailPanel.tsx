import { useEffect, useRef } from 'react';
import { legById, legRoutes, photoAlt, photosByShow, photoThumb, venueById } from '../lib/derive';
import { formatDate } from '../lib/format';
import type { Photo, Show } from '../types';

const TYPE_LABELS: Record<Show['type'], string> = {
  support: 'Support',
  headline: 'Headline',
  festival: 'Festival',
  radio: 'Radio',
  'in-store': 'In-store',
  tv: 'TV',
  webcast: 'Webcast',
  private: 'Private',
  rehearsal: 'Rehearsal',
};

interface DetailPanelProps {
  venueId: string;
  selectedShowId: string | null;
  onClose: () => void;
  onSelectShow: (showId: string) => void;
  onOpenPhotos: (photos: Photo[], index: number) => void;
}

export function DetailPanel({
  venueId,
  selectedShowId,
  onClose,
  onSelectShow,
  onOpenPhotos,
}: DetailPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, [venueId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const venue = venueById.get(venueId);
  if (!venue) return null;

  // Every show at this venue, then the full run of the leg it belongs to.
  const route = legRoutes.find((r) => r.shows.some((s) => s.venueId === venueId));
  const venueShows = route?.shows.filter((s) => s.venueId === venueId) ?? [];

  return (
    <aside className="detail" role="dialog" aria-label={venue.name || `Venue in ${venue.city}`}>
      <button
        ref={closeRef}
        type="button"
        className="detail-close"
        onClick={onClose}
        aria-label="Close details"
      >
        ×
      </button>

      <header className="detail-header">
        <p className="detail-kicker">
          {venue.city}, {venue.state}
        </p>
        <h2 className="detail-venue">{venue.name || 'Venue TBD'}</h2>
        {venue.address && <p className="detail-address">{venue.address}</p>}
      </header>

      {venueShows.map((show) => {
        const leg = legById.get(show.legId);
        return (
          <section key={show.id} className="detail-show">
            <h3 className="detail-date">{formatDate(show.date)}</h3>
            <dl className="detail-facts">
              {leg && (
                <>
                  <dt>Leg</dt>
                  <dd>
                    <span className="detail-swatch" style={{ background: leg.color }} aria-hidden="true" />
                    {leg.name}
                  </dd>
                </>
              )}
              <dt>Type</dt>
              <dd>{TYPE_LABELS[show.type]}</dd>
              {leg?.billing && (
                <>
                  <dt>Billing</dt>
                  <dd>{leg.billing}</dd>
                </>
              )}
              {show.doors && (
                <>
                  <dt>Doors</dt>
                  <dd>{show.doors}</dd>
                </>
              )}
              {show.setTime && (
                <>
                  <dt>Set</dt>
                  <dd>{show.setTime}</dd>
                </>
              )}
              {show.setLength && (
                <>
                  <dt>Length</dt>
                  <dd>{show.setLength}</dd>
                </>
              )}
              {venue.capacity && (
                <>
                  <dt>Capacity</dt>
                  <dd>{venue.capacity.toLocaleString('en-US')}</dd>
                </>
              )}
            </dl>
            {show.note && <p className="detail-note">{show.note}</p>}
            {!show.confirmed && <p className="detail-unconfirmed">In the record, not yet verified</p>}
            {(() => {
              const showPhotos = photosByShow.get(show.id);
              if (!showPhotos?.length) return null;
              return (
                <div className="detail-photos">
                  {showPhotos.map((p, i) => (
                    <button
                      key={p.id}
                      type="button"
                      className="photo-thumb"
                      onClick={() => onOpenPhotos(showPhotos, i)}
                      aria-label={photoAlt(p)}
                    >
                      <img src={photoThumb(p)} alt={photoAlt(p)} loading="lazy" />
                      {p.lat !== undefined && <span className="photo-gps" aria-hidden="true" />}
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>
        );
      })}

      {route && (
        <section className="detail-run">
          <h3 className="detail-run-title">
            Full run · {route.leg.name}
            <span className="detail-run-count">{route.shows.length} shows</span>
          </h3>
          <ol className="run-list">
            {route.shows.map((s) => {
              const v = venueById.get(s.venueId);
              if (!v) return null;
              const current = selectedShowId ? s.id === selectedShowId : v.id === venueId;
              return (
                <li key={s.id} className={current ? 'run-row run-row--current' : 'run-row'}>
                  <button
                    type="button"
                    onClick={() => onSelectShow(s.id)}
                    aria-current={current ? 'true' : undefined}
                    style={current ? { borderLeftColor: route.leg.color } : undefined}
                  >
                    <span className="run-date">{formatDate(s.date)}</span>
                    <span className="run-venue">
                      {v.name || 'Venue TBD'}
                      <span className="run-city">
                        {v.city}, {v.state}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </aside>
  );
}
