import { useState } from 'react';
import { LegRail } from './components/LegRail';
import { MapCanvas } from './components/MapCanvas';
import { legs } from './data/legs';
import { totals } from './lib/derive';

export function App() {
  const [activeLegIds, setActiveLegIds] = useState<Set<string>>(
    () => new Set(legs.map((l) => l.id)),
  );

  const toggleLeg = (legId: string) => {
    setActiveLegIds((prev) => {
      const next = new Set(prev);
      if (next.has(legId)) next.delete(legId);
      else next.add(legId);
      return next;
    });
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-lockup">
          <h1 className="header-title">Every Show</h1>
          <p className="header-sub">Drums for Matt Hires · 2013–2014</p>
        </div>
        <div className="header-stats">
          <div className="stat">
            <span className="stat-value">{totals.shows}</span>
            <span className="stat-label">shows</span>
          </div>
          <div className="stat">
            <span className="stat-value">{totals.miles.toLocaleString('en-US')}</span>
            <span className="stat-label">est. miles</span>
          </div>
        </div>
      </header>

      <LegRail activeLegIds={activeLegIds} onToggle={toggleLeg} />

      <main className="stage">
        <MapCanvas activeLegIds={activeLegIds} />
      </main>

      <footer className="footer">
        <span>Dates & venues verified against original tour itineraries and day sheets</span>
        <a href="mailto:jessespencerw@gmail.com?subject=Tour%20map%20correction">
          Remember it differently? Send a correction
        </a>
      </footer>
    </div>
  );
}
