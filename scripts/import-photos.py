#!/usr/bin/env python3
"""Import tour photos & videos: assign to shows, resize, emit src/data/photos.ts.

Assignment rules, in order:
  1. File lives in a subfolder named after a tour city -> that city's show
  2. GPS within 25 mi of a venue on the target leg -> that venue's show
     (filename twins like `X.jpg` / `X-1.jpg` share the GPS of their sibling)
  3. Otherwise nearest show by date; ties go to the LATER show (touring moves
     forward — off-day files belong to the journey toward the next city)

Capture time comes from the `YYYY-MM-DD HH.MM.SS` filename when present,
falling back to Spotlight's content-creation date (GoPro/DSLR files).
scripts/photo-overrides.json supplies manual corrections (keyed by path
relative to the source folder) for cameras with unset clocks — override
takenAt and/or showId there; they win over every automatic rule.

Outputs:
  - public/photos/{showId}/{stem}_t.jpg + _l.jpg  (400/1600px derivatives;
    for videos these are poster frames via qlmanage)
  - public/videos/{showId}/{stem}.mov             (plain copies — gitignored,
    local-only; too large for the remote)
  - src/data/photos.ts

Usage: python3 scripts/import-photos.py "<source folder>" <legId>
"""

import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import date

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GPS_VENUE_MILES = 25
THUMB_PX = 400
LIGHTBOX_PX = 1600

NAME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2})\.(\d{2})\.(\d{2})(-\d+)?\.(jpe?g|png|mov)$", re.I)
MDLS_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})")


def read(path):
    with open(path) as f:
        return f.read()


def mdls(path, attr):
    out = subprocess.run(
        ["mdls", "-raw", "-name", attr, path], capture_output=True, text=True
    ).stdout.strip()
    return None if out in ("(null)", "") else out


def is_vsco(path):
    with open(path, "rb") as f:
        return b"VSCO" in f.read(262144)


def miles(a, b, c, d):
    h = (
        math.sin(math.radians(c - a) / 2) ** 2
        + math.cos(math.radians(a)) * math.cos(math.radians(c)) * math.sin(math.radians(d - b) / 2) ** 2
    )
    return 2 * 3958.8 * math.asin(math.sqrt(h))


