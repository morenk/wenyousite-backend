"""产物回归验证器：所有字体解析、默认轴比较与排版渲染留在离线沙箱。"""
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
from fontTools.varLib.varStore import VarStoreInstancer
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.varLib.mvar import MVAR_ENTRIES
from fontTools.misc.roundTools import otRound
from PIL import Image, ImageDraw, ImageFont, ImageChops, features

root = Path('/input')
manifest = json.loads((root / 'manifest.json').read_bytes())
settings = json.loads((root / 'verification.json').read_bytes()) if (root / 'verification.json').exists() else {}
source_bytes = (root / 'source').read_bytes() if (root / 'source').exists() else None
source = TTFont(io.BytesIO(source_bytes), recalcTimestamp=False) if source_bytes else None
axes = {axis.axisTag: axis.defaultValue for axis in source['fvar'].axes} if source and 'fvar' in source else {}
source_glyphs = source.getGlyphSet(location=axes) if source else None
variable_tables = {'fvar', 'gvar', 'CFF2', 'avar', 'HVAR', 'VVAR', 'MVAR', 'cvar', 'VARC'}

def require(condition, code, **details):
    if not condition:
        # 只保存受控测试分类和数值定位；不输出字体名称、正文或原始异常。
        Path('/output/verification-failure.json').write_text(json.dumps({'check': code, **details}))
        raise AssertionError(code)

def read_asset(asset):
    value = (root / (asset['sha256'] + '.' + asset['format'])).read_bytes()
    assert len(value) == asset['bytes'] and hashlib.sha256(value).hexdigest() == asset['sha256']
    return value

def points(ranges):
    result = set()
    for item in ranges:
        edges = item[2:].split('-'); result.update(range(int(edges[0],16),int(edges[-1],16)+1))
    return result

def outline(glyphs, name):
    pen = DecomposingRecordingPen(glyphs); glyphs[name].draw(pen); return pen.value

def fixture_ligatures(font, glyphs):
    cmap = font.getBestCmap()
    values = []
    for lookup in font['GSUB'].table.LookupList.Lookup:
        if lookup.LookupType != 4: continue
        for table in lookup.SubTable:
            for ligature in table.ligatures.get(cmap[ord('f')], []):
                if ligature.Component == [cmap[ord('i')]]:
                    name = ligature.LigGlyph
                    values.append([outline(glyphs,name), glyphs[name].width])
    assert values
    return values

def layout(face, text):
    return [face.getlength(text), face.getlength(text, features=['-kern']), face.getlength(text, features=['-liga'])]

if settings.get('fixture') and axes:
    assert {'avar','HVAR','VVAR','MVAR','GSUB','GPOS'} <= set(source.keys())
    assert source['GDEF'].table.VarStore is not None
    assert all(axis.minValue < axis.defaultValue < axis.maxValue for axis in source['fvar'].axes)
    extreme = source.getGlyphSet(location={axis.axisTag:axis.minValue for axis in source['fvar'].axes})
    name = source.getBestCmap()[ord('A')]
    assert outline(extreme,name) != outline(source_glyphs,name)
    assert extreme[name].width != source_glyphs[name].width

assert features.check('raqm'), '测试需要固定 Pillow 的真实排版支持'
source_face = ImageFont.truetype(io.BytesIO(source_bytes), size=1000) if source_bytes else None
metric_deltas = {}
if source and 'MVAR' in source:
    table = source['MVAR'].table
    instancer = VarStoreInstancer(table.VarStore, source['fvar'].axes, {tag:0 for tag in axes})
    metric_deltas = {MVAR_ENTRIES[v.ValueTag]: otRound(instancer[v.VarIdx]) for v in table.ValueRecord if v.ValueTag in MVAR_ENTRIES}
