#!/usr/bin/env python3
"""VH3: offline, standard-library-only top-down probe comparison (not mesh replay).
Usage:
  python tools/vehicle-deformation/compare_capture.py baseline.csv damaged.csv --out comparison.svg
The input files must share capture_id, model and handle.
"""
import argparse
import csv
import html
import math
from pathlib import Path


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as stream:
        rows = list(csv.DictReader(stream))
    if len(rows) != 48 or len({row["index"] for row in rows}) != 48:
        raise ValueError(f"{path}: expected exactly 48 indexed probes")
    indices = [int(r["index"]) for r in rows]
    if sorted(indices) != list(range(48)):
        raise ValueError(f"{path}: probes must be numbered 0..47")
    rows.sort(key=lambda r: int(r["index"]))
    for field in ("capture_id", "model", "handle", "phase"):
        if len({row[field] for row in rows}) != 1:
            raise ValueError(f"{path}: inconsistent {field}")
    return rows


def num(row, key):
    return float(row[key]) if row[key] else math.nan


def is_valid(row):
    if row["valid"] != "1":
        return False
    return all(math.isfinite(num(row, key)) for key in ("dx", "dy", "dz", "magnitude"))


def svg_text(x, y, text, size=13, color="#d5edf0"):
    return (f'<text x="{x:.1f}" y="{y:.1f}" fill="{color}" '
            f'font-size="{size}" font-family="Arial,sans-serif">'
            f'{html.escape(str(text))}</text>')


def compare(before, after):
    first = load(before)
    second = load(after)
    for key in ("capture_id", "handle", "model"):
        if first[0][key] != second[0][key]:
            raise ValueError(f"Baseline and damaged capture differ in {key}")
    if first[0]["phase"] != "baseline" or second[0]["phase"] != "damaged":
        raise ValueError("Provide baseline CSV first, damaged CSV second")
    for a, b in zip(first, second):
        if a["region"] != b["region"]:
            raise ValueError("Probe region mismatch")
        for key in ("sample_x", "sample_y", "sample_z"):
            if abs(num(a, key) - num(b, key)) > 0.001:
                raise ValueError("Model sample positions changed")
    return first, second


def render(before, after):
    a, b = compare(before, after)
    bounds = [num(b[0], k) for k in
              ("min_x", "min_y", "min_z", "max_x", "max_y", "max_z")]
    minx, miny, _, maxx, maxy, _ = bounds
    if any(not math.isfinite(v) for v in bounds):
        raise ValueError("Missing model dimensions")
    width = maxx-minx
    length = maxy-miny
    if not (0.8 <= width <= 6 and 1.5 <= length <= 18):
        raise ValueError("Invalid model dimensions")
    def xy(p):
        return 70+(num(p, "sample_x")-minx)*370/width, 78+(maxy-num(p, "sample_y"))*550/length
    def disp(row):
        return tuple(num(row, key) for key in ("dx", "dy", "dz"))
    lines = ['<svg xmlns="http://www.w3.org/2000/svg" width="800" height="710" '
             'viewBox="0 0 800 710">',
             '<rect width="800" height="710" fill="#081820"/>',
             '<rect x="62" y="70" width="386" height="564" rx="80" '
             'fill="#17404a" stroke="#4bb5c8" stroke-width="2"/>']
    lines.append(svg_text(480, 65, "VH3 | DEFORMATION CENSUS", 19))
    lines.append(svg_text(480, 98, b[0]["model"] + " / " + b[0]["capture_id"], 12))
    lines.append(svg_text(480, 143, "FRONT / +Y", 14))
    lines.append(svg_text(480, 170, "Colors: change in displacement", 13))
    for i, (baseline, damaged) in enumerate(zip(a,b)):
        x,y=xy(damaged)
        if is_valid(baseline) and is_valid(damaged):
            delta=tuple(v2-v1 for v1,v2 in zip(disp(baseline),disp(damaged)))
            mag=math.sqrt(sum(v*v for v in delta))
            color = "#ff655b" if mag>=0.15 else "#ffc17f" if mag>=0.05 else "#4dd2cf"
            lines.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5" fill="{color}"/>')
            # Delta arrows are diagrammatically magnified, not to world scale.
            ex=x+delta[0]*37
            ey=y-delta[1]*37
            lines.append(f'<line x1="{x:.2f}" y1="{y:.2f}" '
                         f'x2="{ex:.2f}" y2="{ey:.2f}" stroke="{color}" stroke-width="2"/>')
        else:
            lines.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="5" '
                         'fill="#757c85" stroke="#b6bec7"/>')
    known = [(a0,b0) for a0,b0 in zip(a,b) if is_valid(a0) and is_valid(b0)]
    varying = [math.sqrt(sum((v2-v1)**2 for v1,v2 in zip(disp(a0),disp(b0))))
               for a0,b0 in known]
    lines += [svg_text(480, 215, f"Comparable probes: {len(known)}/48", 16),
              svg_text(480, 242, f"Change >= 0.05: {sum(v>=0.05 for v in varying)}", 15),
              svg_text(480, 268, f"Change >= 0.15: {sum(v>=0.15 for v in varying)}", 15),
              svg_text(480, 312, "Teal: below threshold", 13, "#4dd2cf"),
              svg_text(480, 340, "Amber: 0.05-0.15", 13, "#ffc17f"),
              svg_text(480, 368, "Red: >= 0.15", 13, "#ff655b"),
              svg_text(480, 396, "Gray: unknown/error", 13, "#b6bec7"),
              svg_text(480, 449, "Displacement vectors are", 13),
              svg_text(480, 471, "magnified 37x for legibility", 13),
              svg_text(480, 512, "This is NOT a GTA mesh capture.", 13, "#ffc17f"),
              svg_text(480, 536, "Compare against screenshots.", 13),
              svg_text(480, 560, "Roof points overlap in top view.", 13)]
    lines.append('</svg>')
    return "\n".join(lines)+"\n",len(known),sum(v>=0.05 for v in varying)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path)
    parser.add_argument("damaged", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args=parser.parse_args()
    svg,valid,changed=render(args.baseline,args.damaged)
    args.out.write_text(svg,encoding="utf-8")
    print(f"SVG written: {args.out}; comparable probes {valid}/48, delta >=0.05: {changed}")
    if valid<36 or changed==0:
        print("Evidence insufficient for VH3-B. Check screenshots and native probe coverage.")
    else:
        print("Potentially useful deformation; verify spatial correlation in screenshots.")


if __name__=="__main__":
    main()
