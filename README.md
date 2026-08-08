# Every Show

A personal touring archive — every show played as a touring drummer (2013–2014,
drums for Matt Hires), plotted on a night-atlas map of the lower 48, connected
by route lines, one color per tour leg.

Static site: no backend, no database, no API keys, no tracking.

## Run

```sh
npm install
npm run dev      # local dev server
npm run build    # static build to dist/
```

## Editing the archive

The data is three plain arrays — edit them directly, no scripts:

- `src/data/legs.ts` — tour legs (name, dates, color)
- `src/data/venues.ts` — venues with hardcoded coordinates (geocode once, commit)
- `src/data/shows.ts` — shows joining a leg + venue + date

A venue with `name: ''` renders as "Venue TBD" at city coordinates. Never add
promoter/staff contact info to data files — git history is permanent.

## Deploy

Target is Cloudflare Pages serving `dist/` from root. The site ships
`noindex` + `robots.txt` disallow by default; remove both lines to go public.
