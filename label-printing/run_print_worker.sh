#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${ORBLE_LABEL_REPO_URL:-https://github.com/Orble-Tea/orble-site.git}"
BRANCH="${ORBLE_LABEL_BRANCH:-label-printing}"
INSTALL_PARENT="${ORBLE_LABEL_INSTALL_PARENT:-$HOME/.orble-label-printer}"
INSTALL_DIR="$INSTALL_PARENT/orble-site"
DEFAULT_USB="${ORBLE_PRINTER_USB:-usb://0x04f9:0x20c0}"

WATCH=0
DRY_RUN=0
USB="$DEFAULT_USB"
EXTRA_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch)
      WATCH=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --usb)
      USB="${2:?Missing value for --usb}"
      shift 2
      ;;
    --help|-h)
      cat <<'EOF'
Usage:
  run_print_worker.sh [--dry-run] [--watch] [--usb usb://0x04f9:0x20c0]

Default behavior:
  Updates the label-printing branch, installs dependencies in a local venv,
  polls the Google Sheets Print Queue once, prints any new jobs, then exits.

Options:
  --dry-run   Poll and show queued jobs without printing.
  --watch     Keep polling instead of exiting after one poll.
  --usb       Override the Brother QL USB identifier.
EOF
      exit 0
      ;;
    *)
      EXTRA_ARGS+=("$1")
      shift
      ;;
  esac
done

find_python() {
  if [[ -n "${ORBLE_LABEL_PYTHON:-}" ]]; then
    echo "$ORBLE_LABEL_PYTHON"
    return
  fi

  for candidate in \
    /opt/homebrew/bin/python3.13 \
    /opt/homebrew/bin/python3.12 \
    /opt/homebrew/bin/python3.11 \
    /usr/local/bin/python3.13 \
    /usr/local/bin/python3.12 \
    /usr/local/bin/python3.11 \
    python3
  do
    if command -v "$candidate" >/dev/null 2>&1; then
      "$candidate" - <<'PY' >/dev/null 2>&1 && { echo "$candidate"; return; }
import sys
raise SystemExit(0 if sys.version_info >= (3, 10) else 1)
PY
    fi
  done

  echo "Could not find Python 3.10+. Install Python 3.11+ first." >&2
  exit 1
}

ensure_libusb() {
  if [[ -d /opt/homebrew/opt/libusb || -d /usr/local/opt/libusb ]]; then
    return
  fi

  if command -v brew >/dev/null 2>&1; then
    echo "Installing libusb with Homebrew..."
    brew install libusb
  else
    cat >&2 <<'EOF'
libusb was not found, and Homebrew is not installed.
Install Homebrew and run:
  brew install libusb
EOF
    exit 1
  fi
}

mkdir -p "$INSTALL_PARENT"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating Orble label printer code in $INSTALL_DIR..."
  /usr/bin/git -C "$INSTALL_DIR" fetch origin "$BRANCH"
  /usr/bin/git -C "$INSTALL_DIR" checkout "$BRANCH"
  /usr/bin/git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
else
  echo "Cloning Orble label printer code into $INSTALL_DIR..."
  rm -rf "$INSTALL_DIR"
  /usr/bin/git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

PYTHON="$(find_python)"
VENV="$INSTALL_DIR/.venv-label-printing"

if [[ ! -x "$VENV/bin/python" ]]; then
  echo "Creating local Python environment..."
  "$PYTHON" -m venv "$VENV"
fi

echo "Installing label printer dependencies..."
"$VENV/bin/python" -m pip install --upgrade pip >/dev/null
"$VENV/bin/python" -m pip install -r "$INSTALL_DIR/label-printing/requirements.txt"

ensure_libusb

WORKER_ARGS=(--usb "$USB")
if [[ "$WATCH" -eq 0 ]]; then
  WORKER_ARGS+=(--once)
fi
if [[ "$DRY_RUN" -eq 1 ]]; then
  WORKER_ARGS+=(--dry-run)
fi
WORKER_ARGS+=("${EXTRA_ARGS[@]}")

echo "Running Orble print worker..."
cd "$INSTALL_DIR"
exec "$VENV/bin/python" label-printing/print_queue_worker.py "${WORKER_ARGS[@]}"
