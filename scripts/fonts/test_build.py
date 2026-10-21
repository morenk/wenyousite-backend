"""只使用本测试生成的字形和临时目录；不下载资源，不访问业务服务。"""
import hashlib
import copy
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables import otTables
import build


def fixture_font(points=None, embedding=0):
    points = points or (build.ASCII | {ord('温'), ord('油'), 0x1F42E})
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(['.notdef', 'shape'])
    pen = TTGlyphPen(None)
    pen.moveTo((80, 0)); pen.lineTo((480, 0)); pen.lineTo((280, 600)); pen.closePath()
    shape = pen.glyph()
    builder.setupGlyf({'.notdef': shape, 'shape': shape})
    builder.setupHorizontalMetrics({'.notdef': (600, 0), 'shape': (600, 0)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupCharacterMap({point: 'shape' for point in points})
    builder.setupNameTable({'familyName': 'Reserved Source Fixture', 'styleName': 'Regular',
                           'uniqueFontIdentifier': 'fixture', 'fullName': 'Reserved Source Fixture',
                           'psName': 'ReservedSourceFixture', 'version': 'Version 1.0',
                           'copyright': 'Copyright test fixture authors',
                           'licenseDescription': 'Test fixture OFL-1.1'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200, fsType=embedding)
    builder.setupPost(); builder.setupMaxp()
    target = io.BytesIO(); builder.save(target)
    return target.getvalue()


class FontPipelineTests(unittest.TestCase):
    def test_catalog_refresh_keeps_assets_immutable_and_checks_source_identity(self):
        source = {'id': 'fixture', 'status': 'locked', 'sha256': 'a' * 64,
                  'bytes': 123, 'sourceRevision': 'v1', 'license': 'OFL-1.1', 'licenseSha256': 'b' * 64}
        family = {'id': 'fixture', 'availability': 'ready', 'sourceSha256': 'a' * 64,
                  'fontSha256': 'a' * 64, 'sourceBytes': 123, 'sourceRevision': 'v1', 'license': 'OFL-1.1',
                  'notices': [{'kind': 'license', 'sha256': 'b' * 64}], 'shards': [{'immutable': True}]}
        manifest = {'toolchain': build.TOOLCHAIN, 'limits': build.LIMITS, 'fonts': [family], 'catalogVersion': '1.0.0'}
        before = copy.deepcopy(manifest)
        entry = {'id': 'fixture', 'name': '测试', 'designLanguage': 'ja', 'availability': 'ready'}
        pending = {'id': 'pending', 'name': '待接入', 'designLanguage': 'zh', 'availability': 'pendingSource'}
        catalog = {'catalogVersion': '1.1.0', 'fonts': [entry, pending]}
        sources = {'fonts': [source, {'id': 'pending', 'status': 'pendingSource'}]}
        result = build.refresh_catalog(manifest, catalog, sources)
        self.assertEqual(manifest, before)
        self.assertEqual(result['fonts'][0]['shards'], family['shards'])
        self.assertEqual(result['fonts'][0]['designLanguage'], 'ja')
        self.assertEqual(result['fonts'][1]['shards'], [])
        for key, value in [('sha256', 'c' * 64), ('licenseSha256', 'c' * 64),
                           ('readmeSha256', 'c' * 64), ('instance', {'wght': 400}), ('deliveryMode', 'original')]:
            changed = copy.deepcopy(sources); changed['fonts'][0][key] = value
            with self.assertRaisesRegex(ValueError, 'catalog_refresh'):
                build.refresh_catalog(manifest, catalog, changed)
        catalog['fonts'] = [pending]
        self.assertEqual(len(build.refresh_catalog(manifest, catalog, sources)['fonts']), 1)

    def test_fixed_partition_is_disjoint_and_retains_supplementary_characters(self):
        points = build.ASCII | build.gb2312() | {0x20000, 0x2FFFD, 0x10FFFD}
        shards = build.partition(points)
        self.assertEqual(shards[0][0], 'core')
        self.assertEqual(len(build.gb2312()), 6763)
        self.assertEqual(len(build.gb2312(True)), 3755)
        self.assertEqual(set.union(*(chars for _, chars in shards)), points)
        self.assertEqual(sum(len(chars) for _, chars in shards), len(points))
        for _, chars in shards:
            self.assertEqual(build.expand_ranges(build.ranges(chars)), chars)

    def test_subset_is_reproducible_and_retains_attribution_without_rfn(self):
        payload = fixture_font()
        selected = {ord('温'), ord('A'), 0x1F42E}
        first = build.subset_font(payload, selected, 'WYF1-fixture-aabbccdd-core')
        self.assertEqual(first, build.subset_font(payload, selected, 'WYF1-fixture-aabbccdd-core'))
        self.assertEqual(first[2], 'ttf')
        for data in first[:2]:
            font = TTFont(io.BytesIO(data))
            self.assertEqual(set(font.getBestCmap()), selected)
            self.assertEqual(build.name_text(font, 0), ['Copyright test fixture authors'])
            self.assertEqual(build.name_text(font, 1), ['WYF1-fixture-aabbccdd-core'])
            self.assertEqual(build.name_text(font, 6), ['WYF1-fixture-aabbccdd-core'])

    def test_zero_gdef_version_repair_preserves_classes_and_layout_objects(self):
        font = TTFont(io.BytesIO(fixture_font()))
        font['GDEF'] = newTable('GDEF')
        table = font['GDEF'].table = otTables.GDEF()
        table.Version = 0
        table.GlyphClassDef = otTables.ClassDef()
        table.GlyphClassDef.classDefs = {'shape': 3, '.notdef': 1}
        table.AttachList = table.LigCaretList = table.MarkAttachClassDef = None
        original_classes = dict(table.GlyphClassDef.classDefs)
        class_table = table.GlyphClassDef
        self.assertEqual(build.repair_layout_header(font),
                         ['GDEF.Version: 0 -> 1.0; all layout classes retained'])
        self.assertEqual(table.Version, 0x00010000)
        self.assertIs(table.GlyphClassDef, class_table)
        self.assertEqual(table.GlyphClassDef.classDefs, original_classes)
        self.assertIsNone(table.AttachList)
        self.assertIsNone(table.LigCaretList)
        self.assertIsNone(table.MarkAttachClassDef)
        repaired = io.BytesIO(); font.save(repaired)
        decoded = TTFont(io.BytesIO(repaired.getvalue()))
        self.assertEqual(decoded['GDEF'].table.GlyphClassDef.classDefs, original_classes)

    def test_zero_gdef_version_with_unknown_extension_fails_without_mutation(self):
        font = TTFont(io.BytesIO(fixture_font()))
        font['GDEF'] = newTable('GDEF')
        table = font['GDEF'].table = otTables.GDEF()
        table.Version = 0
        table.VarStore = object()
        with self.assertRaisesRegex(ValueError, 'unsupported_gdef_zero_version_structure'):
            build.repair_layout_header(font)
        self.assertEqual(table.Version, 0)
        self.assertIn('VarStore', table.__dict__)

    def test_layout_repair_does_not_change_fonts_without_the_upstream_defect(self):
        font = TTFont(io.BytesIO(fixture_font()), recalcTimestamp=False)
        before = io.BytesIO(); font.save(before)
        self.assertEqual(build.repair_layout_header(font), [])
        after = io.BytesIO(); font.save(after)
        self.assertEqual(before.getvalue(), after.getvalue())
        for version in (0x00010000, 0x00010002, 0x00010003):
            font['GDEF'] = newTable('GDEF')
            table = font['GDEF'].table = otTables.GDEF()
            table.Version = version
            table.GlyphClassDef = otTables.ClassDef()
            table.GlyphClassDef.classDefs = {'shape': 3}
            original = dict(table.__dict__)
            self.assertEqual(build.repair_layout_header(font), [])
            self.assertEqual(table.__dict__, original)

    def test_source_hash_and_size_are_checked_on_cache_hits(self):
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory); data = b'test-source'; digest = build.sha(data)
            (cache / digest).write_bytes(data)
            self.assertEqual(build.acquire(None, digest, len(data), cache, None, None, False), cache / digest)
            (cache / digest).write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'source_size_mismatch'):
                build.acquire(None, digest, len(data), cache, None, None, False)
            with self.assertRaisesRegex(ValueError, 'source_hash_mismatch'):
                build.acquire(None, digest, None, cache, None, None, False)

    def test_derived_face_normalizes_heavy_italic_metadata_without_changing_outlines(self):
        font = TTFont(io.BytesIO(fixture_font()))
        font['OS/2'].version = 4
        font['OS/2'].usWeightClass = 900
        font['OS/2'].fsSelection = (1 << 0) | (1 << 5) | (1 << 9)
        font['head'].macStyle = 3
        font['post'].italicAngle = -11
        original_coordinates = list(font['glyf'][font.getBestCmap()[ord('A')]].coordinates)
        source = io.BytesIO(); font.save(source)
        sfnt, compressed, _ = build.subset_font(source.getvalue(), {ord('A')}, 'WYF1-aabbccdd-core')
        for payload in (sfnt, compressed):
            derived = TTFont(io.BytesIO(payload))
            self.assertEqual(derived['OS/2'].usWeightClass, 400)
            self.assertEqual(derived['OS/2'].fsSelection & ((1 << 0) | (1 << 5) | (1 << 9)), 0)
            self.assertTrue(derived['OS/2'].fsSelection & (1 << 6))
            self.assertEqual(derived['head'].macStyle & 3, 0)
            self.assertEqual(derived['post'].italicAngle, 0)
            self.assertEqual(list(derived['glyf'][derived.getBestCmap()[ord('A')]].coordinates), original_coordinates)

    def test_archive_is_never_extracted_and_member_hash_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / 'source.zip'; data = fixture_font()
            with zipfile.ZipFile(archive, 'w') as target:
                target.writestr('font/Regular.ttf', data)
                target.writestr('../escape.txt', 'untrusted')
            source = {'archiveMember': 'font/Regular.ttf', 'fontSha256': build.sha(data), 'fontBytes': len(data)}
            self.assertEqual(build.source_font(source, archive), data)
            source['fontSha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'archive_font_hash_mismatch'):
                build.source_font(source, archive)
            source['archiveMember'] = '../escape.txt'
            with self.assertRaisesRegex(ValueError, 'unsafe_archive_member'):
                build.source_font(source, archive)
            self.assertFalse((Path(directory).parent / 'escape.txt').exists())

    def test_sources_and_published_paths_cannot_target_arbitrary_hosts(self):
        for value in ['http://github.com/a', 'https://evil.example/a', 'https://user:pass@github.com/a']:
            with self.assertRaises(ValueError): build.validate_url(value)
        with self.assertRaisesRegex(ValueError, 'unversioned'):
            build.validate_url('https://raw.githubusercontent.com/a/b/main/a.ttf', 'main')
        for value in ['../source.ttf', 'https://cdn.example/a.ttf', 'fonts/v1/not-a-hash.ttf']:
            with self.assertRaises(ValueError): build.validate_asset_path({'path': value, 'sha256': 'a' * 64})

    def test_partial_coverage_is_explicit_and_missing_text_does_not_need_fake_glyphs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); cache = root / 'cache'; output = root / 'output'
            cache.mkdir(); output.mkdir(); payload = fixture_font({ord('温'), ord('油')})
            license_bytes = b'SIL OPEN FONT LICENSE Version 1.1 - test fixture only'
            (cache / build.sha(payload)).write_bytes(payload)
            (cache / build.sha(license_bytes)).write_bytes(license_bytes)
            source = {'id': 'fixture', 'url': 'https://github.com/fixture/font/releases/download/v1/font.ttf',
                      'sourceRevision': 'v1', 'sha256': build.sha(payload), 'bytes': len(payload),
                      'licenseSha256': build.sha(license_bytes)}
            family = build.build_family(source, {'name': '测试字体', 'designLanguage': 'zh'}, cache, output, None, False)
            self.assertEqual(family['coverage']['ascii']['present'], 0)
            self.assertEqual(family['coverage']['ascii']['missingRanges'], ['U+0020-007E'])
            build.verify_bundle({'fonts': [family]}, output)
            shard = family['shards'][0]
            (output / shard['web']['path']).write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'source_size_mismatch'):
                build.verify_bundle({'fonts': [family]}, output)

    def test_pending_fonts_have_no_publishable_assets(self):
        with self.assertRaisesRegex(ValueError, 'pending_font_has_assets'):
            build.verify_bundle({'fonts': [{'availability': 'pendingSource', 'shards': [{}]}]}, Path('/tmp'))

    def test_embedding_restriction_fails_before_publishing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); payload = fixture_font(embedding=2)
            license_bytes = b'SIL OPEN FONT LICENSE Version 1.1 - test fixture only'
            (root / build.sha(payload)).write_bytes(payload); (root / build.sha(license_bytes)).write_bytes(license_bytes)
            source = {'id': 'fixture', 'url': 'https://github.com/fixture/font/releases/download/v1/font.ttf',
                      'sourceRevision': 'v1', 'sha256': build.sha(payload), 'bytes': len(payload),
                      'licenseSha256': build.sha(license_bytes)}
            with self.assertRaisesRegex(ValueError, 'embedding_flags_require_review'):
                build.build_family(source, {'name': '测试字体', 'designLanguage': 'zh'}, root, root, None, False)

    def test_editable_and_print_embedding_flags_require_locked_ofl_to_normalize(self):
        for flags in (4, 8):
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory); payload = fixture_font(embedding=flags)
                license_bytes = b'SIL OPEN FONT LICENSE Version 1.1 - test fixture only'
                (root / build.sha(payload)).write_bytes(payload); (root / build.sha(license_bytes)).write_bytes(license_bytes)
                source = {'id': 'fixture', 'url': 'https://github.com/fixture/font/releases/download/v1/font.ttf',
                          'sourceRevision': 'v1', 'sha256': build.sha(payload), 'bytes': len(payload),
                          'licenseSha256': build.sha(license_bytes)}
                with self.assertRaisesRegex(ValueError, 'normalization_requires_ofl'):
                    build.build_family(source, {'name': '测试字体', 'designLanguage': 'zh'}, root, root, None, False)
                source['license'] = 'OFL-1.1'
                family = build.build_family(source, {'name': '测试字体', 'designLanguage': 'zh'}, root, root, None, False)
                build.verify_bundle({'fonts': [family]}, root)
                for shard in family['shards']:
                    font = TTFont(root / shard['mobile']['path'])
                    self.assertEqual(font['OS/2'].fsType, 0)


if __name__ == '__main__':
    unittest.main()
