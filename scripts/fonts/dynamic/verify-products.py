"""测试用产物验证器：只在字体 Bubblewrap 内加载字体及渲染，不在宿主解析。"""
import hashlib
import io
import json
from pathlib import Path
import resource
import sys

resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))
sys.path.insert(0, '/toolchain')
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from PIL import Image, ImageDraw, ImageFont

root = Path('/input')
manifest = json.loads((root / 'manifest.json').read_bytes())
source = TTFont(root / 'source', recalcTimestamp=False) if (root / 'source').exists() else None
axes = {axis.axisTag: axis.defaultValue for axis in source['fvar'].axes} if source and 'fvar' in source else {}
source_glyphs = source.getGlyphSet(location=axes) if source else None

def read_asset(asset):
    value = (root / (asset['sha256'] + '.' + asset['format'])).read_bytes()
    assert len(value) == asset['bytes']
    assert hashlib.sha256(value).hexdigest() == asset['sha256']
    return value

def points(ranges):
    result = set()
    for item in ranges:
        edges = item[2:].split('-')
        result.update(range(int(edges[0], 16), int(edges[-1], 16) + 1))
    return result

count, formats, rendered = 0, set(), 0
for shard in manifest['shards']:
    web_bytes, mobile_bytes = read_asset(shard['web']), read_asset(shard['mobile'])
    web = TTFont(io.BytesIO(web_bytes), recalcTimestamp=False, checkChecksums=2)
    mobile = TTFont(io.BytesIO(mobile_bytes), recalcTimestamp=False, checkChecksums=2)
    assert web.flavor == 'woff2' and mobile.flavor is None
    expected = points(shard['unicodeRanges'])
    assert len(expected) == shard['codepointCount']
    for font in (web, mobile):
        font.ensureDecompiled()
        assert not set(font.keys()) & {'fvar', 'gvar', 'CFF2'}
        assert set(font.getBestCmap()) == expected
        assert font['OS/2'].usWeightClass == 400
        assert font['head'].macStyle & 3 == 0
        for name_id in (1, 4, 6, 16):
            assert font['name'].getName(name_id, 3, 1, 0x409).toUnicode() == shard['family']
    if shard['mobile']['format'] == 'otf':
        assert 'CFF ' in mobile and mobile.sfntVersion == 'OTTO'
    else:
        assert 'glyf' in mobile and mobile.sfntVersion == '\x00\x01\x00\x00'
    web_glyphs, mobile_glyphs = web.getGlyphSet(), mobile.getGlyphSet()
    for point in sorted(expected):
        w, m = web.getBestCmap()[point], mobile.getBestCmap()[point]
        # 子集化可重编号未命名组件；比较展开后的几何，不能比较内部 glyph 引用名。
        wp, mp = DecomposingRecordingPen(web_glyphs), DecomposingRecordingPen(mobile_glyphs)
        web_glyphs[w].draw(wp)
        mobile_glyphs[m].draw(mp)
        assert wp.value == mp.value and web_glyphs[w].width == mobile_glyphs[m].width
        if source_glyphs is not None:
            original = source_glyphs[source.getBestCmap()[point]]
            original_pen = DecomposingRecordingPen(source_glyphs)
            original.draw(original_pen)
            assert mp.value == original_pen.value and mobile_glyphs[m].width == original.width
    face = ImageFont.truetype(io.BytesIO(mobile_bytes), size=32)
    sample = ''.join(chr(p) for p in sorted(expected) if p >= 33)[:32]
    canvas = Image.new('L', (2048, 128))
    ImageDraw.Draw(canvas).text((8, 8), sample, font=face, fill=255)
    rendered += int(canvas.getbbox() is not None)
    formats.add(shard['mobile']['format'])
    count += len(expected)
assert count == manifest['coverage']['codepointCount']
assert rendered > 0
picture = Image.open(io.BytesIO(read_asset(manifest['specimen'])))
picture.load()
assert picture.size == (640, 160) and picture.getbbox() is not None
for notice in manifest['notices']:
    value = json.loads(read_asset(notice))
    if source:
        assert value['axes'] == axes
Path('/output/evidence.json').write_text(json.dumps({
    'passed': True, 'shards': len(manifest['shards']), 'codepoints': count,
    'mobileFormats': sorted(formats), 'webFormat': 'woff2',
    'matchingOutlines': True, 'mobileRendered': True, 'specimenRendered': True,
    'defaultInstanceOutlines': source is not None,
}))
