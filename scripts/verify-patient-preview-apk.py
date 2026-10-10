"""Offline APK evidence only; never installs, launches, uploads or prints bundle contents.

Run with an APK path and optional --output audit/patient-preview-apk-verification.json.
Uses the already-installed Android SDK and local model/reference files. An exit code
of zero means the static checks passed, not that camera, login or alerts work.
"""
import argparse
import ast
import base64
import hashlib
import ipaddress
import io
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
from urllib.parse import urlparse
import zipfile

ROOT = Path(__file__).resolve().parent.parent
MODEL_NAMES = ("tiny_face_detector", "face_expression", "face_landmark_68_tiny", "ssd_mobilenetv1", "face_landmark_68")
REQUIRED_NATIVE_LIBRARIES = {
    "libexpo-modules-core.so", "librnscreens.so", "libreactnative.so",
    "libhermes.so", "libc++_shared.so",
}
GUIDE_IMAGE_NAMES = ("facial-movement.png", "rest.png", "care-support.png")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def contains_string(data, text):
    # Hermes stores ASCII and UTF-16 strings. Do not dump/disassemble the bundle.
    return text.encode("utf-8") in data or text.encode("utf-16-le") in data


def image_fingerprint(data):
    """PNG resource crunching may change bytes while preserving decoded pixels."""
    from PIL import Image
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            if not 1 <= width <= 8192 or not 1 <= height <= 8192 or width * height > 16_000_000:
                return None
            pixels = image.convert("RGBA").tobytes()
            return {"width": width, "height": height, "rgbaSha256": digest(pixels)}
    except (OSError, ValueError):
        return None


def language_values(source, keys, nested_group=None):
    starts = list(re.finditer(r"^  (en|ta|si): \{", source, re.M))
    values = {}
    primary_languages = set()
    for index, match in enumerate(starts):
        language = match.group(1)
        # A file may also contain a supplemental translation object (for
        # measured-quality tips). Required primary labels belong to its first
        # language block; supplemental objects need not repeat those labels.
        if language in primary_languages:
            continue
        primary_languages.add(language)
        end = starts[index + 1].start() if index + 1 < len(starts) else len(source)
        section = source[match.end():end]
        if nested_group:
            nested = re.search(r"\b" + re.escape(nested_group) + r":\s*\{", section)
            if not nested:
                raise ValueError("reference_copy_group_missing")
            section = section[nested.end():]
        for key in keys:
            property_name = r"(?:\b" + re.escape(key) + r"|['\"]" + re.escape(key) + r"['\"])"
            value = re.search(property_name + r":\s*'([^'\\]*)'", section)
            if not value:
                raise ValueError("reference_copy_key_missing")
            values[(language, key)] = value.group(1)
    if set(language for language, _ in values) != {"en", "ta", "si"}:
        raise ValueError("reference_language_missing")
    return values


