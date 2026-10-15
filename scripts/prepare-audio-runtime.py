#!/usr/bin/env python3
"""准备固定音频运行依赖；只写当前 checkout 的忽略缓存，不更改系统/PATH。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / 'audio-runtime.lock.json').read_text())
TARGET = ROOT / '.cache/audio-runtime'

def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()

def verify(directory):
    for relative, expected in LOCK['files'].items():
        file = directory / relative
        if file.is_symlink() or not file.is_file() or digest(file) != expected:
            raise ValueError('音频依赖文件校验失败')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, help='可选的既有固定发行归档；省略时下载清单指定版本')
    args = parser.parse_args()
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    if TARGET.exists():
        verify(TARGET)
        print('音频运行依赖已核验')
        return
    temporary = Path(tempfile.mkdtemp(prefix='audio-prepare-', dir=TARGET.parent))
    try:
        archive = args.archive
        if archive is None:
            archive = temporary / 'runtime.tar.xz'
            with urllib.request.urlopen(LOCK['archiveUrl'], timeout=60) as response, archive.open('wb') as output:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 200 * 1024 * 1024:
                        raise ValueError('音频运行归档超过预算')
                    output.write(chunk)
        if digest(archive) != LOCK['archiveSha256']:
            raise ValueError('音频发行归档校验失败')
        prepared = temporary / 'runtime'
        prepared.mkdir()
        with tarfile.open(archive, 'r:xz') as package:
            for relative in LOCK['files']:
                member = package.getmember(LOCK['archiveRoot'] + '/' + relative)
                if not member.isfile() or member.size > 250 * 1024 * 1024:
                    raise ValueError('音频发行文件无效')
                output = prepared / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                with package.extractfile(member) as source, output.open('wb') as dest:
                    shutil.copyfileobj(source, dest)
                output.chmod(0o755 if relative.startswith('bin/') else 0o644)
        verify(prepared)
        os.rename(prepared, TARGET)
        print('音频运行依赖准备完成')
    finally:
        shutil.rmtree(temporary)

if __name__ == '__main__':
    main()
