import { useCallback, useRef } from 'react';
import { shows } from '../data/shows';
import { legById } from '../lib/derive';
import { dayOf, labelForDay } from '../lib/time';

interface ScrubberProps {
  value: number;              // days from timeline start
  range: [number, number];    // visible window — the whole run, or one chapter
  activeLegIds: Set<string>;
  playing: boolean;
  onScrub: (day: number) => void;
  onTogglePlay: () => void;
}

const ticks = shows.map((s) => ({
  id: s.id,
  legId: s.legId,
  day: dayOf(s.date),
  color: legById.get(s.legId)?.color ?? 'currentColor',
}));

export function Scrubber({ value, range, activeLegIds, playing, onScrub, onTogglePlay }: ScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [start, end] = range;
  const span = Math.max(1, end - start);

  const dayFromPointer = useCallback(
    (clientX: number) => {
      const rect = trackRef.current!.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return start + pct * span;
    },
    [start, span],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    onScrub(dayFromPointer(e.clientX));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onScrub(dayFromPointer(e.clientX));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Chapters are short — step a day at a time inside one.
    const step = span < 60 ? (e.shiftKey ? 7 : 1) : e.shiftKey ? 14 : 3;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onScrub(Math.min(end, value + step));
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onScrub(Math.max(start, value - step));
    else if (e.key === 'Home') onScrub(start);
    else if (e.key === 'End') onScrub(end);
    else return;
    e.preventDefault();
  };

  const toPct = (day: number) => ((day - start) / span) * 100;
  const pct = Math.max(0, Math.min(100, toPct(value)));

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

      <span className="scrub-date scrub-date--start">{labelForDay(start)}</span>

      <div
        ref={trackRef}
        className="scrub-track"
        role="slider"
        tabIndex={0}
        aria-label="Timeline"
        aria-valuemin={Math.round(start)}
        aria-valuemax={Math.round(end)}
        aria-valuenow={Math.round(value)}
        aria-valuetext={labelForDay(value)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onKeyDown={handleKeyDown}
      >
        <div className="scrub-rail" />
        {ticks.map((tick) =>
          tick.day < start || tick.day > end ? null : (
            <span
              key={tick.id}
              className={activeLegIds.has(tick.legId) ? 'scrub-tick' : 'scrub-tick scrub-tick--off'}
              style={{ left: `${toPct(tick.day)}%`, background: tick.color }}
            />
          ),
        )}
        <div className="scrub-fill" style={{ width: `${pct}%` }} />
        <div className="scrub-handle" style={{ left: `${pct}%` }} />
      </div>

      <span className="scrub-date">{labelForDay(value)}</span>
    </div>
  );
}
