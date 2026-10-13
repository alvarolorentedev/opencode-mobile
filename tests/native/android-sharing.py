"""Exercise the installed release receiver with real Android intents and Files grants."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
import zlib


def run(*args):
    return subprocess.check_output(args, timeout=45)


def adb(*args):
    return run("adb", *args)


def hide_keyboard():
    if re.search(rb"\b(?:mInputShown|isInputShown)=true\b", adb("shell", "dumpsys", "input_method")):
        adb("shell", "input", "keyevent", "4")


def find(root, value):
    return next((node for node in root.iter("node") if value in
                 (node.get("text"), node.get("content-desc"))), None)


def center(node):
    left, top, right, bottom = map(int, re.findall(r"\d+", node.get("bounds", "")))
    assert right > left and bottom > top, "Element has no visible bounds"
    return str((left + right) // 2), str((top + bottom) // 2)


def assert_receiver(manifest, dex):
    root = ET.fromstring(manifest)
    key = "{http://schemas.android.com/apk/res/android}"
    activities = root.findall("./application/activity")
    assert any(data.get(key + "scheme") == "opencodemobile"
               for activity in activities for data in activity.findall("./intent-filter/data")), "APK has no app scheme"
    assert any(activity.get(key + "exported") == "true" and all(
        any(f.find("action").get(key + "name") == action and
            any(d.get(key + "mimeType") == "*/*" for d in f.findall("data"))
            for f in activity.findall("intent-filter") if f.find("action") is not None)
        for action in ("android.intent.action.SEND", "android.intent.action.SEND_MULTIPLE"))
        for activity in activities), "APK has no exported single/multiple share receiver"
    assert b"opencode-share-" in dex, "APK uses the unpatched precompiled sharing library"


class NativeShare:
    def __init__(self, package, output):
        self.package = package
        self.output = output

    def dump(self):
        adb("shell", "uiautomator", "dump", "/sdcard/share-validation.xml")
        xml = adb("exec-out", "cat", "/sdcard/share-validation.xml")
        (self.output / "latest.xml").write_bytes(xml)
        return ET.fromstring(xml)

    def wait(self, value, timeout=90):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            node = find(self.dump(), value)
            if node is not None and node.get("enabled") != "false":
                return node
            time.sleep(1)
        raise AssertionError(f"Did not see {value!r}; see latest.xml and logcat.txt")

    def tap(self, value, long=False):
        x, y = center(self.wait(value))
        adb("shell", "input", *(('swipe', x, y, x, y, '1000') if long else ('tap', x, y)))

    def snapshot(self, name):
        (self.output / f"{name}.xml").write_bytes(ET.tostring(self.dump()))
        (self.output / f"{name}.png").write_bytes(adb("exec-out", "screencap", "-p"))

    def composer(self, text=None):
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            for node in self.dump().iter("node"):
                if node.get("class") == "android.widget.EditText":
                    value = node.get("text", "")
                    if text is None or text in value:
                        return node
            time.sleep(1)
        raise AssertionError(f"Composer did not contain {text!r}")

    def text_share(self, text, cold=False):
        if cold:
            adb("shell", "am", "force-stop", self.package)
        adb("shell", "am", "start", "-W", "-a", "android.intent.action.SEND",
            "-c", "android.intent.category.DEFAULT", "-t", "text/plain",
            "--es", "android.intent.extra.TEXT", text, "-p", self.package)
        self.wait("Shared with OpenCode")
        self.wait(text)

    def add(self, text=None, occurrences=1):
        self.tap("Add to chat")
        node = self.composer(text)
        if text:
            assert node.get("text").count(text) == occurrences, "Shared text was lost or duplicated"

    def file_share(self, name):
        adb("shell", "am", "start", "-W", "-a", "android.intent.action.VIEW",
            "-d", "content://com.android.externalstorage.documents/root/primary",
            "-t", "vnd.android.document/root")
        root = self.dump()
        if find(root, name) is None:
            self.tap("Download" if find(root, "Download") is not None else "Downloads")
        self.tap(name, long=True)
        self.tap("Share")
        self.tap("OpenCode Mobile")
        self.wait("Shared with OpenCode")
        self.wait(f"Preview {name}")


def api(path, data=None):
    request = urllib.request.Request("http://127.0.0.1:4096" + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        return json.load(response)


def no_submission():
    assert not any(api("/__control/state")["messagesBySession"].values()), "Share auto-submitted a prompt"


def fixtures(directory):
    photo = directory / "share-photo.png"
    photo.write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGPQ6LlDEmIY1TCqYfhqAADy3ZAQaQsB1wAAAABJRU5ErkJggg=="))
    pdf = directory / "share-document.pdf"
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>",
               b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
               b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"]
    data = b"%PDF-1.4\n"
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += f"{i} 0 obj\n".encode() + obj + b"\nendobj\n"
    start = len(data)
    data += b"xref\n0 4\n0000000000 65535 f \n"
    data += b"".join(f"{offset:010d} 00000 n \n".encode() for offset in offsets[1:])
    data += f"trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n".encode()
    pdf.write_bytes(data)
    return photo, pdf


def validate(apk, output):
    output.mkdir(parents=True, exist_ok=True)
    analyzer = shutil.which("apkanalyzer") or str(next(
        Path(os.environ["ANDROID_HOME"]).glob("cmdline-tools/*/bin/apkanalyzer")))
    manifest = run(analyzer, "manifest", "print", str(apk))
    (output / "manifest.xml").write_bytes(manifest)
    with zipfile.ZipFile(apk) as archive:
        dex = b"".join(archive.read(name) for name in archive.namelist() if name.endswith(".dex"))
        resources = archive.read("resources.arsc")
        assert any("share_into_scheme".encode(encoding) in resources for encoding in ("utf-8", "utf-16le")), "APK lost the dynamically loaded share scheme resource"
    assert_receiver(manifest, dex)
    package = run(analyzer, "manifest", "application-id", str(apk)).decode().strip()
    adb("install", "-r", str(apk))
    adb("reverse", "tcp:4096", "tcp:4096")
    server_log = (output / "server.log").open("w")
    server = subprocess.Popen(["node", "tests/fake-opencode/server.mjs"], stdout=server_log, stderr=server_log,
                              env={**os.environ, "FAKE_OPENCODE_PORT": "4096"})
    flow = NativeShare(package, output)
    try:
        for _ in range(30):
            try:
                api("/__control/state")
                break
            except (OSError, ValueError):
                time.sleep(1)
        api("/api/session", {"title": "Share destination", "location": {"directory": "/workspace/demo-project"}})
        api("/api/session", {"title": "Other conversation", "location": {"directory": "/workspace/demo-project"}})
        adb("shell", "monkey", "-p", package, "1")
        flow.tap("Continue")
        flow.tap("Skip")
        flow.tap("Manual")
        # The release defaults to 127.0.0.1:4096; adb reverse reaches the fake server.
        flow.wait("Server address")
        hide_keyboard()
        flow.tap("Continue")
        flow.tap("Save & connect")
        flow.tap("Select demo-project")
        flow.tap("Start coding")
        flow.composer()
        flow.text_share("cold-share-token", cold=True)
        flow.tap("Change")
        flow.tap("Share destination · demo-project")
        flow.add("cold-share-token")
        flow.wait("Open chats. Share destination")
        no_submission()
        flow.snapshot("cold-existing-chat")
        flow.tap("New chat")
        node = flow.composer()
        adb("shell", "input", "tap", *center(node))
        adb("shell", "input", "text", "existing-draft")
        hide_keyboard()
        flow.composer("existing-draft")
        flow.snapshot("before-warm-share")
        for index in range(2):
            flow.text_share("repeat-share-token")
            flow.add("repeat-share-token", occurrences=index + 1)
            value = flow.composer("existing-draft").get("text")
            assert value.count("repeat-share-token") == index + 1
            no_submission()
        flow.snapshot("warm-draft-preserved")
        flow.text_share("new-chat-token")
        flow.tap("Change")
        flow.tap("New chat")
        before = len(api("/__control/state")["sessions"])
        flow.add("new-chat-token")
        assert len(api("/__control/state")["sessions"]) == before + 1
        no_submission()
        for file in fixtures(output):
            adb("push", str(file), f"/sdcard/Download/{file.name}")
            flow.file_share(file.name)
            flow.snapshot(file.stem + "-preview")
            flow.add()
            flow.wait(f"Remove {file.name}")
            no_submission()
            flow.snapshot(file.stem + "-composer")
        (output / "passed.txt").write_text("Release APK: patched receiver; cold/warm/repeat text; existing/new chats; draft retention; PNG/PDF Files grants; no auto-send.\n")
    finally:
        try:
            (output / "logcat.txt").write_bytes(adb("logcat", "-d", "-v", "threadtime"))
            flow.snapshot("final")
        finally:
            server.terminate()
            server.wait(timeout=10)
            server_log.close()


class Checks(unittest.TestCase):
    def test_back_only_dismisses_a_visible_keyboard(self):
        for state, calls in [(b"mInputShown=false", 1), (b"mInputShown=true", 2)]:
            with patch(__name__ + ".adb", return_value=state) as native:
                hide_keyboard()
                self.assertEqual(native.call_count, calls)
                if calls == 2:
                    native.assert_called_with("shell", "input", "keyevent", "4")

    def test_file_fixtures(self):
        with tempfile.TemporaryDirectory() as directory:
            photo, pdf = fixtures(Path(directory))
            data = photo.read_bytes()
            self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
            position = 8
            while position < len(data):
                length = struct.unpack_from(">I", data, position)[0]
                payload = data[position + 4:position + 8 + length]
                crc = struct.unpack_from(">I", data, position + 8 + length)[0]
                self.assertEqual(zlib.crc32(payload) & 0xffffffff, crc)
                position += length + 12
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF-1.4"))

    def test_locator_and_bounds(self):
        root = ET.fromstring('<hierarchy><node text="Share" content-desc="" bounds="[10,20][30,60]"/></hierarchy>')
        self.assertEqual(center(find(root, "Share")), ("20", "40"))
        self.assertIsNone(find(root, "Other"))

    def test_rejects_unpatched_or_unregistered_apk(self):
        manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:exported="true"><intent-filter><data android:scheme="opencodemobile"/></intent-filter>'
        for action in ("SEND", "SEND_MULTIPLE"):
            manifest += f'<intent-filter><action android:name="android.intent.action.{action}"/><data android:mimeType="*/*"/></intent-filter>'
        manifest += '</activity></application></manifest>'
        assert_receiver(manifest, b"opencode-share-")
        with self.assertRaises(AssertionError):
            assert_receiver(manifest, b"unpatched")
        with self.assertRaises(AssertionError):
            assert_receiver(manifest.replace('exported="true"', 'exported="false"'), b"opencode-share-")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--apk", type=Path)
    parser.add_argument("--output", type=Path, default=Path("native-share-results"))
    args = parser.parse_args()
    if args.self_test:
        unittest.main(argv=[__file__])
    else:
        if not args.apk:
            parser.error("--apk is required")
        validate(args.apk, args.output)
