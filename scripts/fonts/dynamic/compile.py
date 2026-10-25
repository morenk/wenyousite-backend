#!/usr/bin/python3
"""只在 Bubblewrap 中解析；输入、依赖只读，所有产物写入本 job 输出目录。"""
import io
import json
import hashlib
import logging
import os
from pathlib import Path
import sys
import struct
import resource
import unicodedata
resource.setrlimit(resource.RLIMIT_NPROC, (0, 0))

sys.path.insert(0, '/toolchain')
import fontTools
from fontTools import subset
from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont, TTLibError
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image, ImageDraw, ImageFont
import PIL
import brotli

logging.disable(logging.CRITICAL)
OUTPUT = Path('/output')
EPOCH = 2082844800
MAX_TOTAL = 536870912
written = 0
stage = 'environment'

class FontFailure(Exception):
    pass

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf8')

def sha(value):
    return hashlib.sha256(value).hexdigest()

def asset(value, fmt):
    global written
    limit = 4194304 if fmt in ('json', 'png') else 6291456
    if not value or len(value) > limit or written + len(value) > MAX_TOTAL:
        raise FontFailure('resource-limit')
    digest = sha(value)
    target = OUTPUT / (digest + '.' + fmt)
    if not target.exists():
        target.write_bytes(value)
        written += len(value)
    return {'sha256': digest, 'bytes': len(value), 'format': fmt}

def ranges(points):
    result = []
    for point in sorted(points):
        if result and result[-1][1] + 1 == point:
            result[-1][1] = point
        else:
            result.append([point, point])
    return [f'U+{first:04X}' if first == last else f'U+{first:04X}-{last:04X}' for first, last in result]

def rename(font, family):
    replaced = {1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}
    font['name'].names = [record for record in font['name'].names if record.nameID not in replaced]
    for ident in replaced:
        text = 'Regular' if ident in (2, 17, 22) else family
        font['name'].setName(text, ident, 3, 1, 0x409)
    if 'OS/2' in font:
        font['OS/2'].usWeightClass = 400
        font['OS/2'].fsSelection = (font['OS/2'].fsSelection & ~((1 << 0) | (1 << 5) | (1 << 9))) | (1 << 6)
    font['head'].macStyle &= ~3
    font['head'].created = font['head'].modified = EPOCH
    if 'post' in font:
        font['post'].italicAngle = 0
    if 'CFF ' in font:
        cff = font['CFF '].cff
        cff.fontNames = [family]
        for top in cff.topDictIndex:
            top.FamilyName = family
            top.FullName = family
            for fd in getattr(top, 'FDArray', []):
                if hasattr(fd, 'FontName'):
                    fd.FontName = family

def outline_origins(font):
    glyf = font['glyf']
    return {name: (
        font['hmtx'][name][1] - getattr(glyf[name], 'xMin', 0),
        font['vmtx'][name][1] + getattr(glyf[name], 'yMax', 0) if 'vmtx' in font else None,
    ) for name in font.getGlyphOrder()}

def preserve_outline_origins(font, origins):
    # 某些混合字体保存统一的陈旧 bbox。修正真实 bounds 时保持水平/垂直字形原点，advance 不变。
    glyf = font['glyf']
    changed = 0
    for name in font.getGlyphOrder():
        glyph = glyf[name]
        if glyph.numberOfContours == 0:
            continue
        horizontal, vertical = origins[name]
        glyph.recalcBounds(glyf)
        advance, bearing = font['hmtx'][name]
        corrected = horizontal + glyph.xMin
        changed += int(corrected != bearing)
        font['hmtx'][name] = (advance, corrected)
        if vertical is not None:
            advance, bearing = font['vmtx'][name]
            corrected = vertical - glyph.yMax
            changed += int(corrected != bearing)
            font['vmtx'][name] = (advance, corrected)
    return changed

def required_outline_glyphs(static, points):
    # 独立求完整 cmap/layout closure；不把工具额外保留的未编码推荐占位当作可见内容。
    required = TTFont(io.BytesIO(static), recalcTimestamp=False)
    options = subset.Options()
    options.layout_features = ['*']
    options.notdef_glyph = True
    options.recommended_glyphs = False
    checker = subset.Subsetter(options=options)
    checker.populate(unicodes=sorted(points))
    checker.subset(required)
    return set(required.getGlyphOrder())

