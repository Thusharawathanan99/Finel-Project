"""Verify a locally built caretaker APK without installing it or uploading data.

These checks establish archive integrity, Android signing and bundled feature
content. They do not establish account sign-in or actual caregiver alert delivery.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_NATIVE_LIBRARIES = {
    "libexpo-modules-core.so", "librnscreens.so", "libreactnative.so",
    "libhermes.so", "libc++_shared.so",
}
ALERT_MARKERS = (
    "/sos-alerts",
    "/resolve",
    "Invalid alert feed",
    "Alert update timed out",
    "Resolution could not be confirmed. The alert remains visible; retry after contacting the resident.",
    "Some emergency or wellness updates could not be loaded. Retry the feed, or call your care team if help is urgent.",
    "No assigned resident is available. Contact your administrator or emergency services directly.",
    "SOS Recorded",
)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def contains(bundle, value):
    return value.encode("utf-8") in bundle or value.encode("utf-16-le") in bundle


def run(command):
    result = subprocess.run(command, capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=120)
    return result.returncode == 0, result.stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    apk = args.apk.resolve()
    report = {"artifact": str(apk), "scope": "Static APK checks only.", "checks": []}

    def check(name, passed, **facts):
        report["checks"].append({"name": name, "passed": bool(passed), **facts})

    try:
        check("apk_exists", apk.is_file())
        report["bytes"] = apk.stat().st_size
        report["sha256"] = sha256(apk.read_bytes())
        sdk_tools = ROOT / ".cache/android-runtime/sdk/build-tools/36.0.0"
        check("aapt_available", (sdk_tools / "aapt.exe").is_file())
        ok, badging = run([str(sdk_tools / "aapt.exe"), "dump", "badging", str(apk)])
        check("android_manifest_readable", ok)
        identity = re.search(r"^package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging, re.M)
        check("preview_identity", identity and identity.groups() == ("com.careconnect.caretaker.preview", "2", "1.0.1"))
        if identity:
            report.update(package=identity[1], versionCode=identity[2], versionName=identity[3])
        label = re.search(r"^application-label:'([^']+)'", badging, re.M)
        check("latest_app_label", label and label[1] == "CareConnect Caretaker Latest")
        activity = re.search(r"^launchable-activity: name='([^']+)'", badging, re.M)
        check("launchable_activity", bool(activity), activity=activity[1] if activity else None)
        for key in ("sdkVersion", "targetSdkVersion"):
            value = re.search(r"^" + key + r":'(\d+)'", badging, re.M)
            report[key] = int(value[1]) if value else None
        java = next((ROOT / ".cache/android-runtime/jdk17").glob("*/bin/java.exe"))
        signature_ok, signature_text = run([str(java), "-jar", str(sdk_tools / "lib/apksigner.jar"), "verify", "--verbose", str(apk)])
        schemes = {match[1]: match[2] == "true" for match in re.finditer(r"Verified using (v[\d.]+) scheme[^:]*: (true|false)", signature_text)}
        check("android_signature_verified", signature_ok and any(value for key, value in schemes.items() if key in {"v2", "v3", "v3.1"}), schemes=schemes)
        with zipfile.ZipFile(apk) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            check("unique_unencrypted_archive_entries", len(names) == len(set(names)) and not any(entry.flag_bits & 1 for entry in entries), entries=len(names))
            check("all_archive_crc_checks", archive.testzip() is None)
            check("standalone_android_assets", {"AndroidManifest.xml", "resources.arsc", "classes.dex", "assets/index.android.bundle"}.issubset(names))
            libraries = [name for name in names if re.fullmatch(r"lib/[^/]+/[^/]+\.so", name)]
            report["abis"] = sorted({name.split("/")[1] for name in libraries})
            check("exact_supported_abis", set(report["abis"]) == {"arm64-v8a", "x86_64"})
            for abi, machine in (("arm64-v8a", 183), ("x86_64", 62)):
                files = [name for name in libraries if name.split("/")[1] == abi]
                missing_libraries = sorted(REQUIRED_NATIVE_LIBRARIES - {name.rsplit("/", 1)[1] for name in files})
                check("required_native_libraries_" + abi, not missing_libraries,
                      missingLibraries=missing_libraries)
                valid = bool(files)
                for name in files:
                    with archive.open(name) as library:
                        header = library.read(20)
                    valid &= len(header) == 20 and header[:6] == b"\x7fELF\x02\x01" and struct.unpack_from("<H", header, 18)[0] == machine
                check("native_elf_" + abi, valid, libraryCount=len(files))
            bundle = archive.read("assets/index.android.bundle")
        report["bundleSha256"] = sha256(bundle)
        check("hermes_bundle", len(bundle) >= 12 and struct.unpack_from("<Q", bundle)[0] == 0x1F1903C103BC1FC6)
        check("public_https_api_literal", contains(bundle, "https://api.careconnect.website/api"))
        source = (ROOT / "6-caretaker/src/screens/DashboardScreen.js").read_text(encoding="utf-8")
        for index, marker in enumerate(ALERT_MARKERS):
            check("current_caregiver_alert_marker_" + str(index + 1), marker in source and contains(bundle, marker))
        snapshot_root = ROOT / ".cache/caretaker-build"
        files = ("6-caretaker/src/screens/DashboardScreen.js", "6-caretaker/src/apiHelper.js",
                 "6-caretaker/src/screens/WellnessAlertScreen.js", "6-caretaker/src/navigation/AppNavigator.js")
        hashes = []
        for file in files:
            original = (ROOT / file).read_bytes()
            captured = (snapshot_root / file).read_bytes()
            hashes.append({"file": file, "sha256": sha256(captured)})
            check("snapshot_matches_source_" + Path(file).stem, original == captured)
        report["sourceFiles"] = hashes
    except (OSError, ValueError, KeyError, StopIteration, zipfile.BadZipFile, subprocess.SubprocessError) as error:
        check("verification_completed", False, errorType=type(error).__name__)
    report["allPassed"] = bool(report["checks"]) and all(item["passed"] for item in report["checks"])
    report["limitations"] = [
        "Bundled markers and source hashes do not prove navigation, authentication or alert delivery.",
        "The public API URL literal does not prove connectivity or the effective runtime URL.",
        "Signature verification confirms integrity, not publisher identity or production signing suitability.",
        "ABI checks do not prove physical-phone installation or native library loading.",
    ]
    serialized = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(serialized, encoding="utf-8")
        temporary.replace(args.output)
    print(serialized, end="")
    return 0 if report["allPassed"] else 1


if __name__ == "__main__":
    sys.exit(main())