vertical_instancer = VarStoreInstancer(source['VVAR'].table.VarStore, source['fvar'].axes, {tag:0 for tag in axes}) if source and 'VVAR' in source else None
count, formats, rendered, shaped, all_points = 0, set(), 0, 0, set()
for shard_index, shard in enumerate(manifest['shards']):
    web_bytes, mobile_bytes = read_asset(shard['web']), read_asset(shard['mobile'])
    web = TTFont(io.BytesIO(web_bytes), recalcTimestamp=False, checkChecksums=2)
    mobile = TTFont(io.BytesIO(mobile_bytes), recalcTimestamp=False, checkChecksums=2)
    assert web.flavor == 'woff2' and mobile.flavor is None
    expected = points(shard['unicodeRanges']); assert len(expected) == shard['codepointCount']
    assert not all_points & expected; all_points.update(expected)
    for font in (web, mobile):
        font.ensureDecompiled()
        require(not set(font.keys()) & variable_tables, 'remaining-variable-tables', tables=sorted(set(font.keys()) & variable_tables))
        assert set(font.getBestCmap()) == expected
        assert font['OS/2'].usWeightClass == 400 and font['head'].macStyle & 3 == 0
        assert font['OS/2'].fsSelection & ((1<<0)|(1<<5)|(1<<9)) == 0
        if 'GDEF' in font: assert getattr(font['GDEF'].table, 'VarStore', None) is None
        for tag in ['GSUB', 'GPOS']:
            if tag in font: assert getattr(font[tag].table, 'FeatureVariations', None) is None
        for name_id in (1,4,6,16): assert font['name'].getName(name_id,3,1,0x409).toUnicode() == shard['family']
        if source:
            for tag, fields in [('OS/2',['sTypoAscender','sTypoDescender','sTypoLineGap','usWinAscent','usWinDescent']),('hhea',['ascent','descent','lineGap']),('vhea',['ascent','descent','lineGap'])]:
                if tag in source:
                    for field in fields:
                        require(getattr(font[tag],field)==getattr(source[tag],field)+metric_deltas.get((tag,field),0),'global-metrics',shard=shard_index)
    assert ('CFF ' in mobile and mobile.sfntVersion=='OTTO') if shard['mobile']['format']=='otf' else ('glyf' in mobile and mobile.sfntVersion=='\x00\x01\x00\x00')
    web_glyphs, mobile_glyphs = web.getGlyphSet(), mobile.getGlyphSet()
    for point in sorted(expected):
        w,m = web.getBestCmap()[point],mobile.getBestCmap()[point]
        wp,mp=outline(web_glyphs,w),outline(mobile_glyphs,m)
        require(wp==mp and web_glyphs[w].width==mobile_glyphs[m].width,'web-mobile-outlines',point=point,shard=shard_index)
        if source_glyphs is not None:
            original_name=source.getBestCmap()[point];original=source_glyphs[original_name]
            original_pen=outline(source_glyphs,original_name)
            require(mp==original_pen,'source-outlines',point=point,shard=shard_index,outputCommands=len(mp),sourceCommands=len(original_pen))
            require(mobile_glyphs[m].width==original.width,'source-advance',point=point,shard=shard_index)
            if 'vmtx' in source:
                advance,bearing=source['vmtx'][original_name]
                if vertical_instancer:
                    table=source['VVAR'].table
                    index=table.AdvHeightMap.mapping[original_name] if table.AdvHeightMap else source.getGlyphID(original_name)
                    advance+=otRound(vertical_instancer[index])
                require(mobile['vmtx'][m][0]==advance,'vertical-advance',point=point,shard=shard_index)
    face = ImageFont.truetype(io.BytesIO(mobile_bytes), size=1000)
    for text in ['AV','fi','A\u0301','Wenyou Aa 0123','温油文字']:
        if source_face and set(map(ord,text)) <= expected:
            require(layout(face,text)==layout(source_face,text),'shaping',shard=shard_index)
            shaped+=1
    if settings.get('fixture') and ord('A') in expected:
        assert all(tag in mobile for tag in ['GSUB','GPOS'])
        assert face.getlength('AV') < face.getlength('AV',features=['-kern'])
        assert face.getlength('fi') < face.getlength('fi',features=['-liga'])
        assert fixture_ligatures(mobile,mobile_glyphs) == fixture_ligatures(source,source_glyphs)
        assert fixture_ligatures(web,web_glyphs) == fixture_ligatures(source,source_glyphs)
        # V+acute 没有预组字符，避免先组合为 Aacute 后实际绕过 GPOS mark。
        assert face.getbbox('V\u0301') != face.getbbox('V\u0301',features=['-mark'])
        assert face.getbbox('V\u0301') == source_face.getbbox('V\u0301')
    small = ImageFont.truetype(io.BytesIO(mobile_bytes),size=32)
    sample=''.join(chr(p) for p in sorted(expected) if p>=33)[:32]
    canvas=Image.new('L',(2048,128));ImageDraw.Draw(canvas).text((8,8),sample,font=small,fill=255)
    rendered += int(canvas.getbbox() is not None);formats.add(shard['mobile']['format']);count+=len(expected)