def validate_outline_glyphs(font, allowed_empty, required):
    # 只用于已剔除传统位图的输入；检查 subset 的 layout closure，包含未编码连字及组合字形。
    glyphs = font.getGlyphSet()
    for name in font.getGlyphOrder():
        if name in allowed_empty or name not in required:
            continue
        pen = BoundsPen(glyphs)
        pen.skipMissingComponents = False
        glyphs[name].draw(pen)
        if pen.bounds is None:
            raise FontFailure('unsupported-font')

def empty_character(point):
    # 空白、控制和默认忽略字符无需可见轮廓；普通附标不能一律当作空白。
    return (unicodedata.category(chr(point)) in ('Zs', 'Zl', 'Zp', 'Cc', 'Cf')
            or point in (0x034f, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x3164, 0xffa0)
            or 0x180b <= point <= 0x180f
            or 0x2060 <= point <= 0x206f
            or 0xfff0 <= point <= 0xfff8
            or 0xfe00 <= point <= 0xfe0f
            or 0xe0000 <= point <= 0xe0fff)

def build():
    global stage
    if os.getuid() == 0 or fontTools.__version__ != '4.67.0' or PIL.__version__ != '13.0.0' or brotli.__version__ != '1.2.0':
        raise FontFailure('sandbox-unavailable')
    stage = 'read-input'
    params = json.loads(Path('/input/parameters.json').read_text())
    config = params['configuration']
    if not all(config['rights'].get(key) is True for key in ('redistribution', 'conversion', 'subsetting')) or not all(config[key].strip() for key in ('author', 'sourceUrl', 'licenseName', 'licenseText')):
        raise FontFailure('rights-required')
    payload = Path('/input/source').read_bytes()
    if not 0 < len(payload) <= 67108864 or sha(payload) != params['sourceSha256']:
        raise FontFailure('invalid-font')
    if payload[:4] not in (b'\0\1\0\0', b'OTTO'):
        raise FontFailure('unsupported-font')
    stage = 'open-font'
    font = TTFont(io.BytesIO(payload), recalcTimestamp=False, checkChecksums=2)
    if set(font.keys()) & {'COLR', 'CPAL', 'CBDT', 'CBLC', 'sbix', 'SVG '} or not ({'glyf', 'CFF ', 'CFF2'} & set(font.keys())):
        raise FontFailure('unsupported-font')
    if 'OS/2' in font and font['OS/2'].fsType & (0x0002 | 0x0100 | 0x0200):
        raise FontFailure('rights-required')
    removed_bitmaps = sorted(set(font.keys()) & {'EBDT', 'EBLC', 'EBSC'})
    for tag in removed_bitmaps:
        del font[tag]
    stage = 'decompile'
    font.ensureDecompiled()
    origins = outline_origins(font) if removed_bitmaps and 'glyf' in font else None
    original_weight = font['OS/2'].usWeightClass if 'OS/2' in font else None
    axes = {}
    if 'fvar' in font:
        stage = 'instantiate'
        axes = {axis.axisTag: axis.defaultValue for axis in font['fvar'].axes}
        # TrueType 的 glyf 不能送入 CFF2 降级器；CFF2 静态实例仍转换以兼容移动端。
        font = instantiateVariableFont(font, axes, inplace=True, downgradeCFF2=('CFF2' in font))
        if 'fvar' in font:
            raise FontFailure('unsupported-font')
    default_instance_weight = font['OS/2'].usWeightClass if 'OS/2' in font else None
    if 'GDEF' in font and getattr(font['GDEF'].table, 'Version', None) == 0:
        font['GDEF'].table.Version = 0x00010000
    points = set(font.getBestCmap() or {})
    if not points or any(point > 0x10ffff or 0xd800 <= point <= 0xdfff for point in points):
        raise FontFailure('invalid-font')
    cmap = font.getBestCmap()
    allowed_empty = ({'.notdef'} | {name for point, name in cmap.items() if empty_character(point)}) - {name for point, name in cmap.items() if not empty_character(point)}
    normalized = io.BytesIO()
    stage = 'normalize'
    corrected_bearings = preserve_outline_origins(font, origins) if origins else 0
    font.save(normalized, reorderTables=True)
    static = normalized.getvalue()
    required = required_outline_glyphs(static, points) if removed_bitmaps else set()
    core = points & (set(range(0x20, 0x800)) | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3100)))
    groups = [('core', core)] if core else []
    pages = {}
    for point in points - core:
        pages.setdefault(point // 512, set()).add(point)
    groups += [(f'u{page * 512:06x}', chars) for page, chars in sorted(pages.items())]
    if len(groups) > 4096:
        raise FontFailure('resource-limit')
    shards = []
    for ident, chars in groups:
        part = TTFont(io.BytesIO(static), recalcTimestamp=False)
        options = subset.Options()
        options.hinting = False
        options.recalc_timestamp = False
        options.canonical_order = True
        options.name_IDs = ['*']
        options.name_languages = ['*']
        options.name_legacy = True
        options.layout_features = ['*']
        options.notdef_glyph = options.notdef_outline = options.recommended_glyphs = True
        sub = subset.Subsetter(options=options)
        sub.populate(unicodes=sorted(chars))
        stage = 'subset'
        sub.subset(part)
        if removed_bitmaps:
            validate_outline_glyphs(part, allowed_empty, required)
        family = 'WYF2-' + params['buildKey'][:32] + '-' + ident
        stage = 'rename'
        rename(part, family)
        if set(part.getBestCmap() or {}) != chars:
            raise FontFailure('processing-failed')
        raw = io.BytesIO()
        part.flavor = None
        stage = 'serialize-mobile'
        part.save(raw, reorderTables=True)
        extension = 'otf' if part.sfntVersion == 'OTTO' else 'ttf'
        mobile = asset(raw.getvalue(), extension)
        compressed = TTFont(io.BytesIO(raw.getvalue()), recalcTimestamp=False)
        compressed.flavor = 'woff2'
        web = io.BytesIO()
        stage = 'serialize-web'
        compressed.save(web, reorderTables=True)
        shards.append({'id': ident, 'family': family, 'unicodeRanges': ranges(chars), 'codepointCount': len(chars), 'web': asset(web.getvalue(), 'woff2'), 'mobile': mobile})
    stage = 'render-specimen'
    image = Image.new('RGBA', (640, 160), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    size = 64
    text = config['specimenText']
    while True:
        face = ImageFont.truetype(io.BytesIO(static), size=size)
        if draw.textlength(text, font=face) <= 608 or size <= 10:
            break
        size -= 2
    draw.text((320, 80), text, font=face, fill=(128, 128, 128, 255), anchor='mm')
    picture = io.BytesIO()
    image.save(picture, format='PNG', optimize=False)
    specimen = asset(picture.getvalue(), 'png')
    stage = 'write-manifest'
    notices = [asset(canonical({'author': config['author'], 'sourceUrl': config['sourceUrl'], 'licenseName': config['licenseName'], 'licenseText': config['licenseText'], 'sourceSha256': params['sourceSha256'], 'axes': axes, 'originalWeight': original_weight, 'defaultInstanceWeight': default_instance_weight, 'outputWeight': 400, 'outputStyle': 'normal', 'modifications': 'Default-axis instance; subset with layout closure; renamed; no hinting; normalized regular style.' + (' Removed embedded bitmap tables: ' + ', '.join(removed_bitmaps) + '.' if removed_bitmaps else '') + (' Corrected stale glyph bounds and bearings while preserving outline origins.' if corrected_bearings else '')}), 'json')]
    manifest = {'manifestVersion': 2, 'buildKey': params['buildKey'], 'sourceSha256': params['sourceSha256'], 'baseWeight': 400, 'baseStyle': 'normal', 'coverage': {'codepointCount': len(points), 'unicodeRanges': ranges(points)}, 'shards': shards, 'notices': notices, 'specimen': specimen}
    manifest_bytes = canonical(manifest)
    if len(manifest_bytes) > 4194304:
        raise FontFailure('resource-limit')
    descriptor = asset(manifest_bytes, 'json')
    (OUTPUT / 'result.json').write_bytes(canonical({'manifest': descriptor}))

def fail(code, category, reason=None):
    # 仅传固定阶段与类别给父进程；绝不输出异常正文、路径、字体名称或栈。
    value = {'failureCode': code, 'diagnostic': {'stage': stage, 'category': category}}
    if reason is not None:
        value['failureReason'] = reason
    sys.stdout.write(json.dumps(value))
    sys.exit(2)

try:
    build()
except FontFailure as error:
    fail(str(error), 'validation', getattr(error, 'reason', None))
except MemoryError:
    fail('resource-limit', 'memory-error')
except (TTLibError, struct.error):
    fail('invalid-font', 'invalid-font')
except Exception as error:
    categories = ((ValueError, 'value-error'), (TypeError, 'type-error'),
                  (KeyError, 'key-error'), (AttributeError, 'attribute-error'),
                  (OSError, 'io-error'), (AssertionError, 'assertion-error'),
                  (NotImplementedError, 'unsupported-operation'))
    category = next((label for kind, label in categories if isinstance(error, kind)), 'unexpected-error')
    fail('processing-failed', category)
