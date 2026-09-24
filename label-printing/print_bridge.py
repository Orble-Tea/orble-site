#!/usr/bin/env python3
"""Local HTTP bridge from Google Sheets to the Brother QL-600 label script."""

from __future__ import annotations

import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[1]
LABEL_SCRIPT = PROJECT_ROOT / "label-printing" / "print_continuous_label.py"
DEFAULT_PYTHON = "/opt/homebrew/bin/python3.11"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

print_lock = threading.Lock()


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def request_token(handler: BaseHTTPRequestHandler) -> str:
    header_token = handler.headers.get("X-Orble-Print-Token", "")
    query_token = parse_qs(urlparse(handler.path).query).get("token", [""])[0]
    return header_token or query_token


def run_print_job(dry_run: bool) -> subprocess.CompletedProcess[str]:
    python = os.environ.get("ORBLE_PRINT_PYTHON", DEFAULT_PYTHON)
    usb = os.environ.get("ORBLE_PRINTER_USB", "usb://0x04f9:0x20c0")
    cmd = [
        python,
        str(LABEL_SCRIPT),
        "--run-everything",
        "--usb",
        usb,
    ]
    if dry_run:
        cmd.append("--dry-run")

    return subprocess.run(
        cmd,
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=180,
    )


class PrintBridgeHandler(BaseHTTPRequestHandler):
    server_version = "OrblePrintBridge/1.0"

    def do_GET(self) -> None:
        if urlparse(self.path).path == "/health":
            json_response(self, 200, {"ok": True, "service": "orble-print-bridge"})
            return
        json_response(self, 404, {"ok": False, "error": "unknown endpoint"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/run-everything":
            json_response(self, 404, {"ok": False, "error": "unknown endpoint"})
            return

        expected_token = os.environ.get("ORBLE_PRINT_TOKEN")
        if not expected_token:
            json_response(
                self,
                500,
                {"ok": False, "error": "ORBLE_PRINT_TOKEN is not set on the bridge process."},
            )
            return

        if request_token(self) != expected_token:
            json_response(self, 401, {"ok": False, "error": "unauthorized"})
            return

        params = parse_qs(parsed.query)
        dry_run = params.get("dry_run", ["false"])[0].lower() in ("1", "true", "yes")

        if not print_lock.acquire(blocking=False):
            json_response(self, 409, {"ok": False, "error": "print job already running"})
            return

        try:
            result = run_print_job(dry_run)
        except subprocess.TimeoutExpired:
            json_response(self, 504, {"ok": False, "error": "print job timed out"})
            return
        finally:
            print_lock.release()

        json_response(
            self,
            200 if result.returncode == 0 else 500,
            {
                "ok": result.returncode == 0,
                "returncode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "dry_run": dry_run,
            },
        )

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")


def main() -> None:
    host = os.environ.get("ORBLE_PRINT_HOST", DEFAULT_HOST)
    port = int(os.environ.get("ORBLE_PRINT_PORT", DEFAULT_PORT))
    server = ThreadingHTTPServer((host, port), PrintBridgeHandler)
    print(f"Orble print bridge listening on http://{host}:{port}")
    print("Health check: /health")
    print("Print endpoint: POST /run-everything")
    server.serve_forever()


if __name__ == "__main__":
    main()
