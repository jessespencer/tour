import { useEffect, useRef, useState } from 'react';
import { ChapterPanel } from './components/ChapterPanel';
import { DetailPanel } from './components/DetailPanel';
import { LegRail } from './components/LegRail';
import { Lightbox } from './components/Lightbox';
import { ListView } from './components/ListView';
import { MapCanvas, type CameraRequest, type CameraTarget } from './components/MapCanvas';
import { Scrubber } from './components/Scrubber';
import { ShowStepper } from './components/ShowStepper';
import { legs } from './data/legs';
import { legRoutes, legsDayRange, milesAt, showById, showsPlayedAt, venueDots } from './lib/derive';
import { dayOf, TOTAL_DAYS } from './lib/time';
import type { Photo } from './types';

const PLAY_SPEED = 36.5; // timeline days per second ≈ 10s per year
const CHAPTER_PLAY_SECONDS = 12; // a chapter plays end to end in about this long

const ALL_LEG_IDS = new Set(legs.map((l) => l.id));
const FULL_RANGE: [number, number] = [0, TOTAL_DAYS];

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
  // Empty selection = all tours. One leg = that tour's chapter. More = compare.
  const [selectedLegIds, setSelectedLegIds] = useState<Set<string>>(() => new Set());
  const [timeDays, setTimeDays] = useState(TOTAL_DAYS);
  const [playing, setPlaying] = useState(false);
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: Photo[]; index: number } | null>(null);

  const scoped = selectedLegIds.size > 0;
  const activeLegIds = scoped ? selectedLegIds : ALL_LEG_IDS;
  const chapterLegId = selectedLegIds.size === 1 ? [...selectedLegIds][0] : null;
  const range = scoped ? legsDayRange(selectedLegIds) : FULL_RANGE;
  const selectedShow = selectedShowId ? showById.get(selectedShowId) : undefined;
  const selectedVenueId = selectedShow?.venueId ?? null;

  const moveCamera = (target: CameraTarget) =>
    setCamera((prev) => ({ ...target, seq: (prev?.seq ?? 0) + 1 }));

  // Playback stops at the end of whatever window the timeline is showing.
  const rangeRef = useRef(range);
  rangeRef.current = range;
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = requestAnimationFrame(function step(now: number) {
      const dt = (now - last) / 1000;
      last = now;
      const [start, end] = rangeRef.current;
      // Chapters are weeks long, the whole run is over a year — pace each so
      // playback takes a watchable amount of time.
      const speed = end - start < 120 ? (end - start) / CHAPTER_PLAY_SECONDS : PLAY_SPEED;
      setTimeDays((prev) => {
        const next = prev + dt * speed;
        if (next >= end) {
          setPlaying(false);
          return end;
        }
        return next;
      });
      raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const applyLegSelection = (next: Set<string>) => {
    setPlaying(false);
    setSelectedShowId(null);
    setSelectedLegIds(next);
    setTimeDays(next.size > 0 ? legsDayRange(next)[1] : TOTAL_DAYS);
    moveCamera(next.size > 0 ? { kind: 'legs', legIds: [...next] } : { kind: 'reset' });
  };

  // Plain click opens that tour (or closes it if it's already the only one
  // open); shift/cmd-click adds or removes it for comparison.
  const handleSelectLeg = (legId: string, additive: boolean) => {
    let next: Set<string>;
    if (additive) {
      next = new Set(selectedLegIds);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
    } else {
      next = chapterLegId === legId ? new Set() : new Set([legId]);
    }
    applyLegSelection(next);
  };

  const clearLegs = () => applyLegSelection(new Set());
  const openChapter = (legId: string) => applyLegSelection(new Set([legId]));

  const closeShow = () => {
    setSelectedShowId(null);
    if (scoped) moveCamera({ kind: 'legs', legIds: [...selectedLegIds] });
  };

  const handleScrub = (day: number) => {
    setPlaying(false);
    setTimeDays(Math.max(range[0], Math.min(range[1], day)));
  };

  const handleTogglePlay = () => {
    if (!playing && (timeDays >= range[1] - 0.01 || timeDays < range[0])) setTimeDays(range[0]);
    setPlaying((p) => !p);
  };

  // Make sure a selected show is on the map: the timeline must have reached it.
  const revealShow = (showId: string) => {
    const show = showById.get(showId);
    if (show) setTimeDays((d) => Math.max(d, dayOf(show.date)));
  };

  // Dot clicks: open the panel on the venue's show in the open tour (or its
  // first show), no camera move.
  const handleSelectVenue = (venueId: string) => {
    setPlaying(false);
    const dot = venueDots.find((d) => d.venue.id === venueId);
    if (!dot) return;
    const show = dot.shows.find((s) => activeLegIds.has(s.legId)) ?? dot.shows[0];
    setSelectedShowId(show.id);
  };

  // Stepper, run-list, and list-view clicks: select and fly there. A show
  // outside the open tour switches the chapter to that show's tour.
  const handleNavigateToShow = (showId: string) => {
    const show = showById.get(showId);
    if (!show) return;
    setPlaying(false);
    if (scoped && !selectedLegIds.has(show.legId)) {
      setSelectedLegIds(new Set([show.legId]));
    }
    setSelectedShowId(showId);
    revealShow(showId);
    setView('map');
    moveCamera({ kind: 'venue', venueId: show.venueId });
  };

  const handleOpenPhotos = (photos: Photo[], index: number) => {
    setPlaying(false);
    setLightbox({ photos, index });
  };

  // One Escape handler for the whole app, so a press closes only the topmost
  // layer: photo viewer, then show, then tour chapter.
  // The listener is attached once and reads the latest state through a ref, so
  // it can't be detached mid-dispatch by a re-render.
  const escapeRef = useRef<() => void>(() => {});
  escapeRef.current = () => {
    if (lightbox) setLightbox(null);
    else if (selectedShowId) closeShow();
    else if (scoped) clearLegs();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') escapeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The chapter's "you are here": last show the playhead has reached.
  const chapterRoute = chapterLegId ? legRoutes.find((r) => r.leg.id === chapterLegId) : undefined;
  const playheadShowId =
    chapterRoute?.shows.filter((s) => dayOf(s.date) <= timeDays).at(-1)?.id ?? null;

  const statsLegIds = scoped ? selectedLegIds : undefined;
  const odometerMiles = useOdometer(milesAt(timeDays, statsLegIds));
  const panelOpen = view === 'map' && (!!selectedVenueId || !!chapterLegId);

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
            <span className="stat-value">{showsPlayedAt(timeDays, statsLegIds)}</span>
            <span className="stat-label">shows</span>
          </div>
          <div className="stat">
            <span className="stat-value">{Math.round(odometerMiles).toLocaleString('en-US')}</span>
            <span className="stat-label">est. miles</span>
          </div>
        </div>
      </header>

      <LegRail selectedLegIds={selectedLegIds} onSelect={handleSelectLeg} onClear={clearLegs} />

      <main className={view === 'list' ? 'stage stage--list' : 'stage'}>
        {view === 'map' ? (
          <MapCanvas
            activeLegIds={activeLegIds}
            timeDays={timeDays}
            selectedVenueId={selectedVenueId}
            onSelectVenue={handleSelectVenue}
            onOpenPhotos={handleOpenPhotos}
            camera={camera}
            panelOpen={panelOpen}
          />
        ) : (
          <ListView activeLegIds={activeLegIds} onSelectShow={handleNavigateToShow} />
        )}
        {view === 'map' && selectedVenueId && (
          <DetailPanel
            venueId={selectedVenueId}
            selectedShowId={selectedShowId}
            onClose={closeShow}
            onSelectShow={handleNavigateToShow}
            onOpenPhotos={handleOpenPhotos}
            onOpenChapter={openChapter}
          />
        )}
        {view === 'map' && !selectedVenueId && chapterLegId && (
          <ChapterPanel
            key={chapterLegId}
            legId={chapterLegId}
            currentShowId={playheadShowId}
            onClose={clearLegs}
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
          range={range}
          activeLegIds={activeLegIds}
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