def poster_from_video(video_path, out_large, out_thumb):
    """Render a poster frame for a .mov via Quick Look, then resize with sips."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(
            ["qlmanage", "-t", "-s", str(LIGHTBOX_PX), "-o", tmp, video_path],
            capture_output=True,
        )
        png = os.path.join(tmp, os.path.basename(video_path) + ".png")
        if not os.path.exists(png):
            return False
        for size, out in ((LIGHTBOX_PX, out_large), (THUMB_PX, out_thumb)):
            subprocess.run(
                ["sips", "-Z", str(size), "-s", "format", "jpeg",
                 "-s", "formatOptions", "75", png, "--out", out],
                capture_output=True, check=True,
            )
    return True


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src_dir, leg_id = sys.argv[1], sys.argv[2]

    venues = {}
    venue_city = {}
    vtext = read(f"{REPO}/src/data/venues.ts")
    for m in re.finditer(
        r"id: '([^']+)',.*?city: (?:'([^']+)'|\"([^\"]+)\"),.*?lat: ([-\d.]+),\s*lng: ([-\d.]+)",
        vtext, re.S,
    ):
        vid = m.group(1)
        venues[vid] = (float(m.group(4)), float(m.group(5)))
        venue_city[vid] = (m.group(2) or m.group(3)).lower()

    shows = []  # (showId, venueId, date)
    for m in re.finditer(
        r"\{ id: '([^']+)', legId: '%s', venueId: '([^']+)', date: '([^']+)'" % re.escape(leg_id),
        read(f"{REPO}/src/data/shows.ts"),
    ):
        shows.append((m.group(1), m.group(2), date.fromisoformat(m.group(3))))
    if not shows:
        sys.exit(f"no shows found for leg {leg_id}")

    def show_for_city(city):
        for s in shows:
            if venue_city.get(s[1]) == city.lower():
                return s
        return None

    overrides_path = os.path.join(REPO, "scripts", "photo-overrides.json")
    overrides = {}
    if os.path.exists(overrides_path):
        overrides = {k: v for k, v in json.load(open(overrides_path)).items() if k != "//"}

    entries = []
    skipped = []
    for root, _dirs, files in os.walk(src_dir):
        depth = os.path.relpath(root, src_dir)
        if depth != "." and os.sep in depth:
            continue  # one level of subfolders only
        folder_show = None if depth == "." else show_for_city(depth)
        if depth != "." and folder_show is None:
            skipped.append(f"{depth}/ (no {leg_id} show in a city by that name)")
            continue
        for fname in sorted(files):
            path = os.path.join(root, fname)
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
            if ext not in ("jpg", "jpeg", "png", "mov"):
                skipped.append(fname)
                continue
            rel = os.path.relpath(path, src_dir)
            override = overrides.get(rel)
            m = NAME_RE.match(fname)
            if override and "takenAt" in override:
                y, mo, d = override["takenAt"][0:4], override["takenAt"][5:7], override["takenAt"][8:10]
                hh, mi, ss = override["takenAt"][11:13], override["takenAt"][14:16], override["takenAt"][17:19]
                slug = re.sub(r"[^a-z0-9]+", "", fname.rsplit(".", 1)[0].lower())
                stem = f"{y}{mo}{d}-{hh}{mi}{ss}-{slug}"
                twin_key = stem
            elif m:
                y, mo, d, hh, mi, ss, suffix, _ = m.groups()
                stem = f"{y}{mo}{d}-{hh}{mi}{ss}" + (suffix or "")
                twin_key = f"{y}-{mo}-{d} {hh}.{mi}.{ss}"
            else:
                created = mdls(path, "kMDItemContentCreationDate")
                dm = MDLS_DATE_RE.match(created or "")
                if not dm:
                    skipped.append(f"{fname} (no timestamp in name or metadata)")
                    continue
                y, mo, d, hh, mi, ss = dm.groups()
                slug = re.sub(r"[^a-z0-9]+", "", fname.rsplit(".", 1)[0].lower())
                stem = f"{y}{mo}{d}-{hh}{mi}{ss}-{slug}"
                twin_key = stem
            lat = mdls(path, "kMDItemLatitude")
            lng = mdls(path, "kMDItemLongitude")
            entries.append({
                "path": path,
                "stem": stem,
                "twin_key": twin_key,
                "date": date(int(y), int(mo), int(d)),
                "taken": f"{y}-{mo}-{d}T{hh}:{mi}:{ss}",
                "lat": float(lat) if lat else None,
                "lng": float(lng) if lng else None,
                "camera": mdls(path, "kMDItemAcquisitionModel"),
                "vsco": ext != "mov" and is_vsco(path),
                "video": ext == "mov",
                "forced": folder_show,
                "override_show": override.get("showId") if override else None,
            })

    gps_by_twin = {e["twin_key"]: (e["lat"], e["lng"]) for e in entries if e["lat"] is not None}

    for e in entries:
        if e["override_show"]:
            e["showId"] = e["override_show"]
            continue
        if e["forced"]:
            e["showId"] = e["forced"][0]
            continue
        glat, glng = (e["lat"], e["lng"])
        if glat is None and e["twin_key"] in gps_by_twin:
            glat, glng = gps_by_twin[e["twin_key"]]
        assigned = None
        if glat is not None:
            near = min(shows, key=lambda s: miles(glat, glng, *venues[s[1]]))
            if miles(glat, glng, *venues[near[1]]) <= GPS_VENUE_MILES:
                assigned = near
        if assigned is None:
            best = min(abs((s[2] - e["date"]).days) for s in shows)
            assigned = [s for s in shows if abs((s[2] - e["date"]).days) == best][-1]
        e["showId"] = assigned[0]

    no_poster = []
    for e in entries:
        photo_dir = f"{REPO}/public/photos/{e['showId']}"
        os.makedirs(photo_dir, exist_ok=True)
        thumb = f"{photo_dir}/{e['stem']}_t.jpg"
        large = f"{photo_dir}/{e['stem']}_l.jpg"
        if e["video"]:
            video_dir = f"{REPO}/public/videos/{e['showId']}"
            os.makedirs(video_dir, exist_ok=True)
            dest = f"{video_dir}/{e['stem']}.mov"
            if not os.path.exists(dest):
                shutil.copy2(e["path"], dest)
            if not (os.path.exists(thumb) and os.path.exists(large)):
                if not poster_from_video(e["path"], large, thumb):
                    no_poster.append(e["stem"])
        else:
            for size, out in ((THUMB_PX, thumb), (LIGHTBOX_PX, large)):
                if not os.path.exists(out):
                    subprocess.run(
                        ["sips", "-Z", str(size), "-s", "format", "jpeg",
                         "-s", "formatOptions", "75", e["path"], "--out", out],
                        capture_output=True, check=True,
                    )

    entries.sort(key=lambda e: e["taken"])
    lines = [
        "import type { Photo } from '../types';",
        "",
        "// Generated by scripts/import-photos.py — safe to hand-edit assignments.",
        "export const photos: Photo[] = [",
    ]
    for e in entries:
        parts = [
            f"id: '{e['stem']}'",
            f"showId: '{e['showId']}'",
            f"takenAt: '{e['taken']}'",
        ]
        if e["video"]:
            parts.append("kind: 'video'")
        if e["lat"] is not None:
            parts.append(f"lat: {e['lat']:.6f}")
            parts.append(f"lng: {e['lng']:.6f}")
        if e["camera"]:
            parts.append(f"camera: '{e['camera']}'")
        if e["vsco"]:
            parts.append("vsco: true")
        lines.append("  { " + ", ".join(parts) + " },")
    lines += ["];", ""]
    with open(f"{REPO}/src/data/photos.ts", "w") as f:
        f.write("\n".join(lines))

    with_gps = sum(1 for e in entries if e["lat"] is not None)
    n_video = sum(1 for e in entries if e["video"])
    print(f"imported {len(entries)} files ({with_gps} with GPS, {n_video} videos) "
          f"across {len({e['showId'] for e in entries})} shows")
    for s in shows:
        n = sum(1 for e in entries if e["showId"] == s[0])
        if n:
            print(f"  {s[2]}  {s[0]:28s} {n}")
    if no_poster:
        print("no poster frame for: " + ", ".join(no_poster))
    if skipped:
        print(f"skipped {len(skipped)}: " + ", ".join(skipped))


if __name__ == "__main__":
    main()
