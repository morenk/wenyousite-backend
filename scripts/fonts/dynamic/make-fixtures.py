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

def make(path, variant):
    font = FontBuilder(1000, isTTF=True)
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
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({name: (600, 0) for name in names})
    font.setupHorizontalHeader(ascent=800, descent=-200)
    font.setupNameTable({'familyName': 'WenyouFixture', 'styleName': 'Regular', 'uniqueFontIdentifier': 'WenyouFixture-' + str(variant), 'fullName': 'WenyouFixture Regular', 'psName': 'WenyouFixture-Regular'})
    font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    font.setupPost(); font.setupMaxp()
    font.font['head'].created = font.font['head'].modified = 2082844800
    font.save(path)

if __name__ == '__main__':
    root = Path(args.output); root.mkdir(parents=True, exist_ok=True)
    for variant in (1, 2): make(root / ('fixture-' + str(variant) + '.ttf'), variant)
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
