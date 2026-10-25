"""Generate ``tools/oracle/corpus.json``, the canonical golden-fixture corpus.

The corpus has three parts, in this order:

* ``core``       hand-picked edge cases (CJK, emoji, whitespace, special-token
                 look-alikes, normalisation traps, the empty string);
* ``paragraph``  four synthesized paragraphs (original text written for this
                 project, not copied from any source);
* ``fuzz``       300 strings drawn deterministically from a mixed alphabet with
                 ``random.Random(20261025)``.

Only the standard library is used, so the script runs on any CPython >= 3.9
and the output is byte-identical across versions (``Random.choice`` and
``Random.randint`` are built on ``getrandbits``, whose stream is stable).

``--export-alphabet`` also writes ``tools/oracle/alphabet.json``: the fuzz
generator's weighted pools and the distinct code points the corpus uses (as
ranges, per corpus part), the input alphabet for the web app's fuzz tests.
``--check`` verifies both files.

Usage::

    uv run --project tools/oracle tools/oracle/make_corpus.py [--export-alphabet] [--check]
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import tempfile
from pathlib import Path

CORPUS_PATH = Path(__file__).resolve().parent / "corpus.json"
ALPHABET_PATH = Path(__file__).resolve().parent / "alphabet.json"
FUZZ_SEED = 20261025
FUZZ_COUNT = 300
FUZZ_MAX_LEN = 40

# (name, text, tags). Invisible or control characters use escapes in this
# source file only; corpus.json stores the real characters (JSON itself
# escapes C0 controls such as \n, \r and \t).
CORE_CASES: list[tuple[str, str, list[str]]] = [
    ("zh-tw-tainan", "台灣台南", ["cjk", "zh-tw"]),
    ("ja-text", "日本語のテキスト", ["cjk", "ja"]),
    ("ja-shibuya-ramen", "東京都渋谷区のラーメン屋さん", ["cjk", "ja"]),
    ("en-hello-world", "Hello, world!", ["latin"]),
    ("mixed-hello-taiwan-tokyo", "Hello 台灣! 東京タワー", ["cjk", "latin", "mixed"]),
    ("en-contraction-code", "I'm here\n\n code();", ["latin", "whitespace", "code"]),
    ("zh-date", "2024年10月", ["cjk", "digits"]),
    ("zh-numerals", "二〇二六年", ["cjk"]),
    ("digits-7", "1234567", ["digits"]),
    ("zh-tw-taiwan-formal", "臺灣", ["cjk", "zh-tw"]),
    ("zh-tw-renao", "熱鬧", ["cjk", "zh-tw"]),
    ("cjk-saba", "鯖", ["cjk", "rare"]),
    ("cjk-turtle", "龜", ["cjk", "rare"]),
    ("cjk-ext-g-biang", "\U00030edd", ["cjk", "rare", "astral"]),
    ("emoji-family-zwj", "\U0001f469‍\U0001f469‍\U0001f467", ["emoji", "zwj", "astral"]),
    ("emoji-flag-tw", "\U0001f1f9\U0001f1fc", ["emoji", "astral"]),
    ("emoji-heart-vs16", "❤️", ["emoji", "variation-selector"]),
    ("bopomofo", "ㄅㄆㄇㄈ ㄊㄞˊㄨㄢˇ˙ㄉㄜ", ["bopomofo", "zh-tw"]),
    ("fullwidth-latin", "ｆｕｌｌｗｉｄｔｈ ＡＢＣ１２３", ["fullwidth", "normalization"]),
    ("halfwidth-katakana-dakuten", "ﾀﾞ", ["ja", "halfwidth", "normalization"]),
    ("katakana-decomposed", "ガ", ["ja", "combining", "normalization"]),
    ("ja-marks", "東京ー々ゝ〜・", ["cjk", "ja"]),
    ("ivs-katsuragi", "葛\U000e0100城", ["cjk", "variation-selector", "astral"]),
    ("nel", "a\u0085b", ["whitespace", "control"]),
    ("bom-prefix", "﻿hello", ["zero-width", "control"]),
    ("line-separator", "x y", ["whitespace"]),
    ("ideographic-space", "全角　空格", ["cjk", "whitespace"]),
    ("crlf", "line1\r\nline2", ["whitespace"]),
    ("trailing-spaces", "trailing   ", ["whitespace"]),
    ("leading-spaces", "   leading", ["whitespace"]),
    ("tab-between", "a\tb", ["whitespace"]),
    ("literal-sp-space", "literal ▁ U+2581", ["sentencepiece-marker"]),
    ("special-endoftext", "<|endoftext|>", ["special-string"]),
    ("special-bos", "<bos>", ["special-string"]),
    ("special-start-of-turn", "<start_of_turn>user", ["special-string"]),
    ("special-think", "<|think|>", ["special-string"]),
    ("newline-pair", "\n\n", ["whitespace"]),
    ("tab-only", "\t", ["whitespace"]),
    ("three-spaces", "   ", ["whitespace"]),
    ("emoji-flag-tw-leading-space", " \U0001f1f9\U0001f1fc", ["emoji", "astral", "whitespace"]),
    ("emoji-thumbs-leading-space", " \U0001f44d", ["emoji", "astral", "whitespace"]),
    ("digits-5", "12345", ["digits"]),
    ("year-2024", "2024", ["digits"]),
    ("en-hello-world-bare", "Hello world!", ["latin"]),
    ("en-hello-tokenizers", "Hello world, tokenizers!", ["latin"]),
    ("en-quick-brown-fox", "Hello, world! The quick brown fox.", ["latin"]),
    ("ja-tokenization", "日本語のトークン化", ["cjk", "ja"]),
    ("ja-shibuya-ramen-short", "東京都渋谷区のラーメン屋", ["cjk", "ja"]),
    ("cjk-utsu", "鬱", ["cjk", "rare"]),
    ("cjk-ta", "龘", ["cjk", "rare"]),
    ("emoji-skin-tone", "\U0001f600\U0001f44d\U0001f3fd", ["emoji", "skin-tone", "astral"]),
    ("zh-tw-split-chars", "雲澎閩鳳酥", ["cjk", "zh-tw"]),
    ("zh-tw-counties", "臺灣雄嘉義屏東彰林苗栗", ["cjk", "zh-tw"]),
    ("empty", "", ["edge"]),
    # Pre-tokenizer port discriminators (design 04 §2.2). Each one's chunks change if a JavaScript port uses
    # the JS \s set instead of Unicode White_Space (U+FEFF in, U+0085 out), treats U+001C-1F as whitespace,
    # or drops the (?i:) case folding of the contraction alternative (including U+017F long s).
    # nel-after-space and fs-control are the design's plain forms; the *-before-letter forms put the code
    # point right after a space, where the whitespace alternatives decide the chunk boundary.
    ("ws-bom-mid", " using \ufeffnamespace", ["whitespace", "zero-width", "discriminator"]),
    ("nel-after-space", "a\u0085 b", ["whitespace", "control", "discriminator"]),
    ("nel-before-letter", "x \u0085y", ["whitespace", "control", "discriminator"]),
    ("fs-control", "a\u001cb", ["control", "discriminator"]),
    ("fs-before-letter", "x \u001cy", ["control", "discriminator"]),
    ("contraction-upper", "HE'S here", ["latin", "contraction", "discriminator"]),
    ("contraction-long-s", "it'\u017f", ["latin", "contraction", "discriminator"]),
    ("contraction-dont-upper", "DON'T", ["latin", "contraction", "discriminator"]),
    # The three cases above end a letter run with the contraction. Only o200k-style patterns, where the
    # contraction is a suffix of the letter run, chunk them differently without (?i:). cl100k, Llama 3 and
    # Grok-2 try the contraction first and otherwise match it as punctuation + letters, so they need the
    # contraction to be followed by more letters.
    ("contraction-upper-run", "'TWAS", ["latin", "contraction", "discriminator"]),
    ("contraction-long-s-run", "'\u017ftill", ["latin", "contraction", "discriminator"]),
    # One special-token string per shipped tokenizer, taken from its own special-token table (design 04 §2.4):
    # Llama 3 and Muse Glimmer added_tokens, Grok-2 special_tokens, Grok-1 CONTROL pieces, Gemma 1/2
    # USER_DEFINED pieces and claude.json special_tokens.
    ("special-llama3-bot", "x <|begin_of_text|> y", ["special-string"]),
    ("special-llama4-eot", "x <|eot|> y", ["special-string"]),
    ("special-grok2-eos", "x <|eos|> y", ["special-string"]),
    ("special-grok1-bos", "x [BOS] y", ["special-string"]),
    ("special-gemma2-end-of-turn", "x <end_of_turn> y", ["special-string"]),
    ("special-claude-eot", "x <EOT> y", ["special-string"]),
]

ZH_TW_PARAGRAPH = (
    "「如果你只有一天可以待在台南，該怎麼安排？」朋友在捷運上這樣問我。"
    "我想了想，建議他一早先去國華街喝碗熱騰騰的牛肉湯，配一碗肉燥飯，"
    "再到附近的老店買一杯冬瓜茶。中午可以走到赤崁樓一帶，順路嘗嘗碗粿、"
    "蝦捲和鱔魚意麵。台南的小吃偏甜，第一次來的人常常嚇一跳，但吃久了反而會"
    "懷念那種味道。許多老店只做早上的生意，有的一天只賣兩百份，賣完就收攤，"
    "週末去還得排隊。下午天氣熱，不妨躲進巷弄裡的咖啡店，看看老房子改建的空間"
    "怎麼保留原本的木窗與磨石子地板。傍晚再去安平老街散步，買些蜜餞當伴手禮，"
    "看夕陽慢慢落進台灣海峽。如果時間還夠，晚上可以去花園夜市逛逛，不過要注意"
    "它只在週四、週六和週日營業。可惜台南目前還沒有捷運，移動大多得靠機車或公車；"
    "從台北搭高鐵南下大約一個半小時，再轉接駁車進市區。朋友聽完笑著說："
    "「這樣聽起來，一天根本不夠，至少要住三晚吧！」我點點頭，順手把收藏的"
    "美食清單傳給他，提醒他記得帶悠遊卡，回台北轉乘捷運時才不會手忙腳亂。"
)

JA_PARAGRAPH = (
    "週末、久しぶりに京都へ出かけました。朝早く新幹線に乗り、駅に着いたら"
    "まずコンビニでおにぎりとお茶を買いました。午前中は清水寺を参拝し、"
    "坂道の途中にある小さなお店で抹茶ソフトクリームを食べました。昼ごろから"
    "雨が降り始めたので、予定を変更して錦市場をぶらぶら歩くことにしました。"
    "漬物や湯葉、だし巻き卵など、どれも美味しそうで迷ってしまいます。結局、"
    "母へのお土産に京漬物を少しだけ買いました。夕方には"
    "鴨川沿いのカフェでコーヒーを飲みながら、スマートフォンで撮った写真を"
    "整理しました。帰りの電車ではすっかり疲れて眠ってしまいましたが、とても"
    "充実した一日でした。次は紅葉の季節に、友達と一緒にゆっくり旅行したいです。"
)

EN_PARAGRAPH = (
    "When Maria opened the bakery on 14th Street in 2019, she didn't expect the "
    'line to stretch around the block by 7:30 a.m. "People told me sourdough was '
    'a fad," she says, laughing, "but we\'ve sold more than 250,000 loaves since '
    "then.\" Her secret isn't complicated: a 36-hour fermentation, flour milled "
    "within 120 miles, and a starter she's kept alive for over a decade. Last "
    "spring she began posting recipes at https://example.com/recipes?lang=en&page=2, "
    "and the site now gets roughly 3,400 visitors a day. It's a small business, "
    "but it's hers, and she wouldn't trade it for anything."
)

MIXED_CODE = (
    "{\n"
    '  "name": "tokenizer-demo",\n'
    '  "version": "1.0.0",\n'
    '  "vocab": {"hello": 15339, "world": 1917},\n'
    '  "enabled": true\n'
    "}\n"
    "\n"
    "def count_tokens(text: str) -> int:\n"
    '    """Return a rough token estimate."""\n'
    "    if not text:\n"
    "        return 0\n"
    "    words = text.split()\n"
    "    return max(1, round(len(words) * 1.3))\n"
)

PARAGRAPH_CASES: list[tuple[str, str, list[str]]] = [
    ("zh-tw-paragraph", ZH_TW_PARAGRAPH, ["cjk", "zh-tw"]),
    ("ja-paragraph", JA_PARAGRAPH, ["cjk", "ja"]),
    ("en-paragraph", EN_PARAGRAPH, ["latin"]),
    ("mixed-code", MIXED_CODE, ["code", "whitespace"]),
]

# Fuzz alphabet: each entry is (weight, label, pool). A pool is either a list
# of inclusive code-point ranges or a list of literal strings (one is chosen).
# The labels only name the pools in alphabet.json; they never reach the RNG.
_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~、。，「」！？：；（）…ー・"
FUZZ_ALPHABET: list[tuple[int, str, list[tuple[int, int]] | list[str]]] = [
    (3, "CJK Unified Ideographs", [(0x4E00, 0x9FFF)]),
    (2, "Hiragana", [(0x3041, 0x3096)]),
    (2, "Katakana", [(0x30A1, 0x30FA)]),
    (1, "Hangul syllables", [(0xAC00, 0xD7A3)]),
    (1, "Bopomofo", [(0x3105, 0x312F)]),
    (3, "Latin letters", [(0x41, 0x5A), (0x61, 0x7A)]),
    (2, "ASCII digits", [(0x30, 0x39)]),
    (2, "ASCII and CJK punctuation", list(_PUNCT)),
    (1, "Emoji", [(0x1F300, 0x1F5FF), (0x1F600, 0x1F64F), (0x1F680, 0x1F6C5), (0x1F900, 0x1F9FF)]),
    (2, "Whitespace", [" ", " ", "\r\n", "\n", "\t", "　"]),
]


def _pick(rng: random.Random, pool: list[tuple[int, int]] | list[str]) -> str:
    """Return one string drawn from ``pool`` (ranges or literals)."""
    item = rng.choice(pool)
    if isinstance(item, str):
        return item
    lo, hi = item
    return chr(rng.randint(lo, hi))


def fuzz_strings(seed: int = FUZZ_SEED, count: int = FUZZ_COUNT) -> list[str]:
    """Return ``count`` deterministic fuzz strings of 1..FUZZ_MAX_LEN code points."""
    rng = random.Random(seed)
    weighted = [pool for weight, _label, pool in FUZZ_ALPHABET for _ in range(weight)]
    out: list[str] = []
    for _ in range(count):
        length = rng.randint(1, FUZZ_MAX_LEN)
        text = ""
        while len(text) < length:
            text += _pick(rng, rng.choice(weighted))
        out.append(text[:length])  # may cut "\r\n" to a lone "\r" (intended)
    return out


def build_corpus() -> dict:
    """Assemble the corpus document (a plain JSON-serialisable dict)."""
    cases = [{"name": n, "text": t, "tags": ["core", *tags]} for n, t, tags in CORE_CASES]
    cases += [{"name": n, "text": t, "tags": ["paragraph", *tags]} for n, t, tags in PARAGRAPH_CASES]
    cases += [{"name": f"fuzz-{i:03d}", "text": t, "tags": ["fuzz"]} for i, t in enumerate(fuzz_strings())]
    names = [c["name"] for c in cases]
    assert len(names) == len(set(names)), "duplicate case names"
    return {
        "description": "Canonical golden-fixture corpus for tokenize-step-by-step. "
        "Generated by tools/oracle/make_corpus.py; do not edit by hand.",
        "fuzz": {"count": FUZZ_COUNT, "maxLen": FUZZ_MAX_LEN, "seed": FUZZ_SEED},
        "version": 1,
        "cases": cases,
    }


def _ranges(code_points: set[int]) -> list[list[int]]:
    """Collapse code points into sorted, inclusive ``[first, last]`` ranges."""
    out: list[list[int]] = []
    for cp in sorted(code_points):
        if out and out[-1][1] == cp - 1:
            out[-1][1] = cp
        else:
            out.append([cp, cp])
    return out


def build_alphabet(corpus: dict) -> dict:
    """The fuzz generator's pools and the corpus's distinct code points, for the web app's fuzz tests."""
    pools = []
    for weight, label, pool in FUZZ_ALPHABET:
        entry: dict = {"label": label, "weight": weight}
        if all(isinstance(item, str) for item in pool):
            entry["literals"] = list(pool)
        else:
            entry["ranges"] = [list(item) for item in pool]
        pools.append(entry)
    parts: dict[str, set[int]] = {"core": set(), "paragraph": set(), "fuzz": set()}
    for case in corpus["cases"]:
        parts[case["tags"][0]].update(ord(ch) for ch in case["text"])
    used = set().union(*parts.values())
    return {
        "description": "Alphabet of the golden-fixture corpus: the fuzz generator's weighted pools (fuzz.pools) and"
        " the distinct code points each corpus part uses (codePoints, inclusive [first, last] ranges). Generated by"
        " tools/oracle/make_corpus.py --export-alphabet; do not edit by hand.",
        "codePoints": {"all": _ranges(used), **{part: _ranges(cps) for part, cps in parts.items()}},
        "counts": {"all": len(used), **{part: len(cps) for part, cps in parts.items()}},
        "fuzz": {**corpus["fuzz"], "pools": pools},
        "version": 1,
    }


