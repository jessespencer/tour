# Build: Interactive touring history map

## What this is

A personal archive. Every show I've played as a touring drummer, plotted on a map of the US, connected by a drawn route line. One color per tour leg. Photos attached to the shows I have them for. Filterable by leg, scrubbable through time.

This is not a booking tool, a fan site, or a promo page. It's a record — the kind of thing I'd send to someone who asked "wait, you toured?" and want them to lose twenty minutes in.

Reference for structure: `https://lagataperduda.com/en/mapa`. What I like there is the persistent filter rail plus explorable canvas plus drill-in detail. Do not copy its visual style.

## Stack

- Vite + React + TypeScript
- D3 (`d3-geo`, `d3-scale`, `d3-selection`, `d3-zoom`, `d3-shape`) for the map and route rendering
- `us-atlas` TopoJSON for the country and state outlines
- No map tile provider, no API keys, no backend, no database
- Deploy target is static files

Coordinates are committed to the repo as data. Geocode once during setup, hardcode the results. Nothing gets geocoded at runtime.

## Data model

```ts
type ShowType =
  | 'support'      // opening on someone else's tour
  | 'headline'     // our own show
  | 'festival'
  | 'radio'        // station visit, lounge performance, radio show
  | 'in-store'
  | 'tv'
  | 'webcast'
  | 'private'      // corporate, wedding, industry showcase
  | 'rehearsal';   // not a show, but part of the routing

interface Leg {
  id: string;
  name: string;             // "Matchbox Twenty — North Tour"
  shortName: string;        // "MB20" — for the filter rail
  artist: string;           // who I was playing for
  billing?: string;         // who we supported, if applicable
  startDate: string;        // ISO
  endDate: string;
  color: string;            // hex, from the palette below
  note?: string;            // one line of context
}

interface Venue {
  id: string;
  name: string;
  city: string;
  state: string;            // two-letter
  lat: number;
  lng: number;
  capacity?: number;
  address?: string;
}

interface Show {
  id: string;
  legId: string;
  venueId: string;
  date: string;             // ISO
  type: ShowType;
  doors?: string;           // "18:30"
  setTime?: string;
  setLength?: string;       // "30 min"
  note?: string;            // "Record Store Day", "hometown show"
  photos?: string[];        // filenames, relative to /public/photos/{showId}/
  confirmed: boolean;       // false = in the record but unverified
}
```

Three flat files: `src/data/legs.ts`, `src/data/venues.ts`, `src/data/shows.ts`. Plain exported arrays. Editing this archive should mean editing an array, not running a script.

Multiple shows can share a date (Record Store Day 2013: an in-store and a theatre show, same city, same day). Multiple shows can share a venue across different legs — Sands Bethlehem appears twice, years apart. The Varsity Theater in Minneapolis appears in both 2013 and 2014. Handle repeat venues by clustering, not by drawing two dots on top of each other.

## Seed data

I'll drop in a chronology document with the 2013–14 data: six legs, roughly 65 shows, venues and dates verified against original tour itineraries and day sheets. Some venues are still blank — those shows exist and should render, with the venue name reading as unknown rather than being dropped.

Build the schema to hold everything. I'm still documenting earlier and later years.

## Layout

Desktop:

```
┌──────────────────────────────────────────────────────┐
│  header — title, year range, total shows / miles     │
├────────────┬─────────────────────────────────────────┤
│            │                                         │
│  LEG RAIL  │            MAP CANVAS                   │
│            │                                         │
│  ▢ swatch  │        (route lines + venue dots)       │
│    name    │                                         │
│    dates   │                                         │
│    n shows │                                         │
│            │                                         │
│  ▢ ...     │                                         │
│            │                                         │
├────────────┴─────────────────────────────────────────┤
│  TIMELINE SCRUBBER                                   │
└──────────────────────────────────────────────────────┘
```

Detail opens as a panel sliding over the right side of the canvas — the map stays visible and stays interactive behind it.

## Interactions

**Leg filter.** Toggles in the rail, multi-select, all on by default. Deselecting a leg fades its route to near-transparent rather than removing it — the shape of the whole history should stay legible even while focused on one run. Show a count per leg.

**Timeline scrubber.** Horizontal, spanning the full date range of the data. Two behaviors:
- Drag the handle: routes draw progressively up to that date. Everything after is hidden.
- Play button: animates forward at a readable pace, roughly 8–12 seconds for a full year. Pause on any interaction.

The scrubber is the primary way someone experiences this. It should feel good to drag — no jank, no layout shift, no debounce lag.

**Venue interaction.** Hover reveals a small label with venue, city, date. Click opens the detail panel: full venue name and address, date, leg, billing, doors and set time and capacity where known, and the photo grid.

**Zoom and pan.** `d3.zoom` on the canvas, constrained to reasonable bounds. Dots and line weights scale inversely so they stay readable when zoomed in — the Northeast run is dense and needs it.

**Route drawing.** Consecutive shows within a leg connect in date order. Use gentle quadratic curves rather than straight lines, with the control point offset perpendicular to the segment — this separates overlapping segments on out-and-back routing and reads as hand-drawn rather than machine-plotted. Legs do not connect to each other.

## Visual direction

The subject world here is road atlases, day sheets, and highway signage. Not concert posters, not music-industry gloss.

