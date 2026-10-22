"""只在字体沙箱中读取已验证的旧 core 分片，生成导入样张，不重新编译旧字节。"""
import hashlib
import io
import json
import os
from pathlib import Path
import resource
import sys

resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
sys.path.insert(0, '/toolchain')
import PIL
from PIL import Image, ImageDraw, ImageFont

assert os.getuid() != 0 and PIL.__version__ == '13.0.0'
parameters = json.loads(Path('/input/parameters.json').read_text())
source = Path('/input/source').read_bytes()
assert hashlib.sha256(source).hexdigest() == parameters['sourceSha256']
font = ImageFont.truetype(io.BytesIO(source), 44)
specimen = Image.new('RGBA', (640, 160), (0, 0, 0, 0))
ImageDraw.Draw(specimen).text((20, 45), parameters['specimenText'], font=font, fill=(128, 128, 128, 255))
specimen.save('/output/specimen.png', format='PNG', optimize=False, compress_level=9)