def render(doc: dict) -> bytes:
    """Serialise deterministically: sorted keys, UTF-8, indent=1, LF, final newline."""
    return (json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")


def render_alphabet(doc: dict) -> bytes:
    """Serialise the alphabet: like :func:`render`, but ASCII-only (invisible code points stay readable) and
    with one ``[first, last]`` pair per line."""
    text = json.dumps(doc, ensure_ascii=True, indent=1, sort_keys=True)
    return (re.sub(r"\[\s+(\d+),\s+(\d+)\s+\]", r"[\1, \2]", text) + "\n").encode("utf-8")


def write_atomic(path: Path, data: bytes) -> None:
    """Write ``data`` to ``path`` via a temp file + rename so readers never see a partial file."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=path.name, suffix=".partial")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def main(argv: list[str] | None = None) -> int:
    """CLI entry point: write corpus.json, or with ``--check`` verify it is current."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if corpus.json or alphabet.json is stale")
    parser.add_argument("--export-alphabet", action="store_true", help="also write alphabet.json")
    args = parser.parse_args(argv)
    doc = build_corpus()
    outputs = {CORPUS_PATH: render(doc), ALPHABET_PATH: render_alphabet(build_alphabet(doc))}
    if args.check:
        stale = [path.name for path, data in outputs.items() if (path.read_bytes() if path.exists() else b"") != data]
        for name in stale:
            print(f"{name} is stale; re-run make_corpus.py --export-alphabet", file=sys.stderr)
        if not stale:
            print(f"{CORPUS_PATH.name} and {ALPHABET_PATH.name} are up to date")
        return 1 if stale else 0
    write_atomic(CORPUS_PATH, outputs[CORPUS_PATH])
    print(f"wrote {CORPUS_PATH.name}: {len(doc['cases'])} cases, {len(outputs[CORPUS_PATH])} bytes")
    if args.export_alphabet:
        write_atomic(ALPHABET_PATH, outputs[ALPHABET_PATH])
        print(f"wrote {ALPHABET_PATH.name}: {len(outputs[ALPHABET_PATH])} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