assert count==manifest['coverage']['codepointCount'] and all_points==points(manifest['coverage']['unicodeRanges'])
if source: assert all_points==set(source.getBestCmap())
assert rendered>0
picture=Image.open(io.BytesIO(read_asset(manifest['specimen'])));picture.load()
assert picture.size==(640,160) and picture.getbbox() is not None
raster_difference = None
if 'specimenText' in settings:
    specimen_source = source_bytes
    if axes:
        # 自制无 hint glyf 的变量/静态扫描曾出现 2/255 的 alpha 差异。PNG 文案与
        # 序列化静态默认实例精确比较；上面的源默认轮廓和 advance 仍逐点零容差。
        reference = instantiateVariableFont(source, axes, inplace=False, downgradeCFF2=('CFF2' in source))
        buffer = io.BytesIO(); reference.save(buffer); specimen_source = buffer.getvalue()
    expected_picture=Image.new('RGBA',(640,160),(0,0,0,0));draw=ImageDraw.Draw(expected_picture);size=64
    while True:
        face=ImageFont.truetype(io.BytesIO(specimen_source),size=size)
        if draw.textlength(settings['specimenText'],font=face)<=608 or size<=10: break
        size-=2
    draw.text((320,80),settings['specimenText'],font=face,fill=(128,128,128,255),anchor='mm')
    if axes:
        direct=Image.new('RGBA',(640,160),(0,0,0,0));direct_draw=ImageDraw.Draw(direct)
        direct_face=ImageFont.truetype(io.BytesIO(source_bytes),size=size)
        direct_draw.text((320,80),settings['specimenText'],font=direct_face,fill=(128,128,128,255),anchor='mm')
        raster_difference={'sourceBox':direct.getbbox(),'staticBox':expected_picture.getbbox(),'channelDifferenceExtrema':ImageChops.difference(direct,expected_picture).getextrema()}
    require(picture.tobytes()==expected_picture.tobytes(),'specimen-text', actualBox=picture.getbbox(), expectedBox=expected_picture.getbbox(), differenceBox=ImageChops.difference(picture,expected_picture).getbbox(), expectedLength=draw.textlength(settings['specimenText'],font=face), actualSize=size)
for notice in manifest['notices']:
    value=json.loads(read_asset(notice))
    if source: assert value['axes']==axes
Path('/output/evidence.json').write_text(json.dumps({
    'passed':True,'shards':len(manifest['shards']),'codepoints':count,'mobileFormats':sorted(formats),'webFormat':'woff2',
    'matchingOutlines':True,'mobileRendered':True,'specimenRendered':True,'defaultInstanceOutlines':source is not None,
    'rasterReference':'serialized-default-instance','sourceRasterDifference':raster_difference,'specimenTextVerified':'specimenText' in settings,'shapingComparisons':shaped,'variableTablesRemoved':True,
    'sourceTables':sorted(variable_tables.intersection(source.keys())) if source else [],'axes':axes,
    'renderer':{'freetype':features.version('freetype2'),'raqm':features.version('raqm'),'harfbuzz':features.version('harfbuzz')},
}))
