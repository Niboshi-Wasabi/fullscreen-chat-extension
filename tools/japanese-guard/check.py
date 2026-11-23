"""Review Japanese prose in the working tree with pinned, offline detectors."""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VENDOR = Path(__file__).resolve().parent / "vendor"
REPORT = ROOT / ".harness-artifacts" / "japanese-guard.json"
TEXT_SUFFIXES = {
    ".md", ".mdc", ".txt", ".html", ".css", ".ts", ".tsx", ".js", ".jsx",
    ".mjs", ".cjs", ".json", ".ps1", ".toml", ".yml", ".yaml", ".py",
}
KANA = re.compile(r"[\u3041-\u3096\u30a1-\u30fa]")
JAPANESE_LINE = re.compile(r"[\u3041-\u3096\u30a1-\u30fa\u4e00-\u9faf\u3005]")
LOCALES = "src/shared/i18n/locales/"
EXCLUDED = ("tools/japanese-guard/vendor/", "scripts/locale-catalogs/")

sys.path[:0] = [
    str(VENDOR / "yomiyasu" / "scripts"),
    str(VENDOR / "nihongo" / "scripts"),
]

from yomiyasu_diff import diff
from yomiyasu_lint import lint_text
from revert_broken import remaining


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def git_paths(*args):
    return {name for name in git(*args).decode("utf-8").split("\0") if name}


def eligible(name):
    if name.startswith(EXCLUDED) or Path(name).suffix.lower() not in TEXT_SUFFIXES:
        return False
    return not name.startswith(LOCALES) or name == f"{LOCALES}ja.json"


def read_text(root, name):
    file = root / name
    return file.read_bytes().decode("utf-8-sig") if file.is_file() else ""


def prose(name, source):
    source = source.replace("\r\n", "\n")
    if Path(name).suffix in {".md", ".mdc", ".txt"}:
        return source
    # Preserve source line numbers while removing lines with no Japanese text.
    return "\n".join(line if JAPANESE_LINE.search(line) else "" for line in source.split("\n"))


def review(name, before, after, scan_all):
    has_japanese = JAPANESE_LINE if name == f"{LOCALES}ja.json" else KANA
    if not (has_japanese.search(before) or has_japanese.search(after)):
        return None
    original = prose(name, before)
    revision = prose(name, after)
    if original == revision and not scan_all:
        return None
    lint = lint_text(revision)["findings"] if revision.strip() else []
    meaning = []
    drift = []
    if original.strip() and original != revision:
        meaning = diff(original, revision)["meaning_risks"]
        drift = remaining(original, revision)
    return {"path": name, "style": lint, "yomiyasuMeaning": meaning, "nihongoMeaning": drift}


def self_test():
    before = "ゲストは、ライブ配信中に限り最大10件までコメントを表示できます。\n"
    after = "ゲストは、ライブ配信中に限り最大20件までコメントを表示できます。\n"
    if review("example.md", before, before.replace("\n", "\r\n"), False) is not None:
        raise RuntimeError("The checker reported a line-ending change as a prose edit.")
    changed = review("example.md", before, after, False)
    if not changed["yomiyasuMeaning"] or not changed["nihongoMeaning"]:
        raise RuntimeError("A meaning checker missed the changed limit.")
    invalid = "ユーザーはデータを**操作**: \n"
    if not review("example.md", "", invalid, False)["style"]:
        raise RuntimeError("yomiyasu missed a style candidate.")
    print("Japanese guard self-test passed (unchanged text and changed limit).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    comparison = parser.add_mutually_exclusive_group()
    comparison.add_argument("--base", help="Git ref to compare with (default: HEAD)")
    comparison.add_argument("--baseline", type=Path, help="Directory containing the pre-edit files")
    parser.add_argument("--all", action="store_true", help="Also lint unchanged Japanese prose")
    parser.add_argument("--strict", action="store_true", help="Exit 1 if either meaning checker flags a change")
    parser.add_argument("--self-test", action="store_true", help="Check the bundled detectors with a known changed limit")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0

    working = git_paths("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    if args.baseline:
        if not args.baseline.is_dir():
            parser.error(f"baseline is not a directory: {args.baseline}")
        original = {
            file.relative_to(args.baseline).as_posix()
            for file in args.baseline.rglob("*")
            if file.is_file()
        }
    else:
        base = git("rev-parse", "--verify", "--end-of-options", (args.base or "HEAD") + "^{tree}").decode().strip()
        original = git_paths("ls-tree", "-rz", "--name-only", base)
        if not args.all:
            working = git_paths("diff", "--no-renames", "--name-only", "-z", base, "--") | (working - original)
            original &= working

    results = []
    for name in sorted(working | original):
        if not eligible(name):
            continue
        before = ""
        if name in original:
            before = (
                read_text(args.baseline, name)
                if args.baseline
                else git("show", f"{base}:{name}").decode("utf-8-sig")
            )
        result = review(name, before, read_text(ROOT, name), args.all)
        if result is not None:
            results.append(result)

    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    style = sum(len(item["style"]) for item in results)
    yomiyasu = sum(len(item["yomiyasuMeaning"]) for item in results)
    nihongo = sum(len(item["nihongoMeaning"]) for item in results)
    print(f"{len(results)} files | style: {style} | meaning: yomiyasu {yomiyasu}, nihongo {nihongo}")
    print(REPORT)
    return 1 if args.strict and (yomiyasu or nihongo) else 0


if __name__ == "__main__":
    sys.exit(main())
