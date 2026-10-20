#!/usr/bin/env python3
"""从审核后的锁源离线生成字体包；本工具没有上传、业务写入或部署入口。"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
from pathlib import Path, PurePosixPath
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

import brotli
import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
TOOLCHAIN = {"python": "3.12", "fonttools": "4.46.0", "brotli": "1.1.0"}
EPOCH = 2082844800  # 1970-01-01，OpenType head 使用1904纪元。
MIB = 1024 * 1024
LIMITS = {
    "maxConcurrentDownloads": 2,
    "maxSessionFamilies": 8,
    "maxSessionRequests": 64,
    "maxWebSessionBytes": 16 * MIB,
    "maxMobileSessionBytes": 24 * MIB,
    "maxMobileRegisteredFaces": 32,
    "maxPersistentCacheBytes": 64 * MIB,
    "downloadTimeoutMs": 15000,
    "maxAssetBytes": 6 * MIB,
    "maxSourceBytes": 64 * MIB,
    "maxBuildSourceBytes": 512 * MIB,
    "maxBundleBytes": 512 * MIB,
    "maxReleaseStorageBytes": 1024 * MIB,
    "monthlyEgressBudgetBytes": 500 * 1024 * MIB,
}
CORE_VERSION = "gb2312-level1-ascii-punctuation-v1"
EXTRA_PAGE_SIZE = 2048
PUNCTUATION = "，。！？；：、（）【】《》“”‘’—…·"
ASCII = set(range(0x20, 0x7F))
SHA = re.compile(r"^[0-9a-f]{64}$")
FONT_ID = re.compile(r"^[a-z][a-z0-9-]{0,47}$")
logging.getLogger("fontTools.subset").setLevel(logging.ERROR)


def canonical(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def gb2312(level1: bool = False) -> set[int]:
    points: set[int] = set()
    for lead in range(0xB0, 0xD8 if level1 else 0xF8):
        for trail in range(0xA1, 0xFF):
            try:
                points.add(ord(bytes([lead, trail]).decode("gb2312")))
            except UnicodeDecodeError:
                pass
    return points


def ranges(points: set[int]) -> list[str]:
    values = sorted(points)
    result: list[str] = []
    index = 0
    while index < len(values):
        first = last = values[index]
        index += 1
        while index < len(values) and values[index] == last + 1:
            last = values[index]
            index += 1
        result.append(f"U+{first:04X}" if first == last else f"U+{first:04X}-{last:04X}")
    return result


def expand_ranges(values: list[str]) -> set[int]:
    result: set[int] = set()
    for value in values:
        if not re.fullmatch(r"U\+[0-9A-F]{4,6}(?:-[0-9A-F]{4,6})?", value):
            raise ValueError("invalid_unicode_range")
        limits = [int(item, 16) for item in value[2:].split("-")]
        first, last = limits[0], limits[-1]
        if last < first or last > 0x10FFFF or last - first > 0x10000:
            raise ValueError("invalid_unicode_range_size")
        result.update(range(first, last + 1))
    return result


def partition(points: set[int]) -> list[tuple[str, set[int]]]:
    core = ASCII | set(map(ord, PUNCTUATION)) | gb2312(True)
    result = [("core", points & core)]
    extras: dict[int, set[int]] = {}
    for point in points - core:
        extras.setdefault(point // EXTRA_PAGE_SIZE, set()).add(point)
    result.extend((f"u{page * EXTRA_PAGE_SIZE:06x}", extra) for page, extra in sorted(extras.items()))
    return [(name, chars) for name, chars in result if chars]


def checked_bytes(path: Path, expected_sha: str, expected_bytes: int | None = None) -> bytes:
    if not SHA.fullmatch(expected_sha) or path.is_symlink() or not path.is_file():
        raise ValueError("source_missing_or_unsafe")
    size = path.stat().st_size
    if size > LIMITS["maxSourceBytes"] or (expected_bytes is not None and size != expected_bytes):
        raise ValueError("source_size_mismatch")
    data = path.read_bytes()
    if sha(data) != expected_sha:
        raise ValueError("source_hash_mismatch")
    return data


def validate_url(value: str, revision: str | None = None) -> None:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("unsafe_source_url")
    if parsed.hostname not in {"raw.githubusercontent.com", "github.com", "booth.pm", "lavsic.booth.pm"}:
        raise ValueError("source_host_not_allowed")
    if parsed.hostname in {"raw.githubusercontent.com", "github.com"} and revision:
        if revision in {"main", "master", "HEAD", "latest"} or revision not in parsed.path.split("/"):
            raise ValueError("unversioned_source_url")


def acquire(url: str | None, digest: str, size: int | None, cache: Path,
            source_dir: Path | None, filename: str | None, online: bool) -> Path:
    if not SHA.fullmatch(digest):
        raise ValueError("source_hash_required")
    destination = cache / digest
    if destination.exists():
        checked_bytes(destination, digest, size)
        return destination
    if source_dir:
        for candidate in (source_dir / digest, source_dir / (filename or digest)):
            if candidate.exists():
                payload = checked_bytes(candidate, digest, size)
                destination.write_bytes(payload)
                return destination
    if not online or not url:
        raise ValueError(f"offline_source_missing:{filename or digest}")
    validate_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": "WenyouFontBuild/1"})
    # urllib follows HTTPS redirects for GitHub release assets; only the locked body is accepted.
    with urllib.request.urlopen(request, timeout=30) as response:
        if urllib.parse.urlsplit(response.url).scheme != "https":
            raise ValueError("insecure_source_redirect")
        payload = response.read(LIMITS["maxSourceBytes"] + 1)
    if len(payload) > LIMITS["maxSourceBytes"] or (size is not None and len(payload) != size):
        raise ValueError("download_size_mismatch")
    if sha(payload) != digest:
        raise ValueError("download_hash_mismatch")
    temporary = destination.with_suffix(".partial")
    temporary.write_bytes(payload)
    temporary.replace(destination)
    return destination


def source_font(source: dict, container: Path) -> bytes:
    payload = container.read_bytes()
    member = source.get("archiveMember")
    if member:
        parts = PurePosixPath(member).parts
        if member.startswith("/") or ".." in parts or "__MACOSX" in parts:
            raise ValueError("unsafe_archive_member")
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            info = archive.getinfo(member)
            if info.file_size > LIMITS["maxSourceBytes"] or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("unsafe_archive_font")
            payload = archive.read(info)
        if len(payload) != source["fontBytes"] or sha(payload) != source["fontSha256"]:
            raise ValueError("archive_font_hash_mismatch")
    elif zipfile.is_zipfile(io.BytesIO(payload)):
        raise ValueError("archive_member_must_be_locked")
    return payload


def name_text(font: TTFont, ident: int) -> list[str]:
    return sorted({item.toUnicode() for item in font["name"].names if item.nameID == ident})


def repair_layout_header(font: TTFont) -> list[str]:
    if "GDEF" not in font or font["GDEF"].table.Version != 0:
        return []
    table = font["GDEF"].table
    # 侵食明朝的已锁原件使用v1结构却把版本写为0；保留8个mark class。
    if set(table.__dict__) - {"Version", "GlyphClassDef", "AttachList", "LigCaretList", "MarkAttachClassDef"}:
        raise ValueError("unsupported_gdef_zero_version_structure")
    table.Version = 0x00010000
    return ["GDEF.Version: 0 -> 1.0; all layout classes retained"]


def rename(font: TTFont, family: str) -> None:
    names = font["name"]
    replaced = {1, 2, 3, 4, 6, 16, 17, 18, 20, 21, 22, 25}
    names.names = [item for item in names.names if item.nameID not in replaced]
    for ident, value in {1: family, 2: "Regular", 3: family + ";1.0", 4: family,
                         6: family, 16: family, 17: "Regular", 18: family,
                         21: family, 22: "Regular", 25: family}.items():
        names.setName(value, ident, 3, 1, 0x409)
        names.setName(value, ident, 1, 0, 0)
    # 每个风格只分发一个基础face。原轮廓不变，独立粗斜体交给消费者合成。
    if "OS/2" in font:
        font["OS/2"].usWeightClass = 400
        font["OS/2"].fsType = 0
        font["OS/2"].fsSelection = (font["OS/2"].fsSelection & ~((1 << 0) | (1 << 5) | (1 << 9))) | (1 << 6)
    font["head"].macStyle &= ~3
    if "post" in font:
        font["post"].italicAngle = 0
    if "CFF " in font:
        cff = font["CFF "].cff
        cff.fontNames = [family]
        for top in cff.topDictIndex:
            top.FamilyName = family
            top.FullName = family
            for fd in getattr(top, "FDArray", []):
                if hasattr(fd, "FontName"):
                    fd.FontName = family


def subset_font(payload: bytes, chars: set[int], family: str) -> tuple[bytes, bytes, str]:
    font = TTFont(io.BytesIO(payload), recalcTimestamp=False)
    repair_layout_header(font)
    if "fvar" in font:
        raise ValueError("variable_source_requires_locked_instance")
    options = subset.Options()
    options.hinting = False
    options.recalc_timestamp = False
    options.canonical_order = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.layout_features = ["*"]
    options.notdef_glyph = True
    options.notdef_outline = True
    options.recommended_glyphs = True
    worker = subset.Subsetter(options=options)
    worker.populate(unicodes=sorted(chars))
    worker.subset(font)
    rename(font, family)
    font["head"].created = EPOCH
    font["head"].modified = EPOCH
    if set(font.getBestCmap() or {}) != chars:
        raise ValueError("subset_cmap_mismatch")
    font.flavor = None
    sfnt = io.BytesIO()
    font.save(sfnt, reorderTables=True)
    extension = "otf" if font.sfntVersion == "OTTO" else "ttf"
    # 固定同一SFNT输入，确保两个平台的字形及coverage一致。
    compressed_font = TTFont(io.BytesIO(sfnt.getvalue()), recalcTimestamp=False)
    compressed_font.flavor = "woff2"
    compressed = io.BytesIO()
    compressed_font.save(compressed, reorderTables=True)
    return sfnt.getvalue(), compressed.getvalue(), extension


def asset(output: Path, payload: bytes, extension: str, **fields) -> dict:
    if len(payload) > LIMITS["maxAssetBytes"] and extension in {"ttf", "otf", "woff2"}:
        raise ValueError("asset_budget_exceeded")
    digest = sha(payload)
    path = f"fonts/v1/{digest}.{extension}"
    destination = output / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() and destination.read_bytes() != payload:
        raise ValueError("immutable_collision")
    destination.write_bytes(payload)
    return {"path": path, "sha256": digest, "bytes": len(payload), **fields}


def coverage(points: set[int], expected: set[int]) -> dict:
    missing = expected - points
    return {"present": len(expected & points), "total": len(expected), "missingRanges": ranges(missing)}


def build_family(source: dict, catalog: dict, cache: Path, output: Path,
                 source_dir: Path | None, online: bool) -> dict:
    validate_url(source["url"], source["sourceRevision"])
    container = acquire(source["url"], source["sha256"], source["bytes"], cache,
                        source_dir, source.get("filename"), online)
    if source.get("licenseMember"):
        with zipfile.ZipFile(container) as archive:
            license_info = archive.getinfo(source["licenseMember"])
            if license_info.file_size > MIB:
                raise ValueError("license_size_exceeded")
            license_bytes = archive.read(license_info)
        if sha(license_bytes) != source["licenseSha256"]:
            raise ValueError("archive_license_hash_mismatch")
    else:
        license_path = acquire(source.get("licenseUrl"), source["licenseSha256"], None, cache,
                               source_dir, source.get("licenseFilename"), online)
        license_bytes = license_path.read_bytes()
    if b"SIL OPEN FONT LICENSE Version 1.1" not in license_bytes:
        raise ValueError("ofl_text_missing")
    payload = source_font(source, container)
    original = TTFont(io.BytesIO(payload), recalcTimestamp=False)
    if "OS/2" not in original or original["OS/2"].fsType not in (0, 4, 8):
        raise ValueError("embedding_flags_require_review")
    if original["OS/2"].fsType and source.get("license") != "OFL-1.1":
        raise ValueError("embedding_flag_normalization_requires_ofl")
    points = set(original.getBestCmap() or {})
    if not points:
        raise ValueError("empty_source_cmap")
    actual_coverage = {"ascii": len(points & ASCII), "gb2312": len(points & gb2312())}
    if source.get("expectedCoverage") and source["expectedCoverage"] != actual_coverage:
        raise ValueError("source_coverage_lock_mismatch")
    attribution = {
        "id": source["id"], "upstreamName": source.get("name", catalog["name"]), "sourceRevision": source["sourceRevision"],
        "sourceUrl": source["url"], "sourceSha256": source["sha256"], "fontSha256": sha(payload),
        "officialPage": source.get("officialPage"), "licenseEvidence": source.get("licenseEvidence"),
        "copyright": name_text(original, 0), "trademark": name_text(original, 7),
        "manufacturer": name_text(original, 8), "designer": name_text(original, 9),
        "licenseDescription": name_text(original, 13), "licenseUrl": name_text(original, 14),
        "sourceWeight": original["OS/2"].usWeightClass,
        "sourceFsType": original["OS/2"].fsType,
        "sourceStyle": {"fsSelection": original["OS/2"].fsSelection, "macStyle": original["head"].macStyle,
                        "italicAngle": original["post"].italicAngle if "post" in original else 0},
        "modifications": "Subset, remove hints, rename all family/PostScript identifiers, normalize base face metadata to regular 400/normal and embedding flags to installable under the locked OFL license while retaining original outlines, WOFF2 conversion; OFL-1.1 retained.",
        "derivedFamilyPrefix": "WYF1-" + sha(payload)[:16],
    }
    if not attribution["copyright"]:
        raise ValueError("copyright_notice_missing")
    repairs = repair_layout_header(original)
    if repairs:
        attribution["tableRepairs"] = repairs
    notices = [asset(output, license_bytes, "txt", kind="license"),
               asset(output, canonical(attribution), "json", kind="attribution")]
    if source.get("readmeSha256"):
        readme = acquire(source["readmeUrl"], source["readmeSha256"], None, cache, source_dir, None, online)
        notices.append(asset(output, readme.read_bytes(), "txt", kind="source-notice"))
    source_identity = sha(payload)[:16]
    shards = []
    for shard_id, chars in partition(points):
        family = f"WYF1-{source_identity}-{shard_id}"
        sfnt, woff2, extension = subset_font(payload, chars, family)
        shards.append({
            "id": shard_id, "family": family, "codepointCount": len(chars), "unicodeRanges": ranges(chars),
            "web": asset(output, woff2, "woff2", format="woff2", contentType="font/woff2"),
            "mobile": asset(output, sfnt, extension, format=extension, contentType=f"font/{extension}"),
        })
    return {
        "id": source["id"], "name": catalog["name"], "availability": "ready",
        "baseWeight": 400, "baseStyle": "normal",
        "license": "OFL-1.1", "sourceRevision": source["sourceRevision"],
        "sourceSha256": source["sha256"], "fontSha256": sha(payload), "sourceBytes": source["bytes"],
        "coverage": {"totalCodepoints": len(points), "ascii": coverage(points, ASCII),
                     "gb2312": coverage(points, gb2312()), "punctuation": coverage(points, set(map(ord, PUNCTUATION)))},
        "notices": notices, "shards": shards,
        "totalWebBytes": sum(shard["web"]["bytes"] for shard in shards),
        "totalMobileBytes": sum(shard["mobile"]["bytes"] for shard in shards),
    }


def index_bytes(manifest: dict, descriptor: dict) -> bytes:
    index = {
        "catalogVersion": manifest["catalogVersion"], "manifest": descriptor,
        "fonts": [{key: item[key] for key in ("id", "name", "availability")} for item in manifest["fonts"]],
        "limits": manifest["limits"],
    }
    return ("// 此文件由 scripts/fonts/build.py 生成；不要手改哈希或资源状态。\n"
            + "export const TEXT_FONT_ASSET_INDEX = " + canonical(index).decode().rstrip()
            + " as const;\n").encode()


def verify_bundle(manifest: dict, output: Path) -> None:
    total = 0
    for font in manifest["fonts"]:
        if font["availability"] != "ready":
            if font.get("shards"):
                raise ValueError("pending_font_has_assets")
            continue
        union: set[int] = set()
        for shard in font["shards"]:
            points = expand_ranges(shard["unicodeRanges"])
            if len(points) != shard["codepointCount"] or union & points:
                raise ValueError("overlapping_or_mismatched_coverage")
            union.update(points)
            for platform in ("web", "mobile"):
                descriptor = shard[platform]
                validate_asset_path(descriptor)
                data = checked_bytes(output / descriptor["path"], descriptor["sha256"], descriptor["bytes"])
                total += len(data)
                font_file = TTFont(io.BytesIO(data), recalcTimestamp=False)
                if set(font_file.getBestCmap() or {}) != points:
                    raise ValueError("published_cmap_mismatch")
                if name_text(font_file, 1) != [shard["family"]] or name_text(font_file, 6) != [shard["family"]]:
                    raise ValueError("derived_name_mismatch")
                if font_file["OS/2"].usWeightClass != 400 or font_file["OS/2"].fsSelection & ((1 << 0) | (1 << 5) | (1 << 9)):
                    raise ValueError("derived_base_style_mismatch")
                if font_file["OS/2"].fsType != 0 or not font_file["OS/2"].fsSelection & (1 << 6) or font_file["head"].macStyle & 3:
                    raise ValueError("derived_embedding_or_style_mismatch")
                if "GDEF" in font_file and font_file["GDEF"].table.Version not in (0x00010000, 0x00010002, 0x00010003):
                    raise ValueError("invalid_derived_gdef_version")
        if len(union) != font["coverage"]["totalCodepoints"]:
            raise ValueError("source_coverage_lost")
        for notice in font["notices"]:
            validate_asset_path(notice)
            total += len(checked_bytes(output / notice["path"], notice["sha256"], notice["bytes"]))
    if total > LIMITS["maxBundleBytes"]:
        raise ValueError("bundle_budget_exceeded")


def validate_asset_path(value: dict) -> None:
    if not SHA.fullmatch(value["sha256"]) or not re.fullmatch(
        r"fonts/v1/" + value["sha256"] + r"\.(?:ttf|otf|woff2|txt|json)", value["path"]
    ):
        raise ValueError("unsafe_asset_path")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--download", action="store_true", help="仅此参数允许读取锁源HTTPS；默认全离线")
    parser.add_argument("--verify", action="store_true", help="只校验现有manifest和资产，不下载或改写")
    args = parser.parse_args()
    actual = {"python": ".".join(map(str, sys.version_info[:2])), "fonttools": fontTools.__version__, "brotli": brotli.__version__}
    if actual != TOOLCHAIN:
        raise ValueError("toolchain_version_mismatch")
    contracts = args.root / "contracts"
    manifest_path = contracts / "thread-font-manifest-v1.json"
    if args.verify:
        manifest = json.loads(manifest_path.read_text())
        verify_bundle(manifest, args.output)
        descriptor = {"path": f"fonts/v1/{sha(manifest_path.read_bytes())}.json", "sha256": sha(manifest_path.read_bytes()), "bytes": manifest_path.stat().st_size}
        checked_bytes(args.output / descriptor["path"], descriptor["sha256"], descriptor["bytes"])
        if (args.root / "src/common/text-font-assets.generated.ts").read_bytes() != index_bytes(manifest, descriptor):
            raise ValueError("generated_index_drift")
        print(json.dumps({"verified": True, "manifest": descriptor}))
        return
    catalog = json.loads((contracts / "thread-font-catalog-v1.json").read_text())
    sources = json.loads((contracts / "thread-font-sources-v1.json").read_text())
    source_map = {item["id"]: item for item in sources["fonts"]}
    if len(source_map) != len(sources["fonts"]) or set(source_map) != {item["id"] for item in catalog["fonts"]}:
        raise ValueError("catalog_source_ids_mismatch")
    if any(not FONT_ID.fullmatch(item) for item in source_map):
        raise ValueError("invalid_font_id")
    if sum(item.get("bytes") or 0 for item in source_map.values()) > LIMITS["maxBuildSourceBytes"]:
        raise ValueError("source_budget_exceeded")
    args.cache.mkdir(parents=True, exist_ok=True)
    args.output.mkdir(parents=True, exist_ok=True)
    # Resume checkpoints are derived outputs only; verify again before accepting them.
    checkpoints = args.output / "checkpoints"
    checkpoints.mkdir(exist_ok=True)
    manifest = {"schemaVersion": 1, "fontVersion": 1, "catalogVersion": catalog["catalogVersion"],
                "toolchain": TOOLCHAIN, "partition": {"core": CORE_VERSION, "extraUnicodePageSize": EXTRA_PAGE_SIZE},
                "cacheControl": "public, max-age=31536000, immutable", "limits": LIMITS, "fonts": []}
    recipe = sha(Path(__file__).read_bytes())
    for entry in catalog["fonts"]:
        source = source_map[entry["id"]]
        if source["status"] != "locked":
            manifest["fonts"].append({"id": entry["id"], "name": entry["name"], "availability": "pendingSource", "shards": []})
            continue
        checkpoint = checkpoints / (sha(canonical([recipe, source, entry])) + ".json")
        if checkpoint.exists():
            family = json.loads(checkpoint.read_text())
            verify_bundle({"fonts": [family]}, args.output)
        else:
            start = time.monotonic()
            family = build_family(source, entry, args.cache, args.output, args.source_dir, args.download)
            checkpoint.write_bytes(canonical(family))
            print(json.dumps({"built": entry["id"], "shards": len(family["shards"]), "webBytes": family["totalWebBytes"], "mobileBytes": family["totalMobileBytes"], "seconds": round(time.monotonic() - start, 1)}), flush=True)
        manifest["fonts"].append(family)
    verify_bundle(manifest, args.output)
    payload = canonical(manifest)
    descriptor = asset(args.output, payload, "json")
    # All validation precedes replacing committed contracts. A partial build has no publishable manifest.
    manifest_path.write_bytes(payload)
    (args.root / "src/common/text-font-assets.generated.ts").write_bytes(index_bytes(manifest, descriptor))
    release = {"manifest": descriptor, "publication": "review-only-not-published", "requiredHeaders": {
        "Cache-Control": manifest["cacheControl"], "ETag": '"<asset-sha256>"',
        "Access-Control-Allow-Origin": "<reviewed-client-origin>", "X-Content-Type-Options": "nosniff"},
        "assetBaseUrl": None, "requiresExplicitPublicationApproval": True,
        "readyFonts": sum(item["availability"] == "ready" for item in manifest["fonts"]),
        "pendingFonts": [item["id"] for item in manifest["fonts"] if item["availability"] != "ready"]}
    (args.output / "release-review.json").write_bytes(canonical(release))
    print(json.dumps(release, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"font-build failed: {type(error).__name__}: {error}", file=sys.stderr)
        raise SystemExit(1) from None
