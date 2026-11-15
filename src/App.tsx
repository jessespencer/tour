import { useEffect, useRef, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { LegRail } from './components/LegRail';
import { Lightbox } from './components/Lightbox';
import { ListView } from './components/ListView';
import { MapCanvas, type FlyRequest } from './components/MapCanvas';
import { Scrubber } from './components/Scrubber';
import { ShowStepper } from './components/ShowStepper';
import { legs } from './data/legs';
import { milesAt, showById, showsPlayedAt, venueDots } from './lib/derive';
import { TOTAL_DAYS } from './lib/time';
import type { Photo } from './types';

const PLAY_SPEED = 36.5; // timeline days per second ≈ 10s per year

const ALL_LEG_IDS = new Set(legs.map((l) => l.id));

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases the displayed number toward its target so jumps read as counting.
 *  The animation loop runs only while the number is still moving. */
function useOdometer(target: number): number {
  const [display, setDisplay] = useState(target);
  const displayRef = useRef(target);

  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const tick = () => {
      const prev = displayRef.current;
      const diff = target - prev;
      const next = Math.abs(diff) < 0.6 ? target : prev + diff * 0.2;
      displayRef.current = next;
      setDisplay(next);
      if (next !== target) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return reducedMotion ? target : display;
}

/** Pinch-zoom outside the SVG (or via Safari gesture events, which d3-zoom
 *  never sees) triggers browser page zoom and scrolls the chrome off-screen —
 *  swallow it app-wide. Cmd+/- browser zoom still works. */
function usePageZoomGuard() {
  useEffect(() => {
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const gesture = (e: Event) => e.preventDefault();
    window.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('gesturestart', gesture);
    window.addEventListener('gesturechange', gesture);
    return () => {
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('gesturestart', gesture);
      window.removeEventListener('gesturechange', gesture);
    };
  }, []);
}

export function App() {
  usePageZoomGuard();
  // Highlight semantics: empty selection = no focus, every leg fully lit.
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(() => new Set());
  const [timeDays, setTimeDays] = useState(TOTAL_DAYS);
  const [playing, setPlaying] = useState(false);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);

  const activeLegIds = selectedLegIds.size === 0 ? ALL_LEG_IDS : selectedLegIds;
  const selectedShow = selectedShowId ? showById.get(selectedShowId) : undefined;
  const selectedVenueId = selectedShow?.venueId ?? null;

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function step(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      setTimeDays((prev) => {
        const next = prev + dt * PLAY_SPEED;
        if (next >= TOTAL_DAYS) {
          setPlaying(false);
          return TOTAL_DAYS;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggleLeg = (legId: string) => {
    setPlaying(false);
    setSelectedLegIds((prev) => {
      const next = new Set(prev);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
      return next;
    });
  };

  const handleScrub = (day: number) => {
    setPlaying(false);
    setTimeDays(day);
  };

  const handleTogglePlay = () => {
    if (!playing && timeDays >= TOTAL_DAYS) setTimeDays(0);
    setPlaying((p) => !p);
  };

  // Dot clicks: open the panel on the venue's first show, no camera move.
  const handleSelectVenue = (venueId: string) => {
    setPlaying(false);
    const dot = venueDots.find((d) => d.venue.id === venueId);
    if (dot) setSelectedShowId(dot.shows[0].id);
  };

  // Stepper, run-list, and list-view clicks: select and fly there.
  const handleNavigateToShow = (showId: string) => {
    const show = showById.get(showId);
    if (!show) return;
    setPlaying(false);
    setSelectedShowId(showId);
    setView('map');
    setFlyRequest((prev) => ({ venueId: show.venueId, seq: (prev?.seq ?? 0) + 1 }));
  };

  const handleOpenPhotos = (photos: Photo[], index: number) => {
    setPlaying(false);
    setLightbox({ photos, index });
  };

  // One Escape handler for the whole app, so a press closes only the topmost
  // layer: photo viewer, then show.
  // The listener is attached once and reads the latest state through a ref, so
  // it can't be detached mid-dispatch by a re-render.
  const escapeRef = useRef<() => void>(() => {});
  escapeRef.current = () => {
    if (lightbox) setLightbox(null);
    else if (selectedShowId) setSelectedShowId(null);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const odometerMiles = useOdometer(milesAt(timeDays));

  return (
    <div className="app">
      <header className="header">
        <div className="header-lockup">
          <h1 className="header-title">Every Show</h1>
          <p className="header-sub">Drums for Matt Hires · 2013–2014</p>
        </div>
        <ShowStepper
          selectedShowId={selectedShowId}
          activeLegIds={activeLegIds}
          onStep={handleNavigateToShow}
        />
        <div className="header-stats">
          <button
            type="button"
            className="view-toggle"
            onClick={() => setView((v) => (v === 'map' ? 'list' : 'map'))}
            aria-pressed={view === 'list'}
          >
            {view === 'map' ? 'List' : 'Map'}
          </button>
          <div className="stat">
            <span className="stat-value">{showsPlayedAt(timeDays)}</span>
            <span className="stat-label">shows</span>
          </div>
          <div className="stat">
            <span className="stat-value">{Math.round(odometerMiles).toLocaleString('en-US')}</span>
            <span className="stat-label">est. miles</span>
          </div>
        </div>
      </header>

      <LegRail selectedLegIds={selectedLegIds} onToggle={toggleLeg} />

      <main className={view === 'list' ? 'stage stage--list' : 'stage'}>
        {view === 'map' ? (
          <MapCanvas
            activeLegIds={activeLegIds}
            timeDays={timeDays}
            selectedVenueId={selectedVenueId}
            onSelectVenue={handleSelectVenue}
            onOpenPhotos={handleOpenPhotos}
            flyTo={flyRequest}
          />
        ) : (
          <ListView activeLegIds={activeLegIds} onSelectShow={handleNavigateToShow} />
        )}
        {selectedVenueId && (
          <DetailPanel
            venueId={selectedVenueId}
            selectedShowId={selectedShowId}
            onClose={() => setSelectedShowId(null)}
            onSelectShow={handleNavigateToShow}
            onOpenPhotos={handleOpenPhotos}
          />
        )}
      </main>

      {lightbox && (
        <Lightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onNav={(index) => setLightbox({ ...lightbox, index })}
          onClose={() => setLightbox(null)}
        />
      )}

      {view === 'map' && (
        <Scrubber
          value={timeDays}
          playing={playing}
          onScrub={handleScrub}
          onTogglePlay={handleTogglePlay}
        />
      )}

      <footer className="footer">
        <span>Dates & venues verified against original tour itineraries and day sheets</span>
        <a
          href="https://github.com/jessespencer/tour/issues/new?title=Tour%20map%20correction"
          target="_blank"
          rel="noopener noreferrer"
        >
          Remember it differently? Send a correction
        </a>
      </footer>
    </div>
  );
}
