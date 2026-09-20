#!/usr/bin/env python3
"""Print Orble production labels on a Brother QL-600."""

from __future__ import annotations

import argparse
import csv
import math
import re
import subprocess
from collections import defaultdict
from datetime import date, datetime, timedelta
from io import StringIO
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import urlopen

from brother_ql import BrotherQLRaster
from brother_ql.backends.pyusb import BrotherQLBackendPyUSB, list_available_devices
from brother_ql.conversion import convert
from brother_ql.labels import FormFactor, LabelsManager
from PIL import Image, ImageDraw, ImageFont


DEFAULT_TEXT = "09/14/26 Strawberry Matcha"
DEFAULT_FONT = "/System/Library/Fonts/Supplemental/Arial.ttf"
DEFAULT_MODEL = "QL-600"
DEFAULT_LABEL = "17x54"  # Brother DK-1204, 0.66 x 2.1 in.
DEFAULT_SHEET_URL = (
    "https://docs.google.com/spreadsheets/d/"
    "1q9D_qlRPiltdm4hXHDFvgjQ4JQldTh3JlItZVif8OBA/edit?gid=647107374"
)
AMOUNT_ALIASES = ("amount of make", "amount to make", "make", "quantity", "qty", "count", "labels")
TOTAL_STICKERS_ALIASES = ("total stickers", "stickers")
DIRECT_TO_MACHINE_ALIASES = ("amount to take to machine", "take to machine", "to machine")
DATE_ALIASES = ("date", "production date", "print date")
DRINK_ALIASES = ("drink variation", "drink", "variation", "drink name", "label", "product")
RECIPE_ALIASES = ("recipe", "recipe name", "base recipe")
SLOT_30TH_ALIASES = ("slot (30th)", "slot 30th", "30th slot")
SLOT_TOWNE_ALIASES = ("slot (towne)", "slot towne", "towne slot")


