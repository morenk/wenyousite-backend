#!/usr/bin/env python3
"""仅下载已锁定的公开上游；缓存不包含业务数据，也不上传到运行环境。"""
import argparse
import json
from pathlib import Path
import zipfile
from build import acquire, source_font, sha

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--cache', type=Path, required=True)
parser.add_argument('--source-dir', type=Path)
args = parser.parse_args()
args.cache.mkdir(parents=True, exist_ok=True)
sources = json.loads((args.root / 'contracts/thread-font-sources-v1.json').read_text())
for source in sources['fonts']:
    if source['status'] != 'locked':
        continue
    path = acquire(source['url'], source['sha256'], source['bytes'], args.cache, args.source_dir, source.get('filename'), True)
    if not source.get('licenseMember'):
        acquire(source.get('licenseUrl'), source['licenseSha256'], None, args.cache, args.source_dir, source.get('licenseFilename'), True)
    if source.get('readmeSha256'):
        acquire(source['readmeUrl'], source['readmeSha256'], None, args.cache, None, None, True)
    if zipfile.is_zipfile(path):
        selected = source_font(source, path)
        print(json.dumps({'id': source['id'], 'member': source['archiveMember'],
                          'bytes': len(selected), 'sha256': sha(selected)}), flush=True)
    else:
        print(json.dumps({'fetched': source['id'], 'bytes': source['bytes']}), flush=True)
