"""Resolve (or install) external tool dependencies declared in manifest.json.

Usage:
    python tools/vendor/bootstrap.py blender            # resolve: print exe path, exit 0
    python tools/vendor/bootstrap.py blender --install  # download + unzip into tools/vendor/ if missing

Resolution order: vendored install → system PATH. Nothing is downloaded without --install.
Installs land in gitignored subdirectories next to this file; the repo carries only the
manifest, this script, and .gitignore.
"""

import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

VENDOR = Path(__file__).parent
PLATFORM = "windows-x64"  # extend per-platform as needed


def resolve(name, install=False):
    manifest = json.loads((VENDOR / "manifest.json").read_text(encoding="utf-8"))
    if name not in manifest:
        print(f"unknown dependency: {name}", file=sys.stderr)
        return None
    spec = manifest[name]
    plat = spec[PLATFORM]

    vendored = VENDOR / spec["install_dir"] / plat["exe"]
    if vendored.exists():
        return vendored

    on_path = shutil.which(name)
    if on_path:
        return Path(on_path)

    if not install:
        print(f"{name} {spec['version']} not found (checked {vendored} and PATH).", file=sys.stderr)
        print(f"install it with: python {Path(__file__).relative_to(Path.cwd()) if Path(__file__).is_relative_to(Path.cwd()) else Path(__file__)} {name} --install", file=sys.stderr)
        print(f"({spec['purpose']})", file=sys.stderr)
        return None

    dest = VENDOR / spec["install_dir"]
    dest.mkdir(parents=True, exist_ok=True)
    zip_path = dest / "download.zip"
    print(f"downloading {plat['url']} ...", file=sys.stderr)
    req = urllib.request.Request(plat["url"], headers={"User-Agent": "generative-arcana-bootstrap/1.0"})
    with urllib.request.urlopen(req) as resp, open(zip_path, "wb") as out:
        total = int(resp.headers.get("Content-Length", 0))
        done = 0
        while True:
            chunk = resp.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total and done % (64 << 20) < (1 << 20):
                print(f"  {done // (1 << 20)} / {total // (1 << 20)} MB", file=sys.stderr)
    print("unzipping ...", file=sys.stderr)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(dest)
    zip_path.unlink()
    if not vendored.exists():
        print(f"install finished but {vendored} not found — check manifest exe path", file=sys.stderr)
        return None
    return vendored


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    exe = resolve(sys.argv[1], install="--install" in sys.argv)
    if exe is None:
        sys.exit(2)
    print(exe)
