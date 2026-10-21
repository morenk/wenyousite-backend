#!/usr/bin/env python3
"""从锁定 wheel 安装独立字体工具链；不执行包脚本，不修改系统 Python。"""
import argparse
import hashlib
import io
import json
import os
import platform
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import urllib.request
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True)
parser.add_argument('--wheel-cache')
args = parser.parse_args()
lock_path = Path(__file__).with_name('toolchain.lock.json')
lock_bytes = lock_path.read_bytes()
lock = json.loads(lock_bytes)
assert sys.version_info[:2] == (3, 12) and sys.platform == 'linux' and platform.machine() == 'x86_64'
destination = Path(args.output).absolute()
existing = destination.exists()
if existing:
    assert not destination.is_symlink() and (destination / 'wenyou-toolchain.lock.json').read_bytes() == lock_bytes, '工具链目录已存在但身份不匹配'
destination.parent.mkdir(parents=True, exist_ok=True)
stage = None if existing else Path(tempfile.mkdtemp(prefix='font-toolchain-', dir=destination.parent))
expected_files = {'wenyou-toolchain.lock.json'}
try:
    for item in lock['packages']:
        cached = Path(args.wheel_cache) / item['filename'] if args.wheel_cache else None
        if cached and cached.exists():
            data = cached.read_bytes()
        else:
            assert item['url'].startswith('https://files.pythonhosted.org/')
            with urllib.request.urlopen(item['url'], timeout=60) as response:
                data = response.read(item['bytes'] + 1)
        assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], '工具链下载校验失败'
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for entry in archive.infolist():
                parts = PurePosixPath(entry.filename)
                assert not parts.is_absolute() and '..' not in parts.parts
                assert (entry.external_attr >> 16) & 0o170000 != 0o120000, '禁止 wheel 符号链接'
                target = (destination if existing else stage).joinpath(*parts.parts)
                assert not target.is_symlink(), '工具链禁止符号链接'
                if entry.is_dir():
                    if not existing:
                        target.mkdir(parents=True, exist_ok=True)
                    continue
                expected_files.add(entry.filename)
                expected = archive.read(entry)
                if existing:
                    assert target.is_file() and target.read_bytes() == expected, '已安装工具链内容校验失败'
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with target.open('xb') as output:
                        output.write(expected)
                    target.chmod(0o444)
    if existing:
        actual_files = set()
        for path in destination.rglob('*'):
            assert not path.is_symlink(), '工具链禁止符号链接'
            if path.is_file():
                actual_files.add(path.relative_to(destination).as_posix())
        assert actual_files == expected_files, '工具链出现未登记文件'
        print('字体工具链全部内容已按锁定 wheel 复验')
        sys.exit(0)
    (stage / 'wenyou-toolchain.lock.json').write_bytes(lock_bytes)
    (stage / 'wenyou-toolchain.lock.json').chmod(0o444)
    for directory, _, _ in os.walk(stage, topdown=False):
        Path(directory).chmod(0o755)
    stage.rename(destination)
    print('字体工具链已安装并通过 SHA-256 校验')
finally:
    if stage is not None and stage.exists():
        shutil.rmtree(stage)
