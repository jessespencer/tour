#!/usr/bin/env python3
"""Extract OSM streets around every venue and GPS photo spot via Overpass.

One-time build step (like geocoding): downloads street centerlines within
~2 km of each venue (1.5 km of standalone photo GPS spots), dedupes ways,
and writes public/streets.json as lon/lat polylines in two tiers:

  major — motorway/trunk/primary/secondary (+links)
  minor — tertiary/residential/unclassified

The app fetches this lazily at deep zoom and projects it through the same
Albers projection as everything else. No runtime API calls, no keys —
rerun this script only when venues are added.

Usage: python3 scripts/import-streets.py
"""

import json
import math
import os
import re
import sys
import time
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = "https://overpass-api.de/api/interpreter"

RADIUS_VENUE = 2000
RADIUS_PHOTO = 1500
BATCH = 6
HIGHWAY_RE = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|"
    "secondary|secondary_link|tertiary|residential|unclassified"
)
MAJOR = {
    "motorway", "motorway_link", "trunk", "trunk_link",
    "primary", "primary_link", "secondary", "secondary_link",
}


def read(path):
    with open(path) as f:
        return f.read()


def miles(a, b, c, d):
    h = (
        math.sin(math.radians(c - a) / 2) ** 2
        + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2
    )
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def main():
    spots = []  # (lat, lng, radius)
    for m in re.finditer(r"lat: ([-\d.]+),\s*lng: ([-\d.]+)", read(f"{REPO}/src/data/venues.ts")):
        spots.append((float(m.group(1)), float(m.group(2)), RADIUS_VENUE))
    n_venues = len(spots)

    photos_ts = f"{REPO}/src/data/photos.ts"
    if os.path.exists(photos_ts):
        for m in re.finditer(r"lat: ([-\d.]+), lng: ([-\d.]+)", read(photos_ts)):
            lat, lng = float(m.group(1)), float(m.group(2))
            if all(miles(lat, lng, s[0], s[1]) > 0.9 for s in spots):
                spots.append((lat, lng, RADIUS_PHOTO))
    print(f"{n_venues} venues + {len(spots) - n_venues} standalone photo spots")

    ways = {}  # id -> (tier, [[lng,lat], ...])
    for i in range(0, len(spots), BATCH):
        batch = spots[i:i + BATCH]
        clauses = "".join(
            f'way["highway"~"^({HIGHWAY_RE})$"](around:{r},{lat:.5f},{lng:.5f});'
            for lat, lng, r in batch
        )
        query = f"[out:json][timeout:180];({clauses});out geom;"
        req = urllib.request.Request(
            OVERPASS,
            data=("data=" + urllib.parse.quote(query)).encode(),
            headers={"User-Agent": "tour-archive-street-import (personal project)"},
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=240) as resp:
                    data = json.load(resp)
                break
            except Exception as e:
                if attempt == 2:
                    sys.exit(f"overpass failed on batch {i // BATCH + 1}: {e}")
                print(f"  retry batch {i // BATCH + 1} ({e})")
                time.sleep(15)
        for el in data.get("elements", []):
            if el.get("type") != "way" or "geometry" not in el:
                continue
            hw = el.get("tags", {}).get("highway", "")
            tier = "major" if hw in MAJOR else "minor"
            ways[el["id"]] = (tier, [[round(g["lon"], 5), round(g["lat"], 5)] for g in el["geometry"]])
        print(f"  batch {i // BATCH + 1}/{(len(spots) + BATCH - 1) // BATCH}: {len(ways)} ways total")
        time.sleep(2)

    out = {"major": [], "minor": []}
    for tier, coords in ways.values():
        out[tier].append(coords)
    dest = f"{REPO}/public/streets.json"
    with open(dest, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    size_mb = os.path.getsize(dest) / 1e6
    n_pts = sum(len(c) for t in out.values() for c in t)
    print(f"wrote {dest}: {len(out['major'])} major + {len(out['minor'])} minor ways, "
          f"{n_pts} points, {size_mb:.1f} MB")


if __name__ == "__main__":
    main()
