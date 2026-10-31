"""Check the release APK's Room constructor, then cold-launch it on an adb device."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import time
import unittest
import xml.etree.ElementTree as ET


def run(*args):
    return subprocess.check_output(args, timeout=90)


def assert_constructor(code):
    assert b".method public constructor <init>()V" in code, "R8 removed WorkDatabase_Impl's public no-arg constructor"


def assert_rendered(xml, package):
    nodes = [node for node in ET.fromstring(xml).iter("node") if node.get("package") == package]
    assert any(node.get("text") for node in nodes), "App has not rendered text beyond the native splash"
    assert any(node.get("clickable") == "true" and node.get("enabled") == "true" for node in nodes), "App has no enabled control"


def validate(apk, output, check_only):
    sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT", "")
    analyzer = shutil.which("apkanalyzer") or str(Path(sdk) / "cmdline-tools/latest/bin/apkanalyzer")
    assert run(analyzer, "manifest", "debuggable", str(apk)).strip() == b"false", "Use a production release APK"
    assert_constructor(run(analyzer, "dex", "code", "--class", "androidx.work.impl.WorkDatabase_Impl",
                           "--method", "<init>()V", str(apk)))
    if check_only:
        print("Release APK retains the WorkManager database constructor")
        return
    package = run(analyzer, "manifest", "application-id", str(apk)).decode().strip()
    output.mkdir(parents=True, exist_ok=True)
    # Replace the APK in place; never clear data or uninstall an existing app.
    run("adb", "install", "-r", str(apk))
    run("adb", "shell", "am", "force-stop", package)
    run("adb", "logcat", "-c")
    try:
        launch = run("adb", "shell", "am", "start", "-W", "-n", f"{package}/.MainActivity")
        (output / "launch.txt").write_bytes(launch)
        assert b"Status: ok" in launch, launch.decode()
        time.sleep(15)
        pid = run("adb", "shell", "pidof", package).strip()
        assert pid, "App process died during cold launch"
        window = run("adb", "shell", "dumpsys", "window")
        assert any(package.encode() in line and b"mCurrentFocus" in line for line in window.splitlines()), "App is not foreground"
        run("adb", "shell", "uiautomator", "dump", "/sdcard/opencode-launch.xml")
        xml = run("adb", "exec-out", "cat", "/sdcard/opencode-launch.xml")
        (output / "screen.xml").write_bytes(xml)
        (output / "screen.png").write_bytes(run("adb", "exec-out", "screencap", "-p"))
        assert_rendered(xml, package)
        assert run("adb", "shell", "pidof", package).strip() == pid, "App restarted during launch validation"
        print(f"PASS: {package} cold-launched, stayed foreground and rendered controls; evidence: {output}")
    finally:
        (output / "logcat.txt").write_bytes(run("adb", "logcat", "-d", "-v", "threadtime"))


class LaunchChecks(unittest.TestCase):
    def test_constructor(self):
        assert_constructor(b".method public constructor <init>()V\n.end method")
        for code in (b"", b".method private constructor <init>()V", b".method public constructor <init>(I)V"):
            with self.assertRaises(AssertionError):
                assert_constructor(code)

    def test_rendered_app_not_splash_or_system_dialog(self):
        xml = '<hierarchy><node package="app.getopencode" text="Continue" clickable="true" enabled="true"/></hierarchy>'
        assert_rendered(xml, "app.getopencode")
        for invalid in ('<hierarchy/>', xml.replace('app.getopencode', 'android'), xml.replace('text="Continue"', 'text=""')):
            with self.assertRaises(AssertionError):
                assert_rendered(invalid, "app.getopencode")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--check-apk-only", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("output/android-launch"))
    args = parser.parse_args()
    if args.self_test:
        unittest.main(argv=[__file__])
    else:
        if not args.apk:
            parser.error("--apk is required")
        validate(args.apk, args.output, args.check_apk_only)