def build_label(
    text: str,
    font_path: str,
    font_size: Optional[int],
    pad_x: Optional[int],
    pad_y: Optional[int],
    label: str,
    orientation: str,
) -> Image.Image:
    label_info = LabelsManager().get(label)
    printable_w, printable_h = label_info.dots_printable

    if label_info.form_factor == FormFactor.ENDLESS:
        canvas_w = printable_w
        canvas_h = BrotherQLRaster(DEFAULT_MODEL).model.min_max_length_dots[0]
    elif orientation == "landscape":
        canvas_w, canvas_h = printable_h, printable_w
    else:
        canvas_w, canvas_h = printable_w, printable_h

    probe = Image.new("RGB", (1, 1), "white")
    draw = ImageDraw.Draw(probe)
    pad_x = pad_x if pad_x is not None else 2
    pad_y = pad_y if pad_y is not None else 2

    if font_size is None:
        font_size = fit_font_size(text, font_path, draw, canvas_w, canvas_h, pad_x, pad_y)

    font = ImageFont.truetype(font_path, font_size)
    bbox = draw.textbbox((0, 0), text, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    label_img = Image.new("RGB", (canvas_w, canvas_h), "white")
    text_draw = ImageDraw.Draw(label_img)
    x = max(pad_x, (canvas_w - text_w) // 2)
    y = max(pad_y, (canvas_h - text_h) // 2)
    text_draw.text((x - bbox[0], y - bbox[1]), text, font=font, fill="black")
    return label_img


def build_production_label(
    drink_name: str,
    expiration_date: str,
    code: str,
    font_path: str,
    label: str,
    orientation: str,
) -> Image.Image:
    label_info = LabelsManager().get(label)
    printable_w, printable_h = label_info.dots_printable
    canvas_w, canvas_h = (printable_h, printable_w) if orientation == "landscape" else (printable_w, printable_h)

    img = Image.new("RGB", (canvas_w, canvas_h), "white")
    draw = ImageDraw.Draw(img)
    margin = 8
    top_h = 52

    code_font_size = fit_font_size(code, font_path, draw, canvas_w // 2 - margin * 2, top_h - margin, 0, 0)
    exp_text = f"EXP {expiration_date}"
    exp_font_size = fit_font_size(exp_text, font_path, draw, canvas_w // 2 - margin * 2, top_h - margin, 0, 0)
    code_font = ImageFont.truetype(font_path, min(34, code_font_size))
    exp_font = ImageFont.truetype(font_path, min(26, exp_font_size))

    draw.text((margin, margin), code, font=code_font, fill="black")
    exp_bbox = draw.textbbox((0, 0), exp_text, font=exp_font)
    draw.text((canvas_w - margin - (exp_bbox[2] - exp_bbox[0]), margin + 4), exp_text, font=exp_font, fill="black")

    drink_font_size = fit_font_size(drink_name, font_path, draw, canvas_w - margin * 2, canvas_h - top_h - margin, 0, 0)
    drink_font = ImageFont.truetype(font_path, drink_font_size)
    drink_bbox = draw.textbbox((0, 0), drink_name, font=drink_font)
    drink_w = drink_bbox[2] - drink_bbox[0]
    drink_h = drink_bbox[3] - drink_bbox[1]
    drink_x = max(margin, (canvas_w - drink_w) // 2)
    drink_y = top_h + max(0, (canvas_h - top_h - drink_h) // 2)
    draw.text((drink_x - drink_bbox[0], drink_y - drink_bbox[1]), drink_name, font=drink_font, fill="black")
    return img


def fit_font_size(
    text: str,
    font_path: str,
    draw: ImageDraw.ImageDraw,
    max_width: int,
    max_height: int,
    pad_x: int,
    pad_y: int,
) -> int:
    available_width = max_width - pad_x * 2
    available_height = max_height - pad_y * 2
    best = 6

    for size in range(6, 121):
        font = ImageFont.truetype(font_path, size)
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        if text_w <= available_width and text_h <= available_height:
            best = size
        else:
            break

    return best


def google_sheet_csv_url(sheet_url: str) -> str:
    parsed = urlparse(sheet_url)
    match = re.search(r"/spreadsheets/d/([^/]+)", parsed.path)
    if not match:
        raise ValueError("Could not find a Google spreadsheet id in the URL.")
    spreadsheet_id = match.group(1)
    gid = parse_qs(parsed.query).get("gid", ["0"])[0]
    query = urlencode({"format": "csv", "gid": gid})
    return f"https://docs.google.com/spreadsheets/d/{spreadsheet_id}/export?{query}"


def read_rows_from_sheet(sheet_url: str) -> list[dict[str, str]]:
    with urlopen(google_sheet_csv_url(sheet_url), timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.DictReader(StringIO(text)))


def read_rows_from_csv(path: str) -> list[dict[str, str]]:
    with open(path, newline="", encoding="utf-8-sig") as csv_file:
        return list(csv.DictReader(csv_file))


def normalize_header(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def resolve_column(headers: Iterable[str], explicit: Optional[str], aliases: tuple[str, ...]) -> str:
    headers_by_normalized = {normalize_header(header): header for header in headers}
    if explicit:
        normalized_explicit = normalize_header(explicit)
        if normalized_explicit in headers_by_normalized:
            return headers_by_normalized[normalized_explicit]
        raise ValueError(f"Could not find column {explicit!r}. Available columns: {', '.join(headers)}")

    for alias in aliases:
        if alias in headers_by_normalized:
            return headers_by_normalized[alias]

    raise ValueError(f"Could not find any of these columns: {', '.join(aliases)}")


def parse_quantity(value: str) -> int:
    cleaned = str(value).strip()
    if not cleaned:
        return 0
    try:
        return max(0, math.ceil(float(cleaned)))
    except ValueError:
        return 0


def parse_date(value: str) -> date:
    cleaned = str(value).strip()
    if not cleaned:
        return date.today()

    for fmt in ("%m/%d/%y", "%m/%d/%Y", "%Y-%m-%d", "%m-%d-%Y", "%m-%d-%y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            pass

    raise ValueError(f"Could not parse date {value!r}. Use mm/dd/yy, mm/dd/yyyy, or yyyy-mm-dd.")


def format_expiration_date(value: str) -> str:
    return (parse_date(value) + timedelta(days=7)).strftime("%m/%d/%y")


def optional_column(headers: Iterable[str], aliases: tuple[str, ...]) -> Optional[str]:
    try:
        return resolve_column(headers, None, aliases)
    except ValueError:
        return None


def parse_slots(value: str) -> list[str]:
    slots = re.findall(r"\d+", str(value))
    return slots or ["00"]


def label_code(disposition: str, machine: str, slot: str) -> str:
    return f"{disposition}{machine}#{slot}"


def machine_slots(row: dict[str, str], slot_30th_col: Optional[str], slot_towne_col: Optional[str]) -> list[tuple[str, str]]:
    slots: list[tuple[str, str]] = []
    if slot_30th_col and row.get(slot_30th_col, "").strip():
        slots.extend(("30TH", slot) for slot in parse_slots(row.get(slot_30th_col, "")))
    if slot_towne_col and row.get(slot_towne_col, "").strip():
        slots.extend(("TWNE", slot) for slot in parse_slots(row.get(slot_towne_col, "")))
    return slots or [("30TH", "00")]


def production_jobs(
    rows: list[dict[str, str]],
    amount_column: Optional[str],
    drink_column: Optional[str],
    recipe_column: Optional[str],
    date_column: Optional[str],
    default_date: Optional[str],
    recipe_filter: Optional[str],
) -> dict[str, list[str]]:
    if not rows:
        return {}

    headers = rows[0].keys()
    amount_col = resolve_column(headers, amount_column, AMOUNT_ALIASES)
    total_stickers_col = optional_column(headers, TOTAL_STICKERS_ALIASES)
    direct_to_machine_col = optional_column(headers, DIRECT_TO_MACHINE_ALIASES)
    drink_col = resolve_column(headers, drink_column, DRINK_ALIASES)
    recipe_col = resolve_column(headers, recipe_column, RECIPE_ALIASES)
    slot_30th_col = optional_column(headers, SLOT_30TH_ALIASES)
    slot_towne_col = optional_column(headers, SLOT_TOWNE_ALIASES)

    date_col = None
    if date_column:
        date_col = resolve_column(headers, date_column, DATE_ALIASES)
    else:
        try:
            date_col = resolve_column(headers, None, DATE_ALIASES)
        except ValueError:
            date_col = None

    grouped: dict[str, list[str]] = defaultdict(list)
    current_recipe = ""
    normalized_recipe_filter = normalize_header(recipe_filter) if recipe_filter else None
    for row in rows:
        recipe = row.get(recipe_col, "").strip() or current_recipe
        if row.get(recipe_col, "").strip():
            current_recipe = recipe

        if normalized_recipe_filter and normalize_header(recipe) != normalized_recipe_filter:
            continue

        quantity = parse_quantity(row.get(total_stickers_col, "")) if total_stickers_col else 0
        if quantity <= 0:
            quantity = parse_quantity(row.get(amount_col, ""))
        direct_to_machine = parse_quantity(row.get(direct_to_machine_col, "")) if direct_to_machine_col else 0
        drink = row.get(drink_col, "").strip()
        if quantity <= 0 or not drink or not recipe:
            continue

        expiration_date = format_expiration_date(default_date or (row.get(date_col, "") if date_col else ""))
        slots = machine_slots(row, slot_30th_col, slot_towne_col)
        for index in range(quantity):
            disposition = "D" if index < direct_to_machine else "S"
            machine, slot = slots[index % len(slots)]
            if disposition == "S":
                machine = "UNDC"
            grouped[recipe].append(f"{label_code(disposition, machine, slot)}\t{expiration_date}\t{drink}")

    return dict(grouped)


def instructions_for_images(
    images: list[Image.Image],
    model: str,
    label: str,
    cut: bool,
) -> bytes:
    qlr = BrotherQLRaster(model)
    return convert(
        qlr,
        images=images,
        label=label,
        rotate="auto",
        cut=cut,
        dither=False,
        hq=True,
    )


def send_usb(instructions: bytes, usb: str) -> None:
    printer = BrotherQLBackendPyUSB(usb)
    try:
        printer.write(instructions)
    finally:
        printer.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("text", nargs="?", default=DEFAULT_TEXT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--label", default=DEFAULT_LABEL)
    parser.add_argument("--font", default=DEFAULT_FONT)
    parser.add_argument("--font-size", type=int, help="Override automatic font size.")
    parser.add_argument("--pad-x", type=int, help="Override automatic horizontal padding, in px.")
    parser.add_argument("--pad-y", type=int, help="Override automatic vertical padding, in px.")
    parser.add_argument("--orientation", choices=("landscape", "portrait"), default="landscape")
    parser.add_argument("--preview", default="date_recipe_label_preview.png")
    parser.add_argument("--output", default="date_recipe_label.bin")
    parser.add_argument("--printer", help="Optional macOS/CUPS printer name. Use `lpstat -p` to find it.")
    parser.add_argument("--usb", help="Optional pyusb printer identifier, such as usb://0x04f9:0x20c0.")
    parser.add_argument("--device", help="Optional raw printer device path.")
    parser.add_argument("--discover-usb", action="store_true", help="List Brother QL USB printers, then exit.")
    parser.add_argument("--sheet-url", help="Read labels from a Google Sheet CSV export URL.")
    parser.add_argument("--csv", help="Read labels from a local CSV file.")
    parser.add_argument(
        "--run-everything",
        action="store_true",
        help="Read the default Orble production plan and print labels by recipe.",
    )
    parser.add_argument("--date", help="Override label date, formatted as mm/dd/yy.")
    parser.add_argument("--code", help="Optional code for a single test label, such as S30TH#21.")
    parser.add_argument("--recipe", help="Only print or dry-run one recipe group.")
    parser.add_argument("--amount-column", help="Production-plan column containing label quantity.")
    parser.add_argument("--drink-column", help="Production-plan column containing drink variation/name.")
    parser.add_argument("--recipe-column", help="Production-plan column containing recipe grouping.")
    parser.add_argument("--date-column", help="Optional production-plan column containing label date.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would print without sending to USB.")
    args = parser.parse_args()

    if args.discover_usb:
        devices = list_available_devices()
        if not devices:
            print("No Brother QL USB printers found through pyusb.")
            return
        for device in devices:
            print(device["identifier"])
        return

    if args.run_everything or args.sheet_url or args.csv:
        sheet_url = args.sheet_url or DEFAULT_SHEET_URL
        rows = read_rows_from_csv(args.csv) if args.csv else read_rows_from_sheet(sheet_url)
        jobs = production_jobs(
            rows,
            args.amount_column,
            args.drink_column,
            args.recipe_column,
            args.date_column,
            args.date,
            args.recipe,
        )
        if not jobs:
            print("No labels found to print.")
            return

        output_dir = Path("label-printing/output")
        output_dir.mkdir(parents=True, exist_ok=True)

        total_labels = 0
        for recipe, labels in jobs.items():
            total_labels += len(labels)
            images = [
                build_production_label(
                    drink_name=label_text.split("\t", 2)[2],
                    expiration_date=label_text.split("\t", 2)[1],
                    code=label_text.split("\t", 2)[0],
                    font_path=args.font,
                    label=args.label,
                    orientation=args.orientation,
                )
                for label_text in labels
            ]
            safe_recipe = re.sub(r"[^A-Za-z0-9._-]+", "_", recipe).strip("_") or "recipe"
            instructions = instructions_for_images(images, args.model, args.label, cut=True)
            output_path = output_dir / f"{safe_recipe}.bin"
            output_path.write_bytes(instructions)
            images[0].save(output_dir / f"{safe_recipe}_preview.png")

            print(f"{recipe}: {len(labels)} labels")
            if args.dry_run:
                for sample in labels[:3]:
                    code, expiration_date, drink_name = sample.split("\t", 2)
                    print(f"  {code} | EXP {expiration_date} | {drink_name}")
                if len(labels) > 3:
                    print(f"  ... {len(labels) - 3} more")
            if args.usb and not args.dry_run:
                send_usb(instructions, args.usb)
                print(f"  sent and cut after recipe: {recipe}")

        print(f"Total labels: {total_labels}")
        if args.dry_run or not args.usb:
            print(f"Output files: {output_dir.resolve()}")
        return

    if args.code:
        label_img = build_production_label(
            drink_name=args.text,
            expiration_date=format_expiration_date(args.date or ""),
            code=args.code,
            font_path=args.font,
            label=args.label,
            orientation=args.orientation,
        )
    else:
        label_img = build_label(args.text, args.font, args.font_size, args.pad_x, args.pad_y, args.label, args.orientation)
    preview_path = Path(args.preview)
    output_path = Path(args.output)
    label_img.save(preview_path)

    instructions = instructions_for_images([label_img], args.model, args.label, cut=True)
    output_path.write_bytes(instructions)

    if args.device:
        Path(args.device).write_bytes(instructions)

    if args.printer:
        subprocess.run(["lpr", "-P", args.printer, str(preview_path)], check=True)

    if args.usb:
        send_usb(instructions, args.usb)
        print("USB print status: sent")

    print(f"Preview: {preview_path.resolve()}")
    print(f"Printer bytes: {output_path.resolve()}")
    print(f"Image size: {label_img.width}x{label_img.height}px")
    if args.printer:
        print(f"Sent preview image to printer: {args.printer}")


if __name__ == "__main__":
    main()
