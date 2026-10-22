#!/usr/bin/env python3
"""按已提交的 v1 锁恢复源材料；不解析字体，不改契约，不连接业务数据库。"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import zipfile

os.umask(0o077)
parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, required=True)
parser.add_argument('--source-dir', type=Path, required=True)
parser.add_argument('--download', action='store_true')
args = parser.parse_args()
root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('legacy_recipe', Path(__file__).resolve().parents[1] / 'build.py')
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)
sources = json.loads((root / 'contracts/thread-font-sources-v1.json').read_text())['fonts']
manifest_bytes = (root / 'contracts/thread-font-manifest-v1.json').read_bytes()
mapping = json.loads((root / 'contracts/thread-font-v1-import-map.json').read_text())
assert recipe.sha(manifest_bytes) == mapping['sourceManifestSha256']
assert {row['id'] for row in sources} == {row['legacyId'] for row in mapping['fonts']}
args.cache.mkdir(parents=True, exist_ok=True, mode=0o700)
assert not args.cache.is_symlink() and args.cache.stat().st_uid == os.getuid()
raw = args.cache / 'raw'
raw.mkdir(exist_ok=True, mode=0o700)
assert not raw.is_symlink()
for source in sources:
    container = recipe.acquire(source['url'], source['sha256'], source['bytes'], args.cache,
                               args.source_dir, source.get('filename'), args.download)
    payload = recipe.source_font(source, container)
    digest = source.get('fontSha256', source['sha256'])
    assert recipe.sha(payload) == digest and payload[:4] in (b'\0\1\0\0', b'OTTO')
    target = raw / (digest + ('.otf' if payload[:4] == b'OTTO' else '.ttf'))
    if target.exists():
        recipe.checked_bytes(target, digest, len(payload))
    else:
        with target.open('xb') as output:
            output.write(payload)
        target.chmod(0o400)
    if source.get('licenseMember'):
        with zipfile.ZipFile(container) as archive:
            info = archive.getinfo(source['licenseMember'])
            assert info.file_size <= 1048576
            license_bytes = archive.read(info)
        assert recipe.sha(license_bytes) == source['licenseSha256']
        license_path = args.cache / source['licenseSha256']
        if not license_path.exists():
            with license_path.open('xb') as output:
                output.write(license_bytes)
    else:
        recipe.acquire(source.get('licenseUrl'), source['licenseSha256'], None, args.cache,
                       args.source_dir, source.get('licenseFilename'), args.download)
    for extra in source.get('additionalLicenseMembers', []):
        with zipfile.ZipFile(container) as archive:
            info = archive.getinfo(extra['member'])
            assert info.file_size <= 1048576
            assert recipe.sha(archive.read(info)) == extra['sha256']
    if source.get('readmeSha256'):
        recipe.acquire(source['readmeUrl'], source['readmeSha256'], None, args.cache,
                       args.source_dir, None, args.download)
    print(json.dumps({'sourceVerified': source['id'], 'rawSha256': digest}), flush=True)
