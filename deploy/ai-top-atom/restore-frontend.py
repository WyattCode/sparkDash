#!/usr/bin/env python3
"""Verify and restore the accepted compiled UI; preserve an existing dist backup."""
import hashlib
import json
import shutil
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

folder = Path(__file__).resolve().parent
root = folder.parents[1]
manifest = json.loads((folder / 'manifest.json').read_text())
archive = folder / 'frontend.tar.gz'
if hashlib.sha256(archive.read_bytes()).hexdigest() != manifest['archive_sha256']:
    raise SystemExit('Archive checksum mismatch; restore cancelled')
with tempfile.TemporaryDirectory(prefix='.atom-restore-', dir=root) as tmp:
    stage = Path(tmp) / 'dist'
    stage.mkdir()
    with tarfile.open(archive) as tar:
        tar.extractall(stage, filter='data')
    for filename, expected in manifest['files'].items():
        if hashlib.sha256((stage / filename).read_bytes()).hexdigest() != expected:
            raise SystemExit('File checksum mismatch: ' + filename)
    dist = root / 'dist'
    if dist.exists():
        backup = root / ('.dist-backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
        shutil.copytree(dist, backup)
        print('Backup:', backup)
    dist.mkdir(exist_ok=True)
    for source in stage.rglob('*'):
        if source.is_file() and source.name != 'index.html':
            destination = dist / source.relative_to(stage)
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
    # Change the entrypoint last, after every referenced asset is present.
    shutil.copy2(stage / 'index.html', dist / '.index.html.restore')
    (dist / '.index.html.restore').replace(dist / 'index.html')
    print('Restored verified AI TOP ATOM frontend:', dist)
