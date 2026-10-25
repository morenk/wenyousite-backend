#!/usr/bin/python3
"""自制几何字形；可在客户端构建后经真实管理 API 上传，用于同会话旅程。"""
import sys
sys.dont_write_bytecode = True
from pathlib import Path
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--toolchain', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
sys.path.insert(0, str(Path(args.toolchain).resolve()))
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

def make(path, variant, variable=None):
    font = FontBuilder(1000, isTTF=variable != 'cff2')
    points = {32: 'space', 65: 'A', 66: 'B', 20013: 'uni4E2D', 25991: 'uni6587'}
    names = ['.notdef'] + list(points.values())
    font.setupGlyphOrder(names)
    font.setupCharacterMap(points)
    glyphs = {}
    for name in names:
        pen = TTGlyphPen(None)
        if name != 'space':
            pen.moveTo((80, 0)); pen.lineTo((520, 0)); pen.lineTo((300, 720) if variant == 2 else (520, 720))
            if variant != 2: pen.lineTo((80, 720))
            pen.closePath()
        glyphs[name] = pen.glyph()
    if variable != 'cff2':
        font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({name: (600, 0) for name in names})
    font.setupHorizontalHeader(ascent=800, descent=-200)
    font.setupNameTable({'familyName': 'WenyouFixture', 'styleName': 'Regular', 'uniqueFontIdentifier': 'WenyouFixture-' + str(variant), 'fullName': 'WenyouFixture Regular', 'psName': 'WenyouFixture-Regular'})
    font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    font.setupPost(); font.setupMaxp()
    if variable:
        # 非最小默认值和真实轮廓增量，防止只删除 fvar 而未正确实例化。
        font.setupFvar([('BLED', 0, 40, 100, 'Bleed'), ('SCAN', -100, 20, 100, 'Scan')], [])
        if variable == 'ttf':
            from fontTools.ttLib.tables.TupleVariation import TupleVariation
            font.setupGvar({name: [] if name == 'space' else [
                TupleVariation({'BLED': (0, 1, 1)}, [(120, 0)] * 4 + [(0, 0)] * 4),
                TupleVariation({'SCAN': (-1, -1, 0)}, [(0, 80)] * 4 + [(0, 0)] * 4),
            ] for name in names})
        else:
            from fontTools.misc.psCharStrings import T2CharString
            # 两个 region 的 blend 让 CFF2 转换路径实际处理可变轮廓。
            strings = {name: T2CharString(program=[] if name == 'space' else [
                80, 120, -60, 1, 'blend', 0, 'rmoveto',
                440, 0, 0, 720, -440, 0, 'rlineto',
            ]) for name in names}
            font.setupCFF2(strings, regions=[{'BLED': (0, 1, 1)}, {'SCAN': (-1, -1, 0)}])
    font.font['head'].created = font.font['head'].modified = 2082844800
    font.save(path)

if __name__ == '__main__':
    root = Path(args.output); root.mkdir(parents=True, exist_ok=True)
    for variant in (1, 2): make(root / ('fixture-' + str(variant) + '.ttf'), variant)
    make(root / 'fixture-variable.ttf', 1, 'ttf')
    make(root / 'fixture-variable.otf', 1, 'cff2')
    from fontTools.ttLib import TTFont, newTable
    from fontTools.colorLib.builder import buildCOLR, buildCPAL
    restricted = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
    restricted['OS/2'].fsType = 0x0100
    restricted.save(root / 'fixture-no-subsetting.ttf')
    colored = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
    colored['COLR'] = buildCOLR({'A': [('A', 0)]}, version=0)
    colored['CPAL'] = buildCPAL([[(0.5, 0.5, 0.5, 1.0)]])
    colored.save(root / 'fixture-color.ttf')
    large = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
    large['TEST'] = newTable('TEST')
    large['TEST'].data = bytes(11 * 1024 * 1024)
    large.save(root / 'fixture-large.ttf')

    for bits, label in [(2, 'restricted'), (512, 'bitmap-only'), (770, 'combined-restrictions')]:
        limited = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
        limited['OS/2'].fsType = bits
        limited.save(root / ('fixture-' + label + '.ttf'))
    licensed = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
    licensed['name'].setName('Copyright Example\r\nPermission to redistribute.\n\tKeep this notice.', 13, 3, 1, 0x409)
    licensed['name'].setName('Original fixture designer', 9, 3, 1, 0x409)
    licensed.save(root / 'fixture-multiline-license.ttf')
    malformed = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
    from fontTools.ttLib.tables._n_a_m_e import NameRecord
    record = NameRecord(); record.nameID = 13; record.platformID = 3; record.platEncID = 1; record.langID = 0x409; record.string = b'\x00'
    malformed['name'].names.append(record)
    malformed.save(root / 'fixture-malformed-license.ttf')

    for label, count, text in [('oversize-license', 1, 'A' * 8193), ('many-license', 300, 'A'), ('total-license', 20, 'A' * 8192), ('control-license', 1, 'bad\x00text')]:
        bounded = TTFont(root / 'fixture-1.ttf', recalcTimestamp=False)
        for index in range(count): bounded['name'].setName(text, 13, 3, 1, 0x1000 + index)
        bounded.save(root / ('fixture-' + label + '.ttf'))

    import runpy
    runpy.run_path(str(Path(__file__).with_name('make-format-fixtures.py')))['make_formats'](root)
    from fontTools.ttLib import TTCollection
    collection = TTCollection(); collection.fonts = [TTFont(root / 'fixture-1.ttf')]
    collection.save(root / 'fixture-collection.ttc')
    svg = TTFont(root / 'fixture-1.ttf')
    from fontTools.ttLib.tables.S_V_G_ import SVGDocument
    svg['SVG '] = newTable('SVG ')
    svg['SVG '].docList = [SVGDocument('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 0L0 10Z"/></svg>', 2, 2)]
    svg.save(root / 'fixture-svg.ttf')
    empty = TTFont(root / 'fixture-1.ttf')
    for table in empty['cmap'].tables: table.cmap = {}
    empty.save(root / 'fixture-empty-cmap.ttf')
    (root / 'fixture-truncated.ttf').write_bytes((root / 'fixture-1.ttf').read_bytes()[:30])

    runpy.run_path(str(Path(__file__).with_name('make-bitmap-fixtures.py')))['make_bitmaps'](root)
