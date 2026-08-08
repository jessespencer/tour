import { useEffect, useRef, useState } from 'react';
import { DetailPanel } from './components/DetailPanel';
import { LegRail } from './components/LegRail';
import { ListView } from './components/ListView';
import { MapCanvas, type FlyRequest } from './components/MapCanvas';
import { Scrubber } from './components/Scrubber';
import { ShowStepper } from './components/ShowStepper';
import { legs } from './data/legs';
import { milesAt, showById, showsPlayedAt, venueDots } from './lib/derive';
import { TOTAL_DAYS } from './lib/time';

const PLAY_SPEED = 36.5; // timeline days per second ≈ 10s per year

const ALL_LEG_IDS = new Set(legs.map((l) => l.id));

const reducedMotion =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Eases the displayed number toward its target so jumps read as counting. */
function useOdometer(target: number): number {
  const [display, setDisplay] = useState(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    if (reducedMotion) return;
    let raf = requestAnimationFrame(function tick() {
      setDisplay((prev) => {
        const diff = targetRef.current - prev;
        return Math.abs(diff) < 0.6 ? targetRef.current : prev + diff * 0.2;
      });
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return reducedMotion ? target : display;
}

export function App() {
  // Highlight semantics: empty selection = no focus, every leg fully lit.
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(() => new Set());
  const [timeDays, setTimeDays] = useState(TOTAL_DAYS);
  const [playing, setPlaying] = useState(false);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [flyRequest, setFlyRequest] = useState<FlyRequest | null>(null);

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
          />
        )}
      </main>

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
        <a href="mailto:jessespencerw@gmail.com?subject=Tour%20map%20correction">
          Remember it differently? Send a correction
        </a>
      </footer>
    </div>
  );
}
