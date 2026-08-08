import { useCallback, useRef } from 'react';
import { shows } from '../data/shows';
import { legById } from '../lib/derive';
import { dayOf, labelForDay, TOTAL_DAYS } from '../lib/time';

interface ScrubberProps {
  value: number;              // days from timeline start
  playing: boolean;
  onScrub: (day: number) => void;
  onTogglePlay: () => void;
}

const ticks = shows.map((s) => ({
  id: s.id,
  pct: (dayOf(s.date) / TOTAL_DAYS) * 100,
  color: legById.get(s.legId)?.color ?? 'currentColor',
}));

export function Scrubber({ value, playing, onScrub, onTogglePlay }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const dayFromPointer = useCallback((clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * TOTAL_DAYS;
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(dayFromPointer(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(dayFromPointer(e.clientX));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 14 : 3;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onScrub(Math.min(TOTAL_DAYS, value + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onScrub(Math.max(0, value - step));
    else if (e.key === 'Home') onScrub(0);
    else if (e.key === 'End') onScrub(TOTAL_DAYS);
    else return;
    e.preventDefault();
  };

  const pct = (value / TOTAL_DAYS) * 100;

  return (
    <div className="scrubber">
      <button
        type="button"
        className="scrub-play"
        onClick={onTogglePlay}
        aria-label={playing ? 'Pause timeline' : 'Play timeline'}
      >
        {playing ? (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1.5" y="1" width="3.2" height="10" />
            <rect x="7.3" y="1" width="3.2" height="10" />
          </svg>
        ) : (
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 1 L11 6 L2.5 11 Z" />
          </svg>
        )}
      </button>

      <div
        ref={trackRef}
        className="scrub-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={0}
        aria-valuemax={TOTAL_DAYS}
        aria-valuenow={Math.round(value)}
        aria-valuetext={labelForDay(value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <div className="scrub-rail" />
        {ticks.map((tick) => (
          <span
            key={tick.id}
            className="scrub-tick"
            style={{ left: `${tick.pct}%`, background: tick.color }}
          />
        ))}
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <div className="scrub-handle" style={{ left: `${pct}%` }} />
      </div>

      <span className="scrub-date">{labelForDay(value)}</span>
    </div>
  );
}
