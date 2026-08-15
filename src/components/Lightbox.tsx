import { useEffect, useRef } from 'react';
import { photoAlt, photoLarge, showById, venueById, videoSrc } from '../lib/derive';
import { formatDate } from '../lib/format';
import type { Photo } from '../types';

interface LightboxProps {
  photos: Photo[];
  index: number;
  onNav: (index: number) => void;
  onClose: () => void;
}

export function Lightbox({ photos, index, onNav, onClose }: LightboxProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const photo = photos[index];

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onNav(index + 1);
      else if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onNav, onClose]);

  if (!photo) return null;
  const show = showById.get(photo.showId);
  const venue = show ? venueById.get(show.venueId) : undefined;

  return (
    <div className="lightbox" role="dialog" aria-label="Photo viewer" onClick={onClose}>
      <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          type="button"
          className="lightbox-close"
          onClick={onClose}
          aria-label="Close photo viewer"
        >
          ×
        </button>
        {photo.kind === 'video' ? (
          <video
            key={photo.id}
            className="lightbox-img"
            src={videoSrc(photo)}
            poster={photoLarge(photo)}
            controls
            playsInline
          />
        ) : (
          <img className="lightbox-img" src={photoLarge(photo)} alt={photoAlt(photo)} />
        )}
        <div className="lightbox-bar">
          <button
            type="button"
            className="lightbox-nav"
            disabled={index === 0}
            onClick={() => onNav(index - 1)}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <div className="lightbox-caption">
            <span className="lightbox-place">
              {venue ? `${venue.name || 'Venue TBD'} · ${venue.city}, ${venue.state}` : photo.showId}
            </span>
            <span className="lightbox-meta">
              {formatDate(photo.takenAt.slice(0, 10))}
              {photo.kind === 'video' ? ' · Video' : ''}
              {photo.camera ? ` · ${photo.camera}` : ''}
              {photo.lat !== undefined ? ' · GPS' : ''}
              {photo.vsco ? ' · VSCO' : ''}
              {` · ${index + 1}/${photos.length}`}
            </span>
          </div>
          <button
            type="button"
            className="lightbox-nav"
            disabled={index === photos.length - 1}
            onClick={() => onNav(index + 1)}
            aria-label="Next photo"
          >
            ›
          </button>
        </div>
      </div>
    </div>
  );
}