def runtime_reference(reference):
    source = (reference / "5-patient/src/generated/liveFaceRuntime.js").read_text(encoding="utf-8")
    prefix = "export const LIVE_FACE_HTML = "
    html_line = next(line for line in source.splitlines() if line.startswith(prefix))
    html = json.loads(html_line[len(prefix):-1])
    # Decode the generated worker string and embedded JSON without executing JS.
    worker_match = re.search(r'new Blob\(\[("(?:[^"\\]|\\.)*")\],\{type:', html)
    if not worker_match:
        raise ValueError("reference_worker_missing")
    worker = json.loads(worker_match.group(1))
    marker = "runtime.initialize({embeddedModels:"
    start = worker.index(marker) + len(marker)
    models, consumed = json.JSONDecoder().raw_decode(worker[start:])
    model_end = start + consumed
    assets = []
    model_root = reference / "1-ui-ux/public/models/face-api"
    for name in MODEL_NAMES:
        filename = name + "_model-weights_manifest.json"
        data = (model_root / filename).read_bytes()
        expected_manifest = json.loads(data)
        if models.get(filename, {}).get("json") != expected_manifest:
            raise ValueError("reference_model_manifest_mismatch")
        assets.append({"name": filename, "bytes": len(data), "sha256": digest(data), "kind": "manifest"})
        for group in expected_manifest:
            for shard in group["paths"]:
                if not re.fullmatch(r"[a-z0-9_-]+", shard):
                    raise ValueError("reference_model_path_invalid")
                data = (model_root / shard).read_bytes()
                embedded = base64.b64decode(models.get(shard, {}).get("base64", ""), validate=True)
                if embedded != data:
                    raise ValueError("reference_model_shard_mismatch")
                assets.append({"name": shard, "bytes": len(data), "sha256": digest(data), "kind": "weights"})
    if set(models) != {asset["name"] for asset in assets}:
        raise ValueError("reference_unexpected_model_assets")
    acceleration = []
    vendor_root = reference / "shared/vendor/face-runtime"
    vendor = json.loads((vendor_root / "manifest.json").read_text(encoding="utf-8"))
    marker = "wasmAssets:"
    start = worker.index(marker, model_end) + len(marker)
    wasm, _ = json.JSONDecoder().raw_decode(worker[start:])
    for item in vendor["files"]:
        data = (vendor_root / item["name"]).read_bytes()
        if digest(data) != item["sha256"] or len(data) != item["bytes"]:
            raise ValueError("acceleration_reference_integrity_mismatch")
        if item["name"].endswith(".wasm"):
            if base64.b64decode(wasm.get(item["name"], ""), validate=True) != data:
                raise ValueError("acceleration_binary_mismatch")
            acceleration.append(item)
        elif item["name"].endswith(".js"):
            if not worker.startswith(data.decode("utf-8") + "\n"):
                raise ValueError("acceleration_sdk_mismatch")
        elif item["name"].endswith("LICENSE") and data.decode("utf-8") not in html:
            raise ValueError("acceleration_license_missing")
    if set(wasm) != {item["name"] for item in acceleration}:
        raise ValueError("unexpected_acceleration_binary")
    return html, assets, acceleration


