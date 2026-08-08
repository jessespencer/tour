# Tour Map

Interactive touring-history map. Vite + React + TS, D3 for geo/zoom only —
rendering is React-owned SVG. The full product brief lives outside the repo
(user-provided spec document); data conventions are in the README.

## Non-obvious constraints

- Basemap is `us-atlas/states-albers-10m.json` — **preprojected** to a 975×610
  viewport. Render it with an identity `geoPath()`; project venue lat/lngs with
  `geoAlbersUsa().scale(1300).translate([487.5, 305])` (in `src/lib/geo.ts`).
  The non-albers `states-10m.json` file is raw lon/lat — don't switch to it.
- Alaska/Hawaii/PR are filtered out by FIPS in `MapCanvas.tsx`; the viewBox is
  computed from lower-48 bounds, not the full 975×610.
- Route segments with projected length < 0.5px are skipped (same-venue
  consecutive shows). Mileage still counts them (as ~0).
- Shows sharing a date rely on array order in `shows.ts` for intra-day
  sequence — sorts must be stable (`sortShows` in `src/lib/geo.ts`).
- Leg colors live in `legs.ts` (data, not CSS) and are tuned for the dark
  ground; chrome colors are CSS variables in `src/index.css`.
- No personal contact data (promoters, phone numbers, emails) in the repo,
  ever — not even in amended commits.
