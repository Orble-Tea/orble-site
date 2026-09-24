#!/usr/bin/env python3
"""Poll the Google Sheets Print Queue tab and print new label jobs locally."""

from __future__ import annotations

import argparse
import csv
import json
import time
from collections import defaultdict
from io import StringIO
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen

from print_continuous_label import (
    DEFAULT_FONT,
    DEFAULT_LABEL,
    DEFAULT_MODEL,
    build_production_label,
    instructions_for_images,
    send_usb,
)


DEFAULT_SPREADSHEET_ID = "1q9D_qlRPiltdm4hXHDFvgjQ4JQldTh3JlItZVif8OBA"
DEFAULT_QUEUE_SHEET = "Print Queue"
DEFAULT_STATE_PATH = Path("label-printing/print_queue_state.json")


def queue_csv_url(spreadsheet_id: str, sheet_name: str) -> str:
    query = urlencode({"tqx": "out:csv", "sheet": sheet_name})
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/gviz/tq?{query}"


def read_queue(spreadsheet_id: str, sheet_name: str) -> list[dict[str, str]]:
    with urlopen(queue_csv_url(spreadsheet_id, sheet_name), timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(StringIO(text)))


def load_state(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return set(data.get("printed_job_ids", []))


def save_state(path: Path, printed_job_ids: set[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"printed_job_ids": sorted(printed_job_ids)}, indent=2),
        encoding="utf-8",
    )


def queued_jobs(rows: list[dict[str, str]], printed_job_ids: set[str]) -> dict[str, dict[str, list[dict[str, str]]]]:
    jobs: dict[str, dict[str, list[dict[str, str]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        job_id = row.get("Job ID", "").strip()
        recipe = row.get("Recipe", "").strip()
        status = row.get("Status", "").strip().upper()
        drink_name = row.get("Drink Name", "").strip()
        if not job_id or not recipe or not drink_name:
            continue
        if job_id in printed_job_ids or status not in ("", "QUEUED"):
            continue
        jobs[job_id][recipe].append(row)
    return {job_id: dict(recipes) for job_id, recipes in jobs.items()}


def print_recipe(
    recipe: str,
    rows: list[dict[str, str]],
    args: argparse.Namespace,
) -> None:
    images = [
        build_production_label(
            drink_name=row.get("Drink Name", ""),
            expiration_date=row.get("Expiration Date", ""),
            code=row.get("Code", ""),
            font_path=args.font,
            label=args.label,
            orientation=args.orientation,
        )
        for row in rows
    ]
    instructions = instructions_for_images(
        images,
        args.model,
        args.label,
        cut=True,
        cut_every=len(images),
        one_job=True,
    )
    print(f"{recipe}: {len(images)} labels")
    if not args.dry_run:
        send_usb(instructions, args.usb)
        print(f"  sent and cut after recipe: {recipe}")


def process_once(args: argparse.Namespace, printed_job_ids: set[str]) -> bool:
    rows = read_queue(args.spreadsheet_id, args.queue_sheet)
    jobs = queued_jobs(rows, printed_job_ids)
    if not jobs:
        print("No new queued print jobs.")
        return False

    for job_id, recipes in jobs.items():
        print(f"Job {job_id}: {sum(len(rows) for rows in recipes.values())} labels")
        for recipe, recipe_rows in recipes.items():
            print_recipe(recipe, recipe_rows, args)
        if not args.dry_run:
            printed_job_ids.add(job_id)
            save_state(args.state, printed_job_ids)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spreadsheet-id", default=DEFAULT_SPREADSHEET_ID)
    parser.add_argument("--queue-sheet", default=DEFAULT_QUEUE_SHEET)
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE_PATH)
    parser.add_argument("--usb", default="usb://0x04f9:0x20c0")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--label", default=DEFAULT_LABEL)
    parser.add_argument("--font", default=DEFAULT_FONT)
    parser.add_argument("--orientation", choices=("landscape", "portrait"), default="landscape")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--once", action="store_true", help="Poll once and exit.")
    parser.add_argument("--interval", type=int, default=10, help="Polling interval in seconds.")
    args = parser.parse_args()

    printed_job_ids = load_state(args.state)
    while True:
        try:
            process_once(args, printed_job_ids)
        except Exception as exc:
            print(f"Queue worker error: {exc}")
        if args.once:
            return
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
