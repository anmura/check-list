"""Adjusts the generated Android project: version, permissions.

Usage: python3 scripts/patch-android.py <tag-or-branch> <build-number>
"""
import re
import sys
from pathlib import Path

ref = sys.argv[1] if len(sys.argv) > 1 else "v1.0.0"
build = int(sys.argv[2]) if len(sys.argv) > 2 else 1
version = ref[1:] if re.match(r"^v\d", ref) else f"0.0.{build}"

gradle = Path("android/app/build.gradle")
text = gradle.read_text(encoding="utf-8")
text, n1 = re.subn(r"versionCode\s+\d+", f"versionCode {build}", text)
text, n2 = re.subn(r'versionName\s+"[^"]*"', f'versionName "{version}"', text)
if not (n1 and n2):
    sys.exit("Could not set version in android/app/build.gradle")
gradle.write_text(text, encoding="utf-8")

manifest = Path("android/app/src/main/AndroidManifest.xml")
xml = manifest.read_text(encoding="utf-8")
wanted = [
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.SCHEDULE_EXACT_ALARM",
    "android.permission.RECEIVE_BOOT_COMPLETED",
]
lines = "".join(
    f'    <uses-permission android:name="{p}" />\n' for p in wanted if p not in xml
)
if lines:
    xml = xml.replace("</manifest>", lines + "</manifest>")
manifest.write_text(xml, encoding="utf-8")

print(f"Android project patched: version {version} ({build})")
