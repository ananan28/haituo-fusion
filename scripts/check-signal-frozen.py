"""Freeze Signal core; permit only the two explicitly requested translation-output edits."""
import pathlib, subprocess
BASE = "42e7aac6074979f5e654880efbc993799944c8f2"
ROOT = pathlib.Path(__file__).resolve().parent.parent
paths = ["src/app/bundles/preload", "src/app/bundles/workers", "src/app/js/haituo-signal-message-record.js", "src/app/js/haituo-scroll.js"]
files = subprocess.check_output(["git", "ls-tree", "-r", "--name-only", BASE, "--", *paths], cwd=ROOT, text=True).splitlines()
for path in files:
    expected = subprocess.check_output(["git", "show", BASE+":"+path], cwd=ROOT)
    if path == "src/app/bundles/preload/main.js":
        start = expected.index(b"    function HaituoPolishOutgoingEnglish(")
        end = expected.index(b"    function haituoProviderConfigured(", start)
        expected = expected[:start] + b"    function HaituoPolishOutgoingEnglish(source, text) {\n        return text;\n    }\n" + expected[end:]
        old = "调用 AI 结合最近聊天上下文，生成自然口语化译文".encode()
        assert expected.count(old) == 1, "Signal translation tooltip baseline changed"
        expected = expected.replace(old, "调用 AI 忠实原意，精准直译".encode())
    assert (ROOT/path).read_bytes() == expected, "Unexpected Signal core change: "+path
print(f"Signal core freeze: {len(files)} files verified; only identity output helper and faithful AI tooltip allowed")
