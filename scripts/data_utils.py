"""Shared transport, atomic writes and GitHub Actions diagnostics (stdlib only)."""
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


def diagnostic(level, message):
    message = str(message)
    print(f"{level.upper()}: {message}", file=sys.stderr)
    if os.environ.get("GITHUB_ACTIONS") == "true":
        escaped = message.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
        print(f"::{level}::{escaped}")


def summary(message):
    print(message)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
            stream.write(message + "\n\n")


def request_bytes(url, attempts=3):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={
                "User-Agent": "elpris-github-pages/2.0", "Accept": "application/json, application/xml",
            })
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            if isinstance(exc, urllib.error.HTTPError) and exc.code != 429 and exc.code < 500:
                raise
            if attempt == attempts - 1:
                raise
            diagnostic("warning", f"Source request failed ({attempt + 1}/{attempts}): {exc}; retrying")
            time.sleep(2 ** attempt)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (ValueError, OSError) as exc:
        diagnostic("warning", f"Cannot read cached {path.name}: {exc}")
        return None


def write_json(path, payload):
    """Replace only after serialization succeeds; never leave half-written JSON."""
    content = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    old = read_json(path)
    if isinstance(old, dict):
        before, after = dict(old), dict(payload)
        before.pop("generated_at", None)
        after.pop("generated_at", None)
        if before == after and old.get("generated_at"):
            return False
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    try:
        temporary.write_text(content, encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return True


def run(main):
    try:
        return main() or 0
    except Exception as exc:
        diagnostic("error", f"{type(exc).__name__}: {exc}. Previous data file retained.")
        return 1
