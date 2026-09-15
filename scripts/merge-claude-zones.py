"""Union Rover sheets CSV zones with Claude's xlsx. Writes data/niche-zone-lists.json."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
SHEETS = ROOT / "data" / "usa-rank-and-rent-niches-sheets.csv"
CLAUDE = Path(r"c:\Users\pault\Downloads\Rover_Zones_Claude.xlsx")
OUT = ROOT / "data" / "niche-zone-lists.json"


def norm(label: object) -> str:
    return " ".join(str(label or "").strip().split())


def dedupe_append(dst: list[str], labels: list[str]) -> None:
    seen = {z.lower() for z in dst}
    for raw in labels:
        z = norm(raw)
        if not z:
            continue
        key = z.lower()
        if key in seen:
            continue
        seen.add(key)
        dst.append(z)


def rover_zones() -> dict[str, list[str]]:
    with SHEETS.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        zcols = [c for c in (reader.fieldnames or []) if c.startswith("zone_")]
        out: dict[str, list[str]] = {}
        for row in reader:
            niche = norm(row.get("niche"))
            if not niche:
                continue
            zones: list[str] = []
            dedupe_append(zones, [row.get(c) or "" for c in zcols])
            out[niche] = zones
        return out


def claude_zones() -> dict[str, list[str]]:
    wb = load_workbook(CLAUDE, data_only=True, read_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)
    headers = [norm(h) for h in next(rows)]
    ni = headers.index("niche")
    zi = [i for i, h in enumerate(headers) if h.lower().startswith("zone")]
    out: dict[str, list[str]] = {}
    for row in rows:
        if not row or ni >= len(row):
            continue
        niche = norm(row[ni])
        if not niche:
            continue
        zones: list[str] = []
        dedupe_append(zones, [row[i] if i < len(row) else "" for i in zi])
        if zones:
            out[niche] = zones
    return out


def main() -> None:
    rover = rover_zones()
    claude = claude_zones()
    if set(rover) != set(claude):
        missing = sorted(set(rover) ^ set(claude))
        raise SystemExit(f"Niche mismatch: {missing}")
    merged: dict[str, list[str]] = {}
    for niche in rover:
        zones: list[str] = []
        dedupe_append(zones, rover[niche])
        dedupe_append(zones, claude[niche])
        merged[niche] = zones
    OUT.write_text(json.dumps(merged, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    lengths = [len(v) for v in merged.values()]
    print(f"Wrote {len(merged)} niches -> {OUT}")
    print(f"min {min(lengths)} max {max(lengths)} avg {sum(lengths)/len(lengths):.1f}")


if __name__ == "__main__":
    main()
