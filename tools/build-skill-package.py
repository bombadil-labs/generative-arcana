#!/usr/bin/env python3
"""Build/check the installable skill ZIP from the canonical guide inventory."""

import argparse
import io
import json
from pathlib import Path
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parent.parent
ARCHIVE = ROOT / "dist/generative-arcana-v2.0.zip"


def sources():
    # Reuse the guide's reviewed inventory and transitive-reference checks, not a second list.
    result = subprocess.check_output([
        "node", "--input-type=module", "-e",
        "import { buildAuthoringGuide } from './tools/build-authoring-guide.mjs'; "
        "process.stdout.write(JSON.stringify(buildAuthoringGuide().metadata));",
    ], cwd=ROOT, text=True)
    inventory = json.loads(result)
    prefix = inventory["sourceRoot"] + "/"
    return {
        "generative-arcana/" + (entry["path"][len(prefix):]
                                if entry["path"].startswith(prefix) else entry["path"]):
        (ROOT / entry["path"]).read_bytes()
        for entry in inventory["files"]
    }


def build(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, data in files.items():
            # Fixed metadata and no compression make rebuilds byte-for-byte reproducible.
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    return output.getvalue()


def check(data, files):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        if archive.namelist() != list(files):
            raise ValueError("Generated skill ZIP inventory/layout is stale; rebuild the package")
        for name, expected in files.items():
            if archive.read(name) != expected:
                raise ValueError(f"Skill ZIP source is stale: {name}")
    if data != build(files):
        raise ValueError("Skill ZIP metadata is not reproducible; rebuild the package")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Fail if the generated dist/ ZIP differs from current sources")
    args = parser.parse_args()
    files = sources()
    if not args.check:
        ARCHIVE.parent.mkdir(parents=True, exist_ok=True)
        ARCHIVE.write_bytes(build(files))
    check(ARCHIVE.read_bytes(), files)
    print(f"Skill ZIP verified: {len(files)} canonical files, one generative-arcana/ root")
