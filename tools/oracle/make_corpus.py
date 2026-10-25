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

Usage::

    uv run --project tools/oracle tools/oracle/make_corpus.py [--check]
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import tempfile
from pathlib import Path

CORPUS_PATH = Path(__file__).resolve().parent / "corpus.json"
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

# Fuzz alphabet: each entry is (weight, pool). A pool is either a list of
# inclusive code-point ranges or a list of literal strings (one is chosen).
_PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~、。，「」！？：；（）…ー・"
FUZZ_ALPHABET: list[tuple[int, list[tuple[int, int]] | list[str]]] = [
    (3, [(0x4E00, 0x9FFF)]),  # CJK Unified Ideographs
    (2, [(0x3041, 0x3096)]),  # Hiragana
    (2, [(0x30A1, 0x30FA)]),  # Katakana
    (1, [(0xAC00, 0xD7A3)]),  # Hangul syllables
    (1, [(0x3105, 0x312F)]),  # Bopomofo
    (3, [(0x41, 0x5A), (0x61, 0x7A)]),  # Latin letters
    (2, [(0x30, 0x39)]),  # ASCII digits
    (2, list(_PUNCT)),  # ASCII + CJK punctuation
    (1, [(0x1F300, 0x1F5FF), (0x1F600, 0x1F64F), (0x1F680, 0x1F6C5), (0x1F900, 0x1F9FF)]),
    (2, [" ", " ", "\r\n", "\n", "\t", "　"]),  # whitespace
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
    weighted = [pool for weight, pool in FUZZ_ALPHABET for _ in range(weight)]
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


def render(doc: dict) -> bytes:
    """Serialise deterministically: sorted keys, UTF-8, indent=1, LF, final newline."""
    return (json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")


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
    parser.add_argument("--check", action="store_true", help="exit 1 if corpus.json is stale")
    args = parser.parse_args(argv)
    doc = build_corpus()
    data = render(doc)
    if args.check:
        current = CORPUS_PATH.read_bytes() if CORPUS_PATH.exists() else b""
        if current != data:
            print(f"{CORPUS_PATH.name} is stale; re-run make_corpus.py", file=sys.stderr)
            return 1
        print(f"{CORPUS_PATH.name} is up to date")
        return 0
    write_atomic(CORPUS_PATH, data)
    print(f"wrote {CORPUS_PATH.name}: {len(doc['cases'])} cases, {len(data)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