def tool(command):
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    # Raw diagnostics can disclose bundle/configuration contents; expose only success.
    return result.returncode == 0, result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--sdk", type=Path, default=ROOT / ".cache/android-runtime/sdk")
    parser.add_argument("--reference-root", type=Path, default=ROOT)
    parser.add_argument("--api-url", default="https://api.careconnect.website/api")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--expected-version", default="1.0.8")
    parser.add_argument("--expected-version-code", default="9")
    args = parser.parse_args()
    apk = args.apk.resolve()
    report = {"artifact": str(apk), "scope": "Static archive/signature checks; APK not installed or launched.", "checks": []}

    def check(name, passed, **facts):
        report["checks"].append({"name": name, "passed": bool(passed), **facts})

    try:
        check("apk_exists", apk.is_file())
        if not apk.is_file():
            raise ValueError("apk_missing")
        report["bytes"] = apk.stat().st_size
        report["sha256"] = digest(apk.read_bytes())
        url = urlparse(args.api_url)
        try:
            address = ipaddress.ip_address(url.hostname or "")
            public_host = address.is_global
        except ValueError:
            public_host = bool(url.hostname) and url.hostname not in {"localhost", "localhost.localdomain"} and "." in url.hostname and not url.hostname.endswith(".local")
        check("expected_api_is_public_https", url.scheme == "https" and public_host and not url.username and not url.password and not url.query and not url.fragment,
              apiUrl=args.api_url if url.scheme == "https" and not url.username and not url.password else "invalid")

        build_tools = args.sdk / "build-tools/36.0.0"
        aapt = build_tools / ("aapt.exe" if os.name == "nt" else "aapt")
        check("aapt_available", aapt.is_file())
        if not aapt.is_file():
            raise ValueError("aapt_missing")
        ok, badging = tool([str(aapt), "dump", "badging", str(apk)])
        check("android_manifest_readable", ok)
        if not ok:
            raise ValueError("aapt_failed")
        package = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
        if not package:
            raise ValueError("package_identity_missing")
        report["package"] = package.group(1)
        report["versionCode"] = package.group(2)
        report["versionName"] = package.group(3)
        check("preview_identity", package.groups() == ("com.careconnect.patient.preview", args.expected_version_code, args.expected_version))
        for source_key, target_key in [("sdkVersion", "minSdk"), ("targetSdkVersion", "targetSdk")]:
            found = re.search(r"^" + source_key + r":'(\d+)'", badging, re.M)
            report[target_key] = int(found.group(1)) if found else None
        activity = re.search(r"^launchable-activity: name='([^']+)'", badging, re.M)
        check("launchable_activity", bool(activity), activity=activity.group(1) if activity else None)

        signer_jar = build_tools / "lib/apksigner.jar"
        local_java = sorted((ROOT / ".cache/android-runtime/jdk17").glob("*/bin/java.exe"))
        java = str(local_java[0]) if local_java else shutil.which("java")
        check("apksigner_available", bool(java) and signer_jar.is_file())
        if not java or not signer_jar.is_file():
            raise ValueError("apksigner_missing")
        signature_ok, signing_output = tool([java, "-jar", str(signer_jar), "verify", "--verbose", str(apk)])
        schemes = {match.group(1): match.group(2) == "true" for match in re.finditer(r"Verified using (v[\d.]+) scheme[^:]*: (true|false)", signing_output)}
        check("android_signature_verified", signature_ok and any(value for key, value in schemes.items() if key in {"v2", "v3", "v3.1"}), schemes=schemes)

        with zipfile.ZipFile(apk) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            check("unique_unencrypted_archive_entries", len(names) == len(set(names)) and not any(entry.flag_bits & 1 for entry in entries), entries=len(entries))
            bad_crc = archive.testzip()
            check("all_archive_crc_checks", bad_crc is None)
            check("android_assets_present", {"AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/index.android.bundle"}.issubset(names))
            native_files = [name for name in names if re.fullmatch(r"lib/[^/]+/[^/]+\.so", name)]
            abis = sorted({name.split("/")[1] for name in native_files})
            report["abis"] = abis
            check("exact_supported_abis", set(abis) == {"arm64-v8a", "x86_64"})
            for abi, machine in [("arm64-v8a", 183), ("x86_64", 62)]:
                files = [name for name in native_files if name.split("/")[1] == abi]
                missing_libraries = sorted(REQUIRED_NATIVE_LIBRARIES - {name.rsplit("/", 1)[1] for name in files})
                check("required_native_libraries_" + abi, not missing_libraries,
                      missingLibraries=missing_libraries)
                valid = bool(files)
                for name in files:
                    with archive.open(name) as member:
                        header = member.read(20)
                    valid &= len(header) == 20 and header[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", header, 18)[0] == machine
                check("native_elf_" + abi, valid, libraryCount=len(files))
            bundle = archive.read("assets/index.android.bundle")
            tone = (args.reference_root / "5-patient/assets/expression-check-in.wav").read_bytes()
            # Metro may name a resource by its content hash rather than its
            # source filename. Compare the actual audio bytes in either case.
            tone_files = [name for name in names if name.endswith(".wav")]
            check("exact_check_in_sound_bundled", bool(tone_files) and any(archive.read(name) == tone for name in tone_files),
                  sha256=digest(tone))
            check("native_audio_module_bundled", any(b"expo/modules/audio/AudioModule" in archive.read(name)
                  for name in names if re.fullmatch(r"classes\d*\.dex", name)))
            # Android may rename Metro image resources and losslessly re-encode
            # PNGs. Match actual bytes or canonical RGBA pixels, not filenames.
            image_members = {}
            for name in names:
                if name.lower().endswith((".png", ".webp", ".jpg", ".jpeg")):
                    data = archive.read(name)
                    image_members[name] = {"sha256": digest(data), "data": data}
            matched_images = []
            for filename in GUIDE_IMAGE_NAMES:
                expected = (args.reference_root / "5-patient/assets/face-guide" / filename).read_bytes()
                expected_hash, expected_pixels = digest(expected), image_fingerprint(expected)
                if not expected_pixels:
                    raise ValueError("guide_reference_image_invalid")
                exact = next((name for name, item in image_members.items() if item["sha256"] == expected_hash), None)
                matched = exact
                if not matched:
                    for name, item in image_members.items():
                        if "pixels" not in item:
                            item["pixels"] = image_fingerprint(item["data"])
                        if item["pixels"] == expected_pixels:
                            matched = name
                            break
                if matched:
                    matched_images.append(matched)
                check("original_guide_image_" + filename.removesuffix(".png").replace("-", "_") + "_bundled", bool(matched),
                      sourceSha256=expected_hash, sourceBytes=len(expected), pixels=expected_pixels,
                      archiveEntry=matched, matchMethod="exact-bytes" if exact else "decoded-rgba" if matched else None)
            check("three_distinct_original_guide_images_bundled", len(matched_images) == 3 and len(set(matched_images)) == 3)
        report["bundleBytes"] = len(bundle)
        report["bundleSha256"] = digest(bundle)
        is_hermes = len(bundle) >= 12 and struct.unpack_from("<Q", bundle)[0] == 0x1F1903C103BC1FC6
        check("hermes_bundle", is_hermes, bytecodeVersion=struct.unpack_from("<I", bundle, 8)[0] if is_hermes else None)
        check("expected_api_literal_bundled", contains_string(bundle, args.api_url), apiUrl=args.api_url if url.scheme == "https" and not url.username and not url.password else "invalid")

        html, assets, acceleration = runtime_reference(args.reference_root)
        runtime_ok = contains_string(bundle, html)
        check("exact_current_offline_runtime_bundled", runtime_ok, htmlBytes=len(html.encode("utf-8")), htmlSha256=digest(html.encode("utf-8")))
        # An exact generated HTML match proves the validated embedded assets
        # below are in the artifact; matching names alone would not prove integrity.
        check("offline_model_manifests_and_weights", runtime_ok and len(assets) == 11, assets=assets)
        check("exact_offline_wasm_binaries", runtime_ok and len(acceleration) == 2, assets=acceleration)
        check("offline_wasm_csp_and_network_isolation", runtime_ok and "'wasm-unsafe-eval'" in html and "connect-src 'none'" in html)
        for marker in ("careconnect-live-face", "face-api.js-local", "live-face-v1", "CareConnectFace.receive"):
            check("runtime_marker_" + marker, contains_string(bundle, marker))
        groups = [
            ("studio", "shared/liveFace.js", ("studio", "liveResults", "updateRate", "limitations", "probabilityHelp")),
            ("expression_explanations", "shared/liveFace.js", ("highestModelScore", "notConfirmed", "rawModelScores", "uncertaintyReason", "noUniqueLeadingScore")),
            ("reports", "shared/liveFace.js", ("report", "localPhoto", "cloudReport")),
            ("quality", "shared/liveFaceQuality.js", ("title", "evidenceNotice", "notHealth")),
            ("check_in_sound", "shared/expressionCheckIn.js", ("title", "notice", "prompted", "explanation", "test")),
            ("urgent_help", "shared/faceCare.js", ("title", "notDiagnosis", "privacy", "savedMessage", "resolvedMessage", "cancelPending")),
            ("photo_reports", "5-patient/src/faceUi.js", ("report", "share", "consent")),
            ("live_samples", "5-patient/src/liveMobileCopy.js", ("sampledAnalysis", "analyzedThumbnail", "analysisDelay", "recovering", "sampledNotice")),
            ("patient_emotion_check_in", "shared/emotionCheckInCatalog.js", ("description", "reportSource", "shareReport", "close")),
            ("facial_observations", "shared/facialObservations.js", ("title", "notice", "notHealth", "sampledNotice", "sparseNotice", "privacy", "baselineConsent", "baselineStart", "baselineReset", "report", "timeline", "clearSession", "downloadFailed")),
            ("facial_observation_states", "shared/facialObservations.js", ("unavailable", "observing", "no-significant-change", "repeated-change"), "states"),
            ("facial_geometry_labels", "shared/facialObservations.js", ("leftEyeOpeningRatio", "rightEyeOpeningRatio", "mouthOpeningRatio", "mouthCornerAsymmetryRatio", "eyeLineRollDegrees"), "metrics"),
            ("patient_symptoms", "shared/patientSymptoms.js", ("title", "source", "notDiagnosis", "urgentTitle", "guidance", "savedMessage", "privacy", "reportTitle", "reportSymptoms", "savedStatus")),
            ("education_guide", "shared/faceGuide.js", ("title", "notice", "movementText", "restText", "supportText", "asymmetryText")),
        ]
        for group_spec in groups:
            group, file, keys = group_spec[:3]
            nested_group = group_spec[3] if len(group_spec) > 3 else None
            values = language_values((args.reference_root / file).read_text(encoding="utf-8"), keys, nested_group=nested_group)
            for language in ("en", "ta", "si"):
                missing = [key for key in keys if not contains_string(bundle, values[(language, key)])]
                check(group + "_" + language, not missing, missingKeys=missing)
        catalog_source = (args.reference_root / "shared/emotionCheckInCatalog.js").read_text(encoding="utf-8")
        row_section = catalog_source.split("const rows = [", 1)[1].split("\n];", 1)[0]
        rows = [ast.literal_eval(line.strip().rstrip(",")) for line in row_section.splitlines() if line.strip()]
        if len(rows) != 101 or len({row[0] for row in rows}) != 101 or any(len(row) != 6 for row in rows):
            raise ValueError("reference_patient_catalog_invalid")
        for offset, language in enumerate(("en", "ta", "si"), 3):
            missing = [row[0] for row in rows if not contains_string(bundle, row[0]) or not contains_string(bundle, row[offset])]
            check("all_101_patient_reported_states_" + language, not missing, missingIds=missing, selectableStates=len(rows))
        symptom_source = (args.reference_root / "shared/patientSymptoms.js").read_text(encoding="utf-8")
        symptom_section = symptom_source.split("const rows = [", 1)[1].split("\n];", 1)[0]
        symptom_rows = [ast.literal_eval(line.strip().rstrip(",")) for line in symptom_section.splitlines() if line.strip()]
        if len(symptom_rows) != 14 or len({row[0] for row in symptom_rows}) != 14 or any(len(row) != 5 for row in symptom_rows):
            raise ValueError("reference_patient_symptoms_invalid")
        for offset, language in enumerate(("en", "ta", "si"), 2):
            missing = [row[0] for row in symptom_rows if not contains_string(bundle, row[0]) or not contains_string(bundle, row[offset])]
            check("all_14_reported_symptoms_" + language, not missing, missingIds=missing, selectableSymptoms=len(symptom_rows))
        quality_source = (args.reference_root / "shared/liveFaceQuality.js").read_text(encoding="utf-8")
        measured_marker = "const measuredCopy = "
        if quality_source.count(measured_marker) != 1:
            raise ValueError("reference_measured_copy_missing")
        measured_keys = ("dimPixels", "clippedPixels", "lowImageDetail", "eyeLineTilt")
        measured_values = language_values(quality_source.split(measured_marker, 1)[1], measured_keys, nested_group="tips")
        for language in ("en", "ta", "si"):
            missing = [key for key in measured_keys if not contains_string(bundle, measured_values[(language, key)])]
            check("measured_quality_notices_" + language, not missing, missingKeys=missing)
        old_markers = ("QUICK RADAR", "Quick Radar", "Quick radar", "QuickRadar", "QUICK_RADAR")
        check("separate_live_expression_panel_bundled", contains_string(bundle, "live-expression-results"))
        check("all_uncertainty_reason_codes_bundled", all(contains_string(bundle, marker) for marker in
              ("small-face", "low-face-confidence", "weak-expression-score", "close-leading-scores", "history-disagreement", "collecting-evidence")))
        for marker in ("facial-observation-panel", "patient-symptom-guidance", "face-monitoring-guide", "facial-observation-v1"):
            check("advanced_feature_marker_" + marker, contains_string(bundle, marker))
        check("old_quick_radar_markers_absent", not any(contains_string(bundle, marker) for marker in old_markers))
    except (ValueError, OSError, KeyError, StopIteration, ImportError, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        # Do not include arbitrary exception messages: they may contain input data.
        check("verification_completed", False, errorType=type(error).__name__)

    report["allPassed"] = bool(report["checks"]) and all(item["passed"] for item in report["checks"])
    report["limitations"] = [
        "String/runtime inclusion does not prove screen navigation, rendering or detector execution.",
        "API URL inclusion/configuration does not prove connectivity, server readiness or authentication.",
        "No camera, photo alignment, accuracy, GPU speed, dialer, language rendering or real alert delivery was tested.",
        "Signature verification proves APK integrity, not publisher identity or production signing suitability.",
        "ELF/SDK compatibility does not prove Android installation or native library loading.",
        "Original illustration pixel inclusion does not prove UI loading, patient observations, training data or model accuracy.",
        "Observation/symptom copy and markers do not prove clinical validity, consent interactions, symptom submission or notification acknowledgement.",
    ]
    serialized = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(serialized, encoding="utf-8")
        temporary.replace(args.output)
    print(serialized, end="")
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
