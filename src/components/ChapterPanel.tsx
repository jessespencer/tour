import { useRef, type CSSProperties } from 'react';
import { legRoutes, photoAlt, photoLarge, photosByShow, photosForLeg, photoThumb, venueById } from '../lib/derive';
import { formatDate, formatRange } from '../lib/format';
import { usePanelFocus } from '../lib/usePanelFocus';
import type { Photo } from '../types';

interface ChapterPanelProps {
  legId: string;
  currentShowId: string | null; // the show the timeline playhead has reached
  onClose: () => void;
  onSelectShow: (showId: string) => void;
  onOpenPhotos: (photos: Photo[], index: number) => void;
}

const STRIP_MAX = 12;

/** One tour leg as a chapter: cover, the numbers, the photos, then every show. */
export function ChapterPanel({ legId, currentShowId, onClose, onSelectShow, onOpenPhotos }: ChapterPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  usePanelFocus(closeRef);

  const route = legRoutes.find((r) => r.leg.id === legId);
  if (!route) return null;
  const { leg, shows, miles } = route;
  const photos = photosForLeg(legId);
  const cover = photos.find((p) => p.kind !== 'video');
  const cities = new Set(shows.map((s) => venueById.get(s.venueId)?.city)).size;

  return (
    <aside
      className="detail chapter"
      role="dialog"
      aria-label={`${leg.name} — tour chapter`}
      style={{ '--leg-color': leg.color } as CSSProperties}
    >
      <button ref={closeRef} type="button" className="detail-close" onClick={onClose} aria-label="Back to all tours">
        ×
      </button>

      {cover && (
        <button
          type="button"
          className="chapter-cover"
          onClick={() => onOpenPhotos(photos, photos.indexOf(cover))}
          aria-label={`Open photos — ${photoAlt(cover)}`}
        >
          <img src={photoLarge(cover)} alt="" />
        </button>
      )}

      <header className="detail-header chapter-header">
        <p className="detail-kicker">
          <span className="detail-swatch" style={{ background: leg.color }} aria-hidden="true" />
          {formatRange(leg.startDate, leg.endDate)}
        </p>
        <h2 className="detail-venue">{leg.name}</h2>
        {leg.billing && <p className="chapter-billing">{leg.billing}</p>}
        {leg.note && <p className="detail-note">{leg.note}</p>}
      </header>

      <dl className="chapter-stats">
        <div>
          <dt>Shows</dt>
          <dd>{shows.length}</dd>
        </div>
        <div>
          <dt>Cities</dt>
          <dd>{cities}</dd>
        </div>
        <div>
          <dt>Est. miles</dt>
          <dd>{miles.toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>Photos</dt>
          <dd>{photos.length}</dd>
        </div>
      </dl>

      {photos.length > 0 && (
        <section className="chapter-photos" aria-label="Photos from this tour">
          <div className="detail-photos">
            {photos.slice(0, STRIP_MAX).map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="photo-thumb"
                onClick={() => onOpenPhotos(photos, i)}
                aria-label={photoAlt(p)}
              >
                <img src={photoThumb(p)} alt={photoAlt(p)} loading="lazy" />
                {p.kind === 'video' && <span className="photo-play" aria-hidden="true" />}
              </button>
            ))}
          </div>
          {photos.length > STRIP_MAX && (
            <button type="button" className="chapter-more" onClick={() => onOpenPhotos(photos, STRIP_MAX)}>
              All {photos.length} photos →
            </button>
          )}
        </section>
      )}

      <section className="detail-run">
        <h3 className="detail-run-title">
          Every show
          <span className="detail-run-count">{shows.length}</span>
        </h3>
        <ol className="run-list">
          {shows.map((s) => {
            const v = venueById.get(s.venueId);
            if (!v) return null;
            const current = s.id === currentShowId;
            const n = photosByShow.get(s.id)?.length ?? 0;
            return (
              <li key={s.id} className={current ? 'run-row run-row--current' : 'run-row'}>
                <button
                  type="button"
                  onClick={() => onSelectShow(s.id)}
                  aria-current={current ? 'true' : undefined}
                  style={current ? { borderLeftColor: leg.color } : undefined}
                >
                  <span className="run-date">{formatDate(s.date)}</span>
                  <span className="run-venue">
                    {v.name || 'Venue TBD'}
                    <span className="run-city">
                      {v.city}, {v.state}
                      {n > 0 && <span className="run-photos"> · {n} photos</span>}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </aside>
  );
}
