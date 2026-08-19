#!/usr/bin/env python3
"""Extract OSM streets around every venue and GPS photo spot via Overpass.

One-time build step (like geocoding): downloads street centerlines in two
rings around each spot —

  near ring (venue 3 km / photo 2 km) — every drivable class down to
      residential/living_street
  far ring  (venue 10 km / photo 6 km) — arterials only
      (motorway/trunk/primary/secondary/tertiary + links)

so the residential grid fades out into a still-present arterial network
instead of a hard cutoff. Ways are deduped and written as lon/lat polylines
under public/streets/ in ~0.5° regional chunks:

  public/streets/index.json   — chunk ids + lon/lat bounds, plus every spot's
                                center and fade radius (the app masks street
                                edges with radial fades built from these)
  public/streets/<id>.json    — {major, minor} polylines for one chunk

The app fetches the index at moderate zoom and pulls only chunks near the
viewport at street zoom. No runtime API calls, no keys — rerun this script
only when venues are added.

Usage: python3 scripts/import-streets.py
"""

import json
import math
import os
import re
import shutil
import sys
import time
import urllib.parse
import urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OVERPASS = "https://overpass-api.de/api/interpreter"

NEAR_VENUE = 3000
NEAR_PHOTO = 2000
FAR_VENUE = 10000
FAR_PHOTO = 6000
BLDG_VENUE = 1000  # building footprints — tight ring, they're heavy
BLDG_PHOTO = 600
BATCH = 3
CELL_DEG = 0.5

NEAR_RE = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|"
    "secondary|secondary_link|tertiary|tertiary_link|residential|"
    "unclassified|living_street"
)
FAR_RE = (
    "motorway|motorway_link|trunk|trunk_link|primary|primary_link|"
    "secondary|secondary_link|tertiary|tertiary_link"
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
    spots = []  # (lat, lng, near_r, far_r, bldg_r)
    for m in re.finditer(r"lat: ([-\d.]+),\s*lng: ([-\d.]+)", read(f"{REPO}/src/data/venues.ts")):
        spots.append((float(m.group(1)), float(m.group(2)), NEAR_VENUE, FAR_VENUE, BLDG_VENUE))
    n_venues = len(spots)

    photos_ts = f"{REPO}/src/data/photos.ts"
    if os.path.exists(photos_ts):
        for m in re.finditer(r"lat: ([-\d.]+), lng: ([-\d.]+)", read(photos_ts)):
            lat, lng = float(m.group(1)), float(m.group(2))
            if all(miles(lat, lng, s[0], s[1]) > 0.9 for s in spots):
                spots.append((lat, lng, NEAR_PHOTO, FAR_PHOTO, BLDG_PHOTO))
    print(f"{n_venues} venues + {len(spots) - n_venues} standalone photo spots")

    ways = {}  # id -> (tier, name|None, [[lng,lat], ...])
    bldgs = {}  # id -> [[lng,lat], ...] footprint ring
    for i in range(0, len(spots), BATCH):
        batch = spots[i:i + BATCH]
        clauses = "".join(
            f'way["highway"~"^({NEAR_RE})$"](around:{nr},{lat:.5f},{lng:.5f});'
            f'way["highway"~"^({FAR_RE})$"](around:{fr},{lat:.5f},{lng:.5f});'
            f'way["building"](around:{br},{lat:.5f},{lng:.5f});'
            for lat, lng, nr, fr, br in batch
        )
        query = f"[out:json][timeout:300];({clauses});out geom;"
        req = urllib.request.Request(
            OVERPASS,
            data=("data=" + urllib.parse.quote(query)).encode(),
            headers={"User-Agent": "tour-archive-street-import (personal project)"},
        )
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=360) as resp:
                    data = json.load(resp)
                break
            except Exception as e:
                if attempt == 3:
                    sys.exit(f"overpass failed on batch {i // BATCH + 1}: {e}")
                print(f"  retry batch {i // BATCH + 1} ({e})")
                time.sleep(20)
        for el in data.get("elements", []):
            if el.get("type") != "way" or "geometry" not in el:
                continue
            tags = el.get("tags", {})
            coords = [[round(g["lon"], 5), round(g["lat"], 5)] for g in el["geometry"]]
            if "building" in tags:
                bldgs[el["id"]] = coords
            else:
                hw = tags.get("highway", "")
                tier = "major" if hw in MAJOR else "minor"
                ways[el["id"]] = (tier, tags.get("name"), coords)
        print(f"  batch {i // BATCH + 1}/{(len(spots) + BATCH - 1) // BATCH}: "
              f"{len(ways)} ways, {len(bldgs)} buildings")
        time.sleep(3)

    # Bucket everything into ~0.5° regional chunks keyed by first coordinate.
    def chunk_for(chunks, coords):
        lng0, lat0 = coords[0]
        cid = f"{math.floor(lng0 / CELL_DEG)}_{math.floor(lat0 / CELL_DEG)}"
        c = chunks.setdefault(
            cid, {"major": [], "minor": [], "bldg": [], "bounds": [180, 90, -180, -90]}
        )
        b = c["bounds"]
        for lng, lat in coords:
            if lng < b[0]: b[0] = lng
            if lat < b[1]: b[1] = lat
            if lng > b[2]: b[2] = lng
            if lat > b[3]: b[3] = lat
        return c

    chunks = {}
    for tier, name, coords in ways.values():
        entry = {"c": coords}
        if name:
            entry["n"] = name
        chunk_for(chunks, coords)[tier].append(entry)
    for coords in bldgs.values():
        chunk_for(chunks, coords)["bldg"].append(coords)

    out_dir = f"{REPO}/public/streets"
    shutil.rmtree(out_dir, ignore_errors=True)
    os.makedirs(out_dir)
    total = 0
    for cid, c in chunks.items():
        path = f"{out_dir}/{cid}.json"
        with open(path, "w") as f:
            json.dump(
                {"major": c["major"], "minor": c["minor"], "bldg": c["bldg"]},
                f, separators=(",", ":"),
            )
        total += os.path.getsize(path)

    index = {
        "chunks": [{"id": cid, "b": c["bounds"]} for cid, c in chunks.items()],
        # spot centers + near/far/building radii (meters) — the app fades each
        # layer at its own ring: minors at near, arterials at far, footprints at bldg
        "spots": [[round(lng, 5), round(lat, 5), nr, fr, br] for lat, lng, nr, fr, br in spots],
    }
    with open(f"{out_dir}/index.json", "w") as f:
        json.dump(index, f, separators=(",", ":"))

    legacy = f"{REPO}/public/streets.json"
    if os.path.exists(legacy):
        os.remove(legacy)

    n_pts = sum(len(c) for _t, _n, c in ways.values()) + sum(len(c) for c in bldgs.values())
    print(f"wrote {out_dir}: {len(chunks)} chunks, {len(ways)} ways + {len(bldgs)} buildings, "
          f"{n_pts} points, {total / 1e6:.1f} MB total")


if __name__ == "__main__":
    main()