**Palette** — leg colors are drawn from actual US highway sign color standards, which is why they're distinguishable and why they belong here:

```
--paper:        #E9EAE4   /* ground — cool map-paper grey-green */
--ink:          #1B1F1D   /* country outline, type */
--state-line:   #C9CCC2   /* hairline state borders */
--muted:        #7C8078   /* secondary type, inactive states */

--leg-1: #1F4E9C   /* interstate blue */
--leg-2: #1D6B45   /* guide-sign green */
--leg-3: #C25B12   /* warning orange */
--leg-4: #A62639   /* crimson */
--leg-5: #5C3D8C   /* toll-facility purple */
--leg-6: #6B4C2A   /* recreational-area brown */
```

**Type.** Three roles. A condensed grotesk for the display line and leg names. A neutral sans for body copy in the detail panel. A monospace for every piece of data — dates, times, capacities, mileage. The mono is doing real work: tour itineraries and day sheets are monospaced documents, and using it for data instead of decoration is what makes the archive feel like an archive. Pick faces with actual character; don't default to system stacks.

**Map rendering.** State borders at hairline weight, no fills. Country outline slightly heavier. No labels, no roads, no cities except where a venue sits. The map is a substrate, not the subject.

**Signature element — the odometer.** As the timeline scrubs forward, a running mileage total climbs in the header. Miles driven is the honest unit of touring, and watching it accumulate is the emotional payload of the whole piece. Compute great-circle distance between consecutive shows within a leg, multiply by 1.18 to approximate road distance, and label it `est. miles` — do not present an approximation as exact. Set the digits in the mono face and animate them counting rather than jumping.

Spend the boldness there. Everything else stays quiet.

**Motion.** The route draw-on and the odometer are the two animated things. Hover states are instant. No page-load choreography, no scroll effects, no parallax. Respect `prefers-reduced-motion` by rendering final state immediately and making the scrubber drag-only.

## Photos

Stored at `/public/photos/{showId}/`, referenced by filename in the show record. Lazy-load; never load a full-resolution image into the detail panel thumbnail grid. Click a thumbnail for a lightbox with keyboard navigation and escape-to-close.

Most shows have no photos. That's the normal case, not an error state — a show without photos shows its data cleanly with no empty frame, no placeholder, no "no photos available" message.

## Mobile

Do not gate this to desktop. Build a real mobile view:

- Map occupies the top ~55vh, still pannable and zoomable
- Leg filter becomes a horizontally scrolling chip row directly beneath the map
- Scrubber sits below that, full width, with a larger touch target
- Detail opens as a bottom sheet, not a side panel
- Add a list-view toggle — on a phone, reading the run as a chronological list is sometimes the better experience, and the data is already there

## Quality floor

Keyboard navigable throughout, with visible focus rings. Venue dots reachable by tab in date order. Semantic HTML in the detail panel. Alt text on photos derived from venue, city, and date. Reduced motion respected. No layout shift on scrub.

## Build order

1. Data files and types, with the 2013–14 seed data and geocoded coordinates
2. Static map — country and states rendering, venue dots plotted, correct projection and bounds
3. Route lines with per-leg color, drawn in date order
4. Leg filter rail
5. Timeline scrubber with progressive draw
6. Detail panel
7. Odometer
8. Photo grid and lightbox
9. Mobile layout
10. Accessibility pass
11. Photo pipeline, meta tags, and deploy config

Get 1 through 3 working and let me look at it before building further. The projection and route curve are the two things most likely to need adjustment by eye, and everything downstream depends on them.

## Publishing

This will be deployed publicly and shared with former bandmates. That shapes a few things.

**No personal contact data, ever.** The source itinerary spreadsheets contain promoter names, cell phone numbers, and personal email addresses for venue staff and label reps. None of it goes into the repo — not in data files, not in comments, not in a commit that gets amended later. Git history is permanent. Doors, set times, capacities, venue addresses, and billing language are all fine.

**Host on Cloudflare Pages.** Serves from root, so no base-path configuration. If GitHub Pages is used instead, set `base` in `vite.config.ts` to the repo name and be aware that Git LFS files are not served — which rules out storing a photo archive in the repo.

**Photo pipeline.** Build-time image processing, not raw uploads:
- Generate WebP at two widths — roughly 400px for thumbnails, 1600px for the lightbox
- Keep an original as fallback but never reference it from the page
- `loading="lazy"` on the grid, preload only the lightbox image actually opened
- Target under 150KB for thumbnails and under 500KB for lightbox images
- Strip EXIF on output — location data in photo metadata is a privacy leak, and camera roll images often carry GPS coordinates

**Not indexed by default.** Add `<meta name="robots" content="noindex">` and a `robots.txt` disallow. Removing them later is one line each. This makes it safe to share the link before every person appearing in a photo has been asked.

**Open Graph tags.** The link will get pasted into group texts and previewed. Set title, description, and a static share image — a rendered view of the full map reads better than a logo.

**A way to send corrections.** Bandmates will remember shows differently and some of them have photos. A `mailto:` link in the footer is enough; no form, no backend.


- No CMS, no admin UI. I edit the data files directly.
- No analytics, no tracking, no cookie banner.
- No auto-geocoding at runtime.
- No audio.
- No AI features of any kind.
