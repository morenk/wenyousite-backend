"""自制传统位图混合夹具；真实 sbit strike 与矢量轮廓独立。"""
import struct
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.DefaultTable import DefaultTable
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen

def add_bitmaps(font):
    glyph = font.getGlyphID('A')
    metrics = struct.pack('>bbBbbbbbbbbb', 8, 0, 8, 1, 0, 0, 0, 0, 8, 0, 0, 0)
    image = struct.pack('>BBbbB', 8, 8, 0, 8, 8) + bytes([255] * 8)
    size = struct.pack('>LLLL', 56, 24, 1, 0) + metrics * 2 + struct.pack('>HHBBBB', glyph, glyph, 64, 64, 1, 1)
    tables = {
        'EBDT': struct.pack('>L', 0x00020000) + image,
        'EBLC': struct.pack('>LL', 0x00020000, 1) + size + struct.pack('>HHL', glyph, glyph, 8) + struct.pack('>HHL', 1, 1, 4) + struct.pack('>LL', 0, len(image)),
        'EBSC': struct.pack('>LL', 0x00020000, 1) + metrics * 2 + bytes([64, 64, 64, 64]),
    }
    for tag, data in tables.items():
        font[tag] = DefaultTable(tag)
        font[tag].data = data

def empty_outline(font, name):
    if 'glyf' in font:
        font['glyf'][name] = TTGlyphPen(None).glyph()
    else:
        top = font['CFF '].cff.topDictIndex[0]
        top.CharStrings[name] = T2CharStringPen(font['hmtx'][name][0], None).getCharString(private=top.Private, globalSubrs=font['CFF '].cff.GlobalSubrs)

def make_bitmaps(root):
    for extension in ('ttf', 'otf'):
        font = TTFont(root / ('format-static.' + extension), recalcTimestamp=False)
        # 合法无轮廓空白、格式符、variation selector，仍完整保留 coverage/字宽。
        for table in font['cmap'].tables:
            if table.isUnicode():
                table.cmap.update({0x00a0: 'space', 0x2003: 'space', 0x200b: 'space', 0x034f: 'space', 0xfe0f: 'space'})
        add_bitmaps(font)
        font.save(root / ('format-bitmap.' + extension))
        # 自制位图结构必须可解编译，避免只测试几个无效 tag。
        probe = TTFont(root / ('format-bitmap.' + extension))
        probe.ensureDecompiled()
        assert len(probe['EBLC'].strikes) == 1 and probe['EBDT'].strikeData[0]['A'].imageData == bytes([255] * 8)
        for target, label in [('A', 'missing-outline'), ('fi', 'missing-ligature')]:
            broken = TTFont(root / ('format-bitmap.' + extension), recalcTimestamp=False)
            empty_outline(broken, target)
            broken.save(root / ('fixture-bitmap-' + label + '.' + extension))
        alias = TTFont(root / ('format-bitmap.' + extension), recalcTimestamp=False)
        for table in alias['cmap'].tables:
            if table.isUnicode(): table.cmap[65] = 'space'
        alias.save(root / ('fixture-bitmap-visible-space-alias.' + extension))
    for extension in ('ttf', 'otf'):
        variable = TTFont(root / ('format-variable-2.' + extension), recalcTimestamp=False)
        add_bitmaps(variable)
        variable.save(root / ('format-bitmap-variable-2.' + extension))
    recommended = TTFont(root / 'format-bitmap.ttf', recalcTimestamp=False)
    recommended.ensureDecompiled()
    order = recommended.getGlyphOrder()
    recommended.setGlyphOrder(order[:1] + ['unencodedNull'] + order[1:])
    recommended['glyf']['unencodedNull'] = TTGlyphPen(None).glyph()
    recommended['hmtx']['unencodedNull'] = (0, 0)
    recommended['vmtx']['unencodedNull'] = (0, 0)
    recommended.save(root / 'format-bitmap-recommended.ttf')
    from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
    addOpenTypeFeaturesFromString(recommended, 'feature calt { sub A by unencodedNull; } calt;')
    recommended.save(root / 'fixture-bitmap-recommended-substitution.ttf')
    stale = TTFont(root / 'format-bitmap.ttf', recalcTimestamp=False)
    stale.ensureDecompiled()
    for name in stale.getGlyphOrder():
        glyph = stale['glyf'][name]
        if glyph.numberOfContours:
            glyph.xMin = -200
            glyph.yMax = 1400
    from fontTools.ttLib.tables._g_l_y_f import USE_MY_METRICS
    stale['glyf']['Aacute'].components[0].flags |= USE_MY_METRICS
    stale.recalcBBoxes = False
    stale.save(root / 'format-bitmap-stale-bounds.ttf')
    pure = TTFont(root / 'format-bitmap.ttf', recalcTimestamp=False)
    del pure['glyf']; del pure['loca']
    pure.save(root / 'fixture-bitmap-no-outlines.ttf')
    restricted = TTFont(root / 'format-bitmap.ttf', recalcTimestamp=False)
    restricted['OS/2'].fsType = 0x0200
    restricted.save(root / 'fixture-bitmap-restricted.ttf')
    # 彩色位图 / sbix 的 tag 即拒绝，内容无需进入解析器。
    for tag in ('CBDT', 'CBLC', 'sbix'):
        colored = TTFont(root / 'format-bitmap.ttf', recalcTimestamp=False)
        colored[tag] = DefaultTable(tag); colored[tag].data = bytes(8)
        colored.save(root / ('fixture-bitmap-color-' + tag + '.ttf'))
