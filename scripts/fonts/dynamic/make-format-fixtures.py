"""自制格式/布局/度量夹具；不读取外部字体。"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.feaLib.builder import addOpenTypeFeaturesFromString
from fontTools.designspaceLib import DesignSpaceDocument, AxisDescriptor, SourceDescriptor
from fontTools.varLib import build
from fontTools.ttLib import newTable

def master(flavor, delta=0):
    fb = FontBuilder(1000, isTTF=flavor == 'ttf')
    chars = {32: 'space', 65: 'A', 86: 'V', 102: 'f', 105: 'i', 193: 'Aacute', 769: 'acute', 87: 'W', 101: 'e', 110: 'n', 121: 'y', 111: 'o', 117: 'u', 97: 'a', 48: 'zero', 49: 'one', 50: 'two', 51: 'three', 28201: 'uni6E29', 27833: 'uni6CB9', 25991: 'uni6587', 23383: 'uni5B57'}
    names = ['.notdef'] + list(chars.values()) + ['fi']
    fb.setupGlyphOrder(names)
    fb.setupCharacterMap(chars)
    outlines = {}
    for name in names:
        pen = TTGlyphPen(None) if flavor == 'ttf' else T2CharStringPen(600 + 20 * delta, None)
        if name != 'space':
            pen.moveTo((80 + 10 * delta, 0))
            pen.lineTo((500 + 10 * delta, 0))
            pen.lineTo((400, 700 + 20 * delta))
            pen.lineTo((100, 700 + 20 * delta))
            pen.closePath()
        outlines[name] = pen.glyph() if flavor == 'ttf' else pen.getCharString()
    if flavor == 'ttf':
        pen = TTGlyphPen(outlines)
        pen.addComponent('A', (1, 0, 0, 1, 0, 0))
        pen.addComponent('acute', (0.2, 0, 0, 0.2, 180, 750))
        outlines['Aacute'] = pen.glyph()
        fb.setupGlyf(outlines)
    else:
        fb.setupCFF('WenyouFormatFixture', {'FullName': 'Wenyou Format Fixture', 'FamilyName': 'Wenyou Format Fixture', 'Weight': 'Regular'}, outlines, {})
    metrics = {name: (600 + 20 * delta, 80 + 10 * delta) for name in names}
    metrics['fi'] = (850 + 20 * delta, 80 + 10 * delta)
    metrics['acute'] = (0, 80 + 10 * delta)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=850 + 10 * delta, descent=-200)
    fb.setupVerticalMetrics({name: (1100 + 30 * delta, 100) for name in names})
    fb.setupVerticalHeader(ascent=850 + 10 * delta, descent=-200)
    fb.setupNameTable({'familyName': 'Wenyou Format Fixture', 'styleName': 'Regular', 'uniqueFontIdentifier': 'WenyouFormatFixture', 'fullName': 'Wenyou Format Fixture', 'psName': 'WenyouFormatFixture'})
    fb.setupOS2(sTypoAscender=850 + 10 * delta, sTypoDescender=-200, usWinAscent=1000, usWinDescent=200)
    fb.setupPost()
    fb.setupMaxp()
    addOpenTypeFeaturesFromString(fb.font, f'feature liga {{sub f i by fi;}} liga; feature kern {{pos A V {-90 - 10 * delta};}} kern; markClass acute <anchor 100 0> @TOP; feature mark {{pos base A <anchor 300 720> mark @TOP; pos base V <anchor 300 720> mark @TOP;}} mark;')
    fb.font['head'].created = fb.font['head'].modified = 2082844800
    return fb.font

def make_formats(root):
    root = Path(root)
    for flavor in ['ttf', 'otf']:
        master(flavor).save(root / f'format-static.{flavor}')
        for dimensions in [1, 2]:
            ds = DesignSpaceDocument()
            defs = [('Weight', 'wght', 100, 650, 900)] + ([('Custom', 'TEST', -100, 20, 100)] if dimensions == 2 else [])
            for name, tag, minimum, default, maximum in defs:
                axis = AxisDescriptor()
                axis.name = name
                axis.tag = tag
                axis.minimum = minimum
                axis.default = default
                axis.maximum = maximum
                ds.addAxis(axis)
            locations = [({name: default for name, _, _, default, _ in defs}, 0)]
            for name, _, minimum, default, maximum in defs:
                for value, delta in [(minimum, -2), (maximum, 3)]:
                    location = {n: d for n, _, _, d, _ in defs}
                    location[name] = value
                    locations.append((location, delta))
            for index, (location, delta) in enumerate(locations):
                src = SourceDescriptor()
                src.name = f'master{index}'
                src.location = location
                src.font = master(flavor, delta)
                ds.addSource(src)
            font, _, _ = build(ds)
            font['avar'] = newTable('avar')
            font['avar'].segments = {tag: {-1.0: -1.0, 0.0: 0.0, 0.5: 0.7, 1.0: 1.0} for _, tag, _, _, _ in defs}
            font['head'].created = font['head'].modified = 2082844800
            font.save(root / f'format-variable-{dimensions}.{flavor}')
