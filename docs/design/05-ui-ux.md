# 05 — UI / UX (area E)

*Binding for WP06 (shell, theme, i18n, About), WP08 (board, inspector, keyboard, pointer), WP09 (pipeline, motion), WP10 (BYOK), WP13 (integration). Research citations are to `docs/research/01-tokenizers-and-platform.md`.*

## 1. Information architecture

Two static pages (Vite MPA) plus `404.html`: `/` (the tool) and `/about/` (About · Fidelity · Licences & provenance · Engine · Keyboard · Privacy · Diagnostics). On `/`, regions in DOM order (= tab order):

1. **Header** — wordmark; tokenizer picker button with the tokenizer's fidelity badge; UI-language menu (文/A); theme toggle (auto/light/dark); `?` help.
2. **Input** — auto-growing `<textarea>` (3–8 rows); text-language chip (auto / zh-Hant / ja / en); example chips (one tab stop); option toggles (only those the tokenizer declares: special tokens · BOS · NFKC); hex/dec control; grapheme-brackets switch; counts line (code points · graphemes · bytes · tokens · partial-character tokens).
3. **Pipeline rail** — six stops (`role="radiogroup"`, §8); step scrubber visible at stop 5; Play button; speed.
4. **Board** — the three-tier alignment grid (one tab stop).
5. **Inspector + merge list** — surface chosen by **viewport width only** (AD-34; the same rule is repeated in §3.3, §3.5, §5 and §9): **≥ 1024 px** a side rail (320 px; 420 px at ≥ 2560) holding the merge list and the inspector panel; **768–1023 px** an anchored inspector panel beside the active cell and the merge list as a collapsible section under the board; **< 768 px** a bottom-sheet inspector (collapsed 56 px, expanded 40 vh) and the collapsible merge list. The inspector is a non-modal `role="region"` in every surface; the board is never made `inert`.
6. **Notices strip + footer** — the selected tokenizer's `requiredNotices` ("Powered by xAI" while Grok-2 is selected; "Built with Meta Llama 3"; Gemma notice; Claude legacy disclaimer), fidelity sentence, links to About.
7. **BYOK drawer** — "Live check with your own API key", closed by default.

### 1.1 State model (`apps/web/src/app/app.svelte.ts`, Svelte 5 runes)

```ts
interface AppState {
  text: string; textLang: TextLangChoice;                   // 'auto' | 'zh-Hant' | 'ja' | 'en' (03 §B.7); resolvedTextLang: ResolvedTextLang is derived (§10)
  tokenizer: TokenizerId; options: EncodeOptions;
  stage: 1 | 2 | 3 | 4 | 5 | 6; step: number;            // step ∈ [0, stepCount] meaningful at stage 5
  playing: boolean; speed: 0.5 | 1 | 2;
  byteView: 'hex' | 'dec' | 'both'; graphemes: boolean; cellSize: 'S' | 'M' | 'L';
  theme: 'auto' | 'light' | 'dark'; locale: Locale;
  singleKeyShortcuts: boolean;                               // WCAG 2.1.4 turn-off (§8); persisted; default true
  focus: { tier: 'char' | 'byte' | 'chunk' | 'token'; byte: number } | null;   // anchor is a byte offset (AD-17)
  pinned: { byte: number; tier: Tier } | null;              // survives re-tokenization and stage changes
  inspectorFocus: 'grid' | 'panel';                          // `i` moves focus into the panel, Esc returns (§5)
  result: TokenizationResult | null; resultSource: 'precomputed' | 'live'; resultStale: boolean;   // stale = text changed since the last on-demand run (AD-27)
  loading: Progress | null; error: UiError | null;
  longInput: 'live' | 'virtualized' | 'on-demand' | 'capped';   // AD-27
}
```

Derived: `rows = packRows(result, K)`, `partsAt(step)`, `inspectorModel`, `resolvedTextLang`. Persistence: `localStorage` for theme, locale, byteView, graphemes, cellSize, singleKeyShortcuts, reduced-motion override (every read/write in try/catch). URL (read once at load; `history.replaceState` debounced 500 ms; text only on explicit "Copy link", ≤ 2,000 chars): `?t=<tokenizer>&q=<text>&s=<stage>.<step>&b=hex|dec|both&lang=<ui>&tl=<TextLangChoice>`.

## 2. The step-by-step pipeline and scrubbing

| # | byte-level BPE | SentencePiece | Board shows |
|---|---|---|---|
| 1 | Text | Text | Char tier only, uniform cells (left-packed boxes, AD-17); grapheme brackets |
| 2 | Code points | Code points | `U+XXXX` labels under glyphs (≥ 480 px; otherwise in the inspector); normalized-text row if NFKC is on |
| 3 | UTF-8 bytes | UTF-8 bytes | Boxes expand to byte spans; byte tier unfolds (hex / dec / both) |
| 4 | Chunks | Symbols | Chunk brackets with index + matched rule name (regex pre-tokenizer) / `▁` escaping, dummy prefix as a full-column marker cell (SVG mark), USER_DEFINED symbols as locked chips, HF (Gemma 4) byte fallback already shattered here (no split step exists at stop 5 for HF order) |
| 5 | Merges | Merges | Live parts as chips in the token tier; replay step by step; merge list in the rail |
| 6 | Tokens | Tokens | Final chips with ids; partial hatching; inspector |

Timeline position = `(stage, step)`; stage 6 ≡ stage 5 at `step = stepCount` plus ids. Byte-level replays **chunk by chunk, left to right** (earlier chunks complete, the active one partially merged, later ones still single bytes) so the board reads like the algorithm running; spm replays one global sequence followed by the fallback splits. The merge-list row for step k reads "step 7 / 7 · `E7` + `81` → 66285 (part of 灣)" (cl100k `zh-tw-tainan`; `stepSentence(k)` from the view, rendered through a named-placeholder template, §10).

Scrubber: `<input type="range" min=0 max=stepCount>` with chunk-boundary tick marks (`<datalist>`), `aria-valuetext` = the merge sentence; `touch-action: pan-y` on the input (horizontal drags scrub, vertical pans scroll; the thumb is a pseudo-element and cannot carry `touch-action` of its own). Playback: step duration = `clamp(60 ms, 12 s / stepCount, 450 ms)` so any input replays in ≤ 12 s at ×1; speeds ×0.5 / ×1 / ×2; above 2,000 steps replay is scoped to the focused chunk (byte-level) or a 2,000-byte window around the focused cell (spm), stated in the rail's `role="status"` line. Follow mode scrolls the affected row into view with `scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })`; off once the user scrolls manually until "jump to end".

## 3. The three-tier alignment board

### 3.1 Grid model

The board is a vertical stack of **rows**; each row is one CSS grid: `grid-template-columns: repeat(K, var(--cell))` with named sub-rows `[bracket] [char] [byte-hex] [byte-dec] [chunk] [token] [id]`. Every column has the same width `--cell`: a **byte column** carries one byte, a **marker column** (AD-25) is a full column inserted where a zero-width token sits (BOS, Grok-1 dummy `▁`; up to two markers before code point 0 when both apply). Because all columns are uniform, the generated placement classes `.c<start>.s<span>` (AD-15) count markers as ordinary columns and no per-row `grid-template-columns` is ever set (strict CSP needs no CSSOM template). Dynamic values (`--hue`, `--cut`) are set through the CSSOM (`element.style.setProperty`). One column per byte at **every** stage (AD-17); at stops 1–2 char boxes are transformed to uniform widths and left-packed.

### 3.2 Row packing — `packRows(result, K, opts): RowModel[]` (`@tsbs/core/layout`, pure, property-tested)

```text
packRows(result, K): RowModel[]                                     // RowModel / Fragment are FROZEN in core/model/view-types.ts (03 §B.2)
  rows ← []; cur ← newRow(); used ← 0
  for each code point i in order:
      m ← markersBefore(i)                                           // COUNT of zero-width tokens whose boundary is byteStart(i): 0, 1 or 2 (BOS + Grok-1 dummy)
      w ← byteLen(i) + m                                             // one full column per marker (AD-25)
      if used + w > K and used > 0: rows.push(cur); cur ← newRow(); used ← 0
      place the m markers then char i in cur at columns used … used+w−1; used += w
  trailing markers (zero-width token at byteStart = utf8.length, e.g. BOS on empty text) → one column at the end of the last row (new row if full)
  rows.push(cur)
  for each span S in {graphemes, chunks, tokens, live parts}: fragments(S) ← one per row touched: [max(s, rowStart), min(e, rowEnd))
      fragment ≠ first gets the "continued" marker at its left edge; fragment ≠ last gets the "continues" marker at its right edge (§4);
      all fragments share spanId and reference the visually hidden <span id="frag-<spanId>"> (§8)
  return rows (each with fixed height per breakpoint)
Properties (fast-check): a code point never splits across rows; rows ≤ K columns; fragments of a span tile exactly its byte range;
  K ≥ 8 ⇒ waste per row ≤ maxUnit − 1 where maxUnit = 4 + maxMarkersBefore (≤ 6, so waste ≤ 5; ≤ 3 when the result has no markers);
  a marker is never separated from its code point; deterministic for (result, K). Named cases: Grok-1 `zh-tw-tainan` (dummy marker),
  Grok-1 + addBos (two markers before code point 0), Llama 3 addBos on `empty` (trailing marker).
```

Fragments of one span count as **one** cell for keyboard navigation (focus lands on the first fragment; all fragments get `data-active`) and share `aria-describedby="frag-<spanId>"` so a screen reader hears "token 3, continued (part 2 of 2)".

### 3.3 Cell size, row height and surfaces by breakpoint (AD-18)

**K is never a literal.** `K = clamp(8, floor((boardWidth − 2·gutter) / cell), 64)` with `gutter = 16 px`, `boardWidth` = the board container's width (viewport minus the side rail where one exists, capped by the board max-width), recomputed on `ResizeObserver` (debounced one frame); WP08's component test asserts K from this formula, never from a table. The "K (formula)" column below is illustrative output only.

| Viewport | Pointer | `--cell` (S / M / L) | Rail | Board max-width | K (formula) | Row height | Inspector surface (AD-34) | Notes |
|---|---|---|---|---|---|---|---|---|
| 360–479 px | coarse | 36 / 36 / 40 (coarse floor 36) | — | — | 9 at 360, 12 at 479 | 106 px: bracket 6 · char 40 · byte 24 · token 28 · gaps 8 | bottom sheet | U+ labels, chunk brackets → sheet; hex **or** dec |
| 480–767 | coarse | 36 / 36 / 40 | — | — | 12–20 | 132 px: bracket 6 · char 48 (incl. U+ labels) · byte 24 · chunk 14 · token 28 · gap 12 | bottom sheet | |
| 768–1023 | any | 29 / 32 / 37 (coarse floor 36) | — | — | 23–30 | 148 px | anchored panel | merge list collapsible under the board |
| 1024–1439 | fine | 27 / 30 / 35 | 320 px | — | 22–36 | 169 px (hex **and** dec rows) | side rail | |
| 1440–2559 | fine | 29 / 32 / 37 | 320 px | 1600 px | 34 at 1440; 49 once the cap binds (≥ 1952) | 169 px | side rail | |
| ≥ 2560 (4K) | fine | `clamp(32px, 1.6vw, 44px)` | 420 px | 2400 px | 53 at 3840 (2368 / 44); the 64 clamp is a safety bound, not a target | `calc(var(--cell) * 3.5 + 56px)` | side rail | type scales with `clamp()`; gutters absorb the rest |

Coarse-pointer targets (WCAG 2.5.8, checked by a Playwright touch project): char cell 36 × 40, byte cell 36 × 24, token chip 36 × 28 (gaps ≥ 2 px), marker cell 36 × 28 (a full column — never `--cell/2`), example chips ≥ 40 px tall, scrubber thumb 44 px, sheet handle button 44 px. Row heights are fixed per breakpoint and written to `contain-intrinsic-size`, so the board height is known before paint (CLS ≈ 0) and virtualization is arithmetic (`scrollTop → row`). No row has an id track — token ids sit inside their chips at every width (PA-17, §4) — but from 480 px the row ends with a gap track: 12 px at 480–1023 (2 px of slack stay unused at 768–1023); from 1024 the gap is `1fr`: 39 px with one byte row, 14 px with both (the `[bytes2]` track is `auto`, as tall as the dec row when it shows). So a row's chips sit farther from the next row's characters than from their own bytes at every width (14 / 18 → 18 / 22 → 16 / 46 px at 600 / 800 / 1440 px; 16 / 21 px with both byte rows; at ≥ 2560 px `cell / 4 + 7` / `cell + 15`). The BYOK live tier (§13) is one more track right under the token tier, before the gap.

### 3.4 Sketches

All numbers below are formula outputs from §3.3 and fixture facts from `fixtures/*.json`; they are the data the WP08/WP09 tests use. Sketch notation: `⤷` / `⤍` stand for the SVG continuation marks, `▞` for the SVG hatch mark and `┆` for the two-tone hatched cut (§4) — none of them is rendered as a text glyph.

**360 px phone · cl100k_base · `zh-tw-tainan` 台灣台南 (12 bytes, cell 36, K = floor(328 / 36) = 9 → rows of 3 + 1 code points) · stop 6**

```text
┌──────────────────────────────────────────────┐ 360 px
│ ≡ tokenize · step by step         文/A  ☾  ? │ 48 px (icon buttons carry aria-label, §3.5)
│ ▾ cl100k_base · GPT-4 / 3.5 · ✓ 已確認       │ picker chip (full width; 2 px role=progressbar beneath while loading)
├──────────────────────────────────────────────┤
│ 台灣台南                                      │ textarea
│ [台灣台南][臺灣][熱鬧][鯖][龜][𰻝][👩‍👩‍👧][🇹🇼] › │ example chips (verbatim corpus texts, §6; SVG hatch mark on chips that split a character here)
│ 文字 自動 ▾  ☐ 特殊詞元   HEX ◉ DEC ○  ☑ 字位簇 │ text-lang · toggles · hex/dec · graphemes
│ 4 碼位 · 4 字位簇 · 12 位元組 · 5 詞元 · 2 部分字元詞元 │ counts (<ul>; separators aria-hidden; wraps at 360 px)
├──────────────────────────────────────────────┤
│ ① 文字 ② 碼位 ③ 位元組 ④ 切塊 ⑤ 合併 ⑥ 詞元    │ pipeline rail (radiogroup; current checked)
├──────────────────────────────────────────────┤
│ ⌐‾‾‾‾‾‾‾‾‾¬⌐‾‾‾‾‾‾‾‾‾¬⌐‾‾‾‾‾‾‾‾‾¬              │ grapheme brackets (6 px)
│ │   台    ││   灣    ││   台    │              │ char tier (40 px; glyph 24 px; 灣's background sliced per byte column)
│ │E5│8F│B0││E7│81┆A3││E5│8F│B0│              │ byte tier (24 px; ┆ two-tone hatched cut at the token boundary)
│ [ 55038  ][66285 ][96][ 55038  ]             │ token chips (28 px; every id inside its chip, PA-17: chips of ≤ 2 columns are stacked — the id on top, the hatch, lock and continuation marks on one line under it: 66285 and 96 over ▞; an id narrows to the 62.5 % width of the digits font, then shrinks, when its chip is too small)
│ [        ][  ▞   ][▞ ][        ]             │
├──────────────────────────────────────────────┤
│ ⌐‾‾‾‾‾‾‾‾‾¬                                   │ row 2
│ │   南    │                                   │
│ │E5│8D│97│                                   │
│ [ 59563 ]                                    │
├──────────────────────────────────────────────┤
│ ▲ 詞元 96 · A3 · [5,6) · 灣 的最後 1 個位元組     │ bottom-sheet inspector (role=region; collapsed 56 px ↔ 40 vh via the ▲ button, aria-expanded)
│   與前一個詞元 66285 共同組成 灣                  │ the focused row is never under the sheet: scroll-padding-block-end = sheet height (§5)
└──────────────────────────────────────────────┘
```

**768 px tablet · o200k_base · `ja-text` 日本語のテキスト (24 bytes, cell 32, K = floor(736 / 32) = 23 → rows of 7 + 1 code points) · stop 5 (step 3 / 18)**

```text
┌────────────────────────────────────────────────────────────────────────────────┐ 768 px
│ tokenize · step by step   [ o200k_base · GPT-4o → 5.x · GPT-6 ≈ ▾ ]   文/A ☾ ? │
│ 日本語のテキスト                                                                 │
│ [台灣台南][日本語のテキスト][東京都渋谷区のラーメン屋さん][Hello 台灣! 東京タワー][2024年10月] › │
│ text: ja ▾  ☐ special tokens  HEX ◉ DEC ○  ☑ graphemes   8 cp · 8 gr · 24 B · 6 tok │
│ ① Text ② Code points ③ UTF-8 ④ Chunks ⑤ Merges ⑥ Tokens                        │
│ ◀ ━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ ▶   step 3 / 18   ▷ play  ×1         │
│ ⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬⌐‾‾‾‾‾‾¬                           │
│ │  日  ││  本  ││  語  ││  の  ││  テ  ││  キ  ││  ス  │                           │ row 1: 7 code points = 21 of 23 columns
│ │E6│97│A5│E6│9C│AC│E8│AA│9E│E3│81│AE│E3│83│86│E3│82│AD│E3│82│B9│                 │
│ └──── chunk 0 · rule 1 (letters) ──────────────────────────────────── ⤍         │ chunk fragment continues on row 2
│ [E6][97][A5][E6][9C][AC][E8][AA][9E][ E3 81 ][AE][ E3 83 ][86][E3][82][AD][E3][82][B9]│ parts after 3 merges (each part's id inside, above its hex, PA-17)
│ ⤷ ⌐‾‾‾‾‾‾¬                                                                      │ row 2
│   │  ト  │                                                                      │
│   │E3│83│88│                                                                    │
│ ⤷ ──┘                                                                          │
│   [ E3 83 ★][88]                                                                │ ★ = just merged (pulse)
│ ▸ merges (chunk 0): 1 E3+81→605 (の) · 2 E3+83→769 (テ) · ▶3 E3+83→769 (ト) · 4 E3+82→845 (キ) · 5 E3+82→845 (ス) … 18 │ collapsible merge list
│ ┌ INSPECTOR (anchored panel, 768–1023 px) ─────────────────────────────────────┐ │
│ │ step 3 / 18 · E3 + 83 → 769 (part of ト) · chunk 0 · rank 769          [copy] │ │
└────────────────────────────────────────────────────────────────────────────────┘
```

**1440 px laptop · Grok-2 · `ja-shibuya-ramen` 東京都渋谷区のラーメン屋さん (42 bytes, cell 32, rail 320, K = floor((1440 − 320 − 32) / 32) = 34 → rows of 11 + 3 code points) · stop 6, token 4242 crossing a char boundary**

```text
┌────────────────────────────────────────────────────────────────────────────────────────┬───────────────────────────┐ 1440 px
│ tokenize · step by step   [ xAI · Grok-2 (131k) · Grok 2/2.5 ✓ · Grok 4.x ≈ inferred ▾ ]│  文/A   ☾   ?             │
├────────────────────────────────────────────────────────────────────────────────────────┼───────────────────────────┤
│ 東京都渋谷区のラーメン屋さん                                                              │ MERGES · chunk 0 / 0      │
│ [台灣台南][日本語のテキスト][東京都渋谷区のラーメン屋さん][Hello 台灣! 東京タワー]…  text: ja ▾  HEX ◉ DEC ◉ │  … 11 E3 83 BC+E3 83→4242 │
│ ① Text ② Code points ③ UTF-8 ④ Chunks ⑤ Merges ⑥ Tokens                                │───────────────────────────│
│ ⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬⌐‾‾‾‾‾¬        │ INSPECTOR (pinned)        │
│ │ 東  ││ 京  ││ 都  ││ 渋  ││ 谷  ││ 区  ││ の  ││ ラ  ││ ー  ││ メ  ││ ン  │        │ token 8 of 12 · id 4242   │
│ │E6│9D│B1│E4│BA│AC│E9│83│BD│E6│B8┆8B│E8│B0│B7│E5│8C│BA│E3│81│AE│E3│83│A9│E3│83│BC│E3│83┆A1│E3│83│B3│ bytes E3 83 BC E3 83      │
│ │230│157│177│228│186│172│233│131│189│230│184│139│232│176│183│229│140│186│…│227│131│179│ dec 227 131 188 227 131   │
│ └─────────────────────────── chunk 0 · rule 1 ─────────────────────────────── ⤍        │ span [24,29) · partial     │
│ [120316 東京都 ][5626▞][▞267][27850 谷][12029 区][1741 の][5889 ラ][ 4242 ー+▞▞ ][▞289][  ン  ]│ covers ー and 2 of 3 bytes │
├────────────────────────────────────────────────────────────────────────────────────────┤ of メ — needs A1 (289)     │
│ ⤷│ 屋  ││ さ  ││ ん  │   row 2: 3 code points (9 of 34 columns)                        │ formed at step 11 ▸ show   │
├────────────────────────────────────────────────────────────────────────────────────────┴───────────────────────────┤
│ Powered by xAI · This product includes materials licensed under the xAI Community License … · About · Licences      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**3840 px (4K) · `--cell` = 44 px (the clamp's upper bound), rail 420 px, board capped at 2400 px → K = floor((2400 − 32) / 44) = 53.** The 64 upper clamp of the formula is unreachable with these caps and exists only as a safety bound; type scales via `clamp(14px, 0.45vw, 20px)`; gutters absorb the remaining width. A 600-character zh-TW paragraph (1,800 bytes) fits in 34 rows, virtualized to the visible ~12.

```text
┌──────────────────────── 3840 px ────────────────────────────────────────────────────────────────────────────────────────────┐
│          ◄── gutter ──►┌────────────── board ≤ 2400 px, 53 columns × 44 px ──────────────────┬── rail 420 px ──┐◄── gutter ──►│
│                        │ 台 灣 台 南 … 53 byte columns per row, 210 px rows, hex + dec rows   │ merges · inspector│              │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.5 Component tree

```text
App
├─ Header (Wordmark, PickerButton→PickerDialog, LocaleMenu, ThemeToggle, HelpButton→HelpDialog)
├─ InputPanel (TextArea, TextLangChip, ExampleChips, OptionToggles, ByteViewControl, GraphemeSwitch, CountsLine)
├─ PipelineRail (StopRadio×6 in a radiogroup, Scrubber, PlayButton, SpeedSelect, ScopeStatus)
├─ Board (role=grid)
│   └─ Row×n (fixed height; virtualized window that always includes the focused/pinned row)
│       ├─ BracketLayer (grapheme brackets, chunk brackets)
│       ├─ CharCell×m (two-layer: .cell-box / .cell-glyph; sliced background; U+ label)
│       ├─ MarkerCell (zero-width token; full column; id over ▁/BOS, dotted border + aria-label)
│       ├─ ByteCell×k (hex | dec | both)
│       └─ TokenChip / PartChip (fragments with SVG continuation marks; hatched edges; id inside, ChipId)
├─ InspectorHost — ≥1024: SideRail (MergeList, InspectorPanel) | 768–1023: AnchoredPanel (InspectorPanel) + MergeList (collapsible) | <768: BottomSheet (InspectorPanel) + MergeList (collapsible)
│   └─ InspectorPanel (role=region, aria-labelledby, non-modal in every surface; §5)
├─ NoticesStrip (requiredNotices of the selected tokenizer)
├─ LiveCheckDrawer (AnthropicCountPanel, XaiTokenizePanel, LiveTokenTier adapter)
├─ Footer (counts summary, fidelity note, About/Licences links)
└─ StatusRegion (role=status, aria-live=polite) · AlertRegion (role=alert)
```

**ARIA table (normative for WP06/WP08/WP09; keys are i18n `MessageKey`s):**

| Element | Role / attributes | Announcements |
|---|---|---|
| Picker chip loading bar | `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow aria-valuetext="downloading o200k_base, 64 %"`; picker button `aria-busy="true"` while loading | `role="status"`: "o200k_base ready" on `loaded` |
| Errors (oom, integrity, fetch, BYOK failures) | `role="alert"` region (separate element from the status region) | assertive, once |
| Stage / load / copy / pin messages | `role="status"` region (`aria-live="polite"`) | "UTF-8 bytes: 12 bytes" · "pinned: token 2 of 5, id 66285, partial" · "copied: 66285" · "merge replay limited to the first 50,000 steps" |
| Icon-only header buttons | `aria-label` keys `a11y.localeMenu` (文/A), `a11y.themeToggle` (☾, with `aria-pressed`-free menu semantics), `a11y.help` (?) | — |
| Counts line | `<ul role="list">` of `<li>`; the "·" separators are CSS `::before` content with `aria-hidden` | reads "4 code points, 4 grapheme clusters, 12 bytes, 5 tokens, 2 partial-character tokens" |
| Pipeline rail | `role="radiogroup" aria-label="pipeline stage"`; stops `role="radio" aria-checked`, label template `a11y.stop` = "{n} of 6: {name}"; `ScopeStatus` is `role="status"` ("replaying chunk 2 of 7") | arrows move and select |
| Scrubber | native `<input type="range">` with `aria-valuetext` = merge sentence | — |
| Play | `<button aria-pressed>` (Space/Enter native) | — |
| Board | §8 (grid, rowindex/colindex/colspan, describedby) | merge steps announced only on manual stepping |
| Inspector | `role="region" aria-labelledby="<inspector heading id>"`; sheet handle `<button aria-expanded aria-controls>` | "pinned: …" via status |
| Example chips | `role="listbox"`, chips `role="option" aria-selected`, each with `lang` of its `ResolvedTextLang`; hatch mark SVG `aria-hidden` + visually hidden `a11y.chipSplits` ("splits a character on this tokenizer") | — |
| Markers | §4 table: SVG `aria-hidden="true"` + visually hidden localized text or cell `aria-label` | — |

## 4. Rendering rules

- **Char tier**: glyph centered in a cell spanning `byteLen` columns; `lang` = the resolved text language (`zh-Hant-TW` / `ja` / `en` / `ko` / `und`, §10 — Han glyph forms: 台/灣/直/骨 differ between TC and JP fonts); U+ label from stop 2 when the cell is ≥ 2 columns and the viewport ≥ 480 px. Whitespace and controls render as visible stand-ins in a muted colour (table below). **Combining marks and variation selectors** (`katakana-decomposed` U+3099, `ivs-katsuragi` U+E0100, `emoji-heart-vs16` U+FE0F) get a cell of their own: the mark is drawn on an `aria-hidden` U+25CC dotted-circle base (`◌` + mark, so it never floats or renders as tofu) and the cell's `aria-label` is `a11y.combining` = "combining mark U+3099 attached to カ" (variation selectors: "variation selector U+E0100 attached to 葛"); the grapheme bracket ties it to the base.
- **Markers are never bare text glyphs.** Every semantic marker is an inline SVG (`aria-hidden="true"`, `currentColor`, 12–16 px, shipped in the CSS/JS bundle, so no font fallback is involved) with an adjacent visually hidden localized label or an `aria-label` on the cell (SR text in §10): row continuation marks (replacing `⤷` / `⤍`), the partial-split hatch mark on chips and example chips (replacing `▞`), the lock on USER_DEFINED chips, the "just merged" star. (The zero-width token marker and the Byte-kind icon left the chips with PA-17: a marker shows its id over `▁`/`BOS` inside its dotted border, a byte-fallback chip its id over `<0xNN>`; the dotted border and the `<0x…>` notation are the cues.) The whitespace/control **stand-ins** below are text, but always rendered in a bundled ≤ 4 KB subset WOFF2 (`font-src 'self'` is allowed by the CSP) listed first in the stand-in font stack, with the same visually hidden labels.

| Stand-in (rendered) | For | SR text key → en |
|---|---|---|
| `␠` | U+0020 | `a11y.standin.space` → "space" |
| `⇥` | U+0009 | "tab" |
| `⏎` / `␍` | U+000A / U+000D | "line feed" / "carriage return" |
| `⍽` | U+00A0 and other `White_Space` | "no-break space" / "white space U+3000" |
| `⟨U+0085⟩` | controls (`Cc`) | "control character U+0085" |
| `BOM` | U+FEFF | "byte order mark" |
| `ZWJ` / `ZWNJ` | U+200D / U+200C | "zero-width joiner" |
| `▁` | spm escaped space (piece display only) | "escaped space" |

- **Grapheme brackets**: a 1 px bracket above each cluster spanning > 1 code point (ZWJ emoji, flags, IVS, combining sequences); label "1 grapheme · 5 code points · 18 bytes"; toggle `g`.
- **Byte tier**: `E5` (hex, uppercase, mono, 3ch) or `229` (dec); both rows at ≥ 1024 px (collapsible to one); switch crossfades digits 150 ms (opacity only — qualifies under reduced motion). Lead bytes slightly bolder than continuation bytes so a 3-byte char reads as "lead + 2". Byte cells carry the owning token's tint at 40 % — the vertical tint is the alignment cue between tiers.
- **Token / part chips**: 8 OKLCH hues at 20° + 45°·i with alternating lightness, and a 1 px `--border` that is the **conformance cue** (≥ 3:1 against every tint and surface, §11): WCAG 1.4.1 and 1.4.11 are satisfied by the border, the hatch and the brackets, never by the tints (adjacent tints differ by ≥ 45° hue and ≥ 0.07 L, which is informational and not a WCAG claim). Every chip with an id carries it inside, on every fragment and at every width down to one column (PA-17): the id is set in the bundled digits subset (Noto Sans figures, tabular, width axis 62.5–100 %, §10), whose `font-stretch` follows from the room the chip leaves it (its width less the inset, border, paddings and the marks beside the id) and the digit count, and below the narrowest width its size shrinks, so an id always fits and is never clipped. Chips of ≤ 2 columns and live parts are **stacked**: a column with the id on the first line and, under it, one line that never wraps holding the continuation marks, the lock, a part's hex, the hatch mark and the SPECIAL badge (left out when there is nothing to hold); marks that do not fit clip at both ends. A live part's hex never gives way: a part draws no continuation icons (its dashed edges mark the continuation, as on the live tier), and a lock beside its hex is left out on parts of one or two columns and shrinks on wider ones (by 1.33 px at most, a 3-column just-merged part at the 27 px cell; 3.33 px under `prefers-contrast: more`); final tokens keep their marks. A stacked chip's inline paddings are 1 px (5 px on a hatched edge, whose strip is 4 px). A 1-column final token with nothing but its id (no mark, lock, hatch, badge or byte piece) whose id has ≥ 5 digits sets it on **two lines**, split thousands-style (`236` over `778`; 7 digits `1234` over `567`), each at the full size — the same rule at every breakpoint. **Zero-width markers** show their id over `▁`/`BOS` (12 + 11 px inside the 24 px their 2 px dotted border leaves, no inline padding; the dummy prefix sets an id of ≥ 5 digits, Grok-1's `130089`, on two 10 px lines and draws its `▁` as the 2 px bar the glyph is, 1 px clear of the lines and of the border, 10 + 10 + 1 + 2 + 1 = 24 px, while BOS keeps one line over its `BOS`, Llama 3's `128000` and Llama 4's `200000` narrowed) and **byte-fallback chips** their id over `<0xNN>` (≤ 3 digits in every shipped vocabulary; the piece clips symmetrically in a 1-column chip as before); their names say the piece right after the id, as the chip shows it. Chip text (≥ 4 columns) clips before the id does. The stop-5 "just merged" star sits at the end of the part's hex line, under the id (8 px, 2 px from the right, 3 px from the bottom, just above the inspected-slice bar), and that line keeps 10 px free for it — on chips of two or more columns only: a 1-column chip (a part's 1-column fragment, a byte-fallback piece of a split step) has no room for it beside its hex or `<0xNN>`, so it draws no star and keeps its whole line. A 1-column just-merged cell carries a 1 px solid accent ring at its chip's edge instead: its pulse outline settles to the ring and stays, also when the step is reached by URL or by scrubbing, so a split step's byte-fallback pieces and a 2-byte part cut 1 | 1 by the row end keep a mark (the ring lies in the 1 px gaps beside the chip and the tier gaps above and below it, outside the active, pinned and selected rings, which are 2 px inside the border; adjacent ringed pieces read as one group), while a split part's wider fragment carries the star.

  Smallest ids (1-column chip with a mark or a hex under the id, 1 px borders; `prefers-contrast: more` takes 2 px more room, e.g. 7.4 px for 6 digits at the 27 px cell; bare 1-column ids never shrink, they take two lines):

  | Cell | 27 px (S, 1024–1439) | 30 px (M, 1024–1439) | 32 px (M, 768–1023 / ≥ 1440) | 36 px (coarse floor) |
  |---|---|---|---|---|
  | 6 digits (Gemma, Grok-1) | 8.2 px | 9.3 px | 10.1 px | 11.7 px |
  | 5 digits | 9.8 px | 11.2 px | 12 px | 12 px |

  A hatched edge takes 4 px more: a 6-digit id in a 1-column hatched stacked chip is 6.6 px at the 27 px cell (a 5–6-digit token whose 1-column fragment cuts a code point at a row end; none in the fixtures). The dummy prefix's id is not in this table: two 10 px lines at full width at every cell (one 8.2 px line at the 27 px cell before).

### 4.1 Hard cases (normative)

| Case | Char tier | Byte tier | Token tier / inspector |
|---|---|---|---|
| Whole char in one token (台 on o200k) | glyph over 3 columns; background = token tint 25 % | `E5 8F B0` | one chip spanning 3 columns; id |
| **Partial-character token** (灣 on cl100k: `E7 81` + `A3`) | glyph drawn once; background **sliced per byte column** into the owning tokens' tints; a hatched 2 px rule at the cut | unchanged | two chips; the cut edge is **hatched** with the two-tone `--hatch` stripes (`--fg` + chip hue, §11, ≥ 3:1 on the tint) and squared; `aria-label "… partial: first 2 of 3 bytes of 灣"`; inspector: "covers 2 of 3 bytes of 灣 — needs 1 more byte (A3)" |
| Partial token crossing a char boundary (Grok-2 4242 = ー + 2 bytes of メ; Claude 20094) | both chars sliced | — | one chip spanning 5 columns; hatched **right** edge only; "covers ー and 2 of 3 bytes of メ" |
| **Zero-width token** (Grok-1 `▁`, BOS) | — | — | a full marker column (AD-25) with a chip showing its id over `▁`/`BOS`, dotted border (the zero-width cue; PA-17 dropped the SVG mark), focusable (36 × 28 on coarse pointers); `aria-label` "dummy prefix, 0 bytes, id 130089" / "beginning-of-sequence token, 0 bytes, id 2, BOS"; inspector: "covers 0 bytes (dummy prefix added by the tokenizer)" |
| Fused dummy prefix (`▁Hello`) | — | — | chip starts at byte 0; inspector: "includes the dummy prefix (0 bytes)" |
| Byte-fallback piece (Gemma `<0xF0>`, Grok-1 `<0xE7>`) | glyph sliced per byte | — | one chip per byte, its id over the mono `<0xF0>` label (PA-17 dropped the `Byte` kind icon; the `<0x…>` notation is the cue), named "…, id 478, <0xF0>, 1 byte, byte-fallback piece, …"; Grok-1 and Gemma 2 (SentencePiece order) shatter the character as a split step at stop 5; Gemma 4 (HF order, `cjk-ext-g-biang` 𰻝 → four Byte chips) is already shattered at stop 4 and has no split step |
| USER_DEFINED symbol (Grok-1 digit, Gemma 2 `<start_of_turn>`) | normal | — | chip with a lock glyph, "pre-matched, never merges" |
| Special-token match (toggle on) | normal | — | chip with `SPECIAL` badge, dashed border |
| Direct-hit chunk (byte-level) | normal | — | one chip; stop 5 shows "whole chunk is a vocabulary entry — no merges" |
| Grapheme cluster (👩‍👩‍👧 = 5 cp / 18 B / 8 o200k tokens) | bracket over the cluster; ZWJ cells as `ZWJ` stand-ins | — | chips as usual (6 partial) |
| Whitespace / controls | stand-ins (`␠ ⇥ ⏎ ␍ ⍽`), `▁` for spm | — | chip text shows the same stand-ins |
| NFKC mode (Claude legacy) | normalized-text row above (from `sourceRunStart/End`, 03 §B.4): `fullwidth-latin` `ｆｕｌｌｗｉｄｔｈ ＡＢＣ１２３ → fullwidth ABC123`, `halfwidth-katakana-dakuten` `ﾀﾞ → ダ` (2 → 1) with changed runs underlined and arrows; tiers refer to the normalized text | — | — |
| Forced colours (`forced-colors: active`) | borders `CanvasText`; hatches `Highlight` | | |

## 5. Inspector (AD-34)

**Surface by viewport width only** (the same rule as §1, §3.3, §3.5, §9): **≥ 1024 px** a panel in the side rail; **768–1023 px** an anchored panel beside the active cell (manual placement with flip; CSS anchor positioning when available — Chrome 125 / Firefox 147 / Safari 26, §7.2; `[popover]`-free); **< 768 px** a bottom sheet (`position: fixed`, collapsed 56 px, expanded 40 vh). Pointer type never changes the surface.

**One role everywhere**: `role="region"` with `aria-labelledby` pointing at the panel heading ("Inspector — token 2 of 5"), non-modal, never `inert` on the board, never `role="tooltip"` (the panel holds interactive copy buttons and "show this step") and never `role="dialog"` (focus must stay in the grid while pinned). Content **follows focus and hover**: a keyboard focus move updates the panel immediately; on `pointer: fine` a hover updates it after 120 ms and the panel stays open while the pointer is over it, closing on Esc (WCAG 1.4.13 hoverable + dismissible). **Pin** = Enter/Space on a cell or click/tap: the content freezes on that cell (keyed by **byte offset + tier**, so it survives stage changes and re-tokenization) and the status region announces "pinned: token 2 of 5, id 66285, partial". While pinned, focus stays in the grid and the user keeps arrowing; a dedicated key **`i`** moves focus into the panel (first control), **Esc** in the panel returns focus to the originating cell, a second **Esc** unpins; tapping elsewhere unpins on touch. The sheet's handle is a `<button aria-expanded aria-controls>` toggling collapsed ↔ expanded (tap, Enter/Space); dragging the handle is an optional extra (WCAG 2.5.7), never the only way. The board's scroll container sets `scroll-padding-block-end: var(--sheet-height)` (and `scroll-padding-top` for the sticky header + picker chip at ≤ 479 px), and every focus move calls `scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' })`, so the focused row is never under the collapsed or expanded sheet (WCAG 2.4.11; E2E asserts the focused cell's rect does not intersect the sheet or header rects at 360 px).

Sections: **Token** (id, rank/priority, bytes hex and dec, `[start,end)`, byte length, completeness sentence, piece with visible `▁`, kind/flags as words, "formed at step k: `E7` + `81`" with "show this step" moving the scrubber); **Character** (glyph large with `lang`, `U+XXXX`, name-less; UTF-8 bytes, UTF-16 units, grapheme membership, chunk, owning tokens); **Byte** (hex / dec / binary; role: ASCII / lead-2/3/4 / continuation; owning char and token); **Step** (pair merged, priority, chunk). Every value has a copy button; `c` copies the focused cell's value and the status region says "copied: 66285".

## 6. Examples, picker, toggles, long input, IME

- **Example chips** (`examples.json`, all precomputed from fixtures, AD-16; `chip.text === case.text` byte-for-byte, enforced by `registry:check`, 03 §B.7). The 19 chips, as `fixtureCase` → verbatim text (`lang`): `zh-tw-tainan` 台灣台南 (zh-Hant, default) · `zh-tw-taiwan-formal` 臺灣 (zh-Hant) · `zh-tw-renao` 熱鬧 (zh-Hant) · `cjk-saba` 鯖 (ja) · `cjk-turtle` 龜 (zh-Hant) · `cjk-ext-g-biang` 𰻝 (zh-Hant) · `emoji-family-zwj` 👩‍👩‍👧 (auto) · `emoji-flag-tw` 🇹🇼 (auto) · `emoji-heart-vs16` ❤️ (auto) · `ja-text` 日本語のテキスト (ja) · `ja-shibuya-ramen` 東京都渋谷区のラーメン屋さん (ja) · `mixed-hello-taiwan-tokyo` `Hello 台灣! 東京タワー` (auto) · `zh-date` 2024年10月 (zh-Hant) · `en-contraction-code` `I'm here\n\n code();` (en) · `bopomofo` `ㄅㄆㄇㄈ ㄊㄞˊㄨㄢˇ˙ㄉㄜ` (zh-Hant) · `fullwidth-latin` `ｆｕｌｌｗｉｄｔｈ ＡＢＣ１２３` (en) · `zh-tw-paragraph`, `ja-paragraph`, `en-paragraph` (localized `label` "zh-TW paragraph" etc.; the text is the full corpus paragraph). A chip shows the SVG hatch mark when it yields a partial-character token on the selected tokenizer (precomputed), so the headline feature is one tap away even where the default example does not split (o200k, Llama 4/Muse, Gemma — §9). `role="listbox"`, ←/→ roving focus, active chip `aria-selected`; chip labels never truncate (the row scrolls, `touch-action: pan-x`); each chip carries the `lang` of its resolved text language.
- **Tokenizer picker**: `<dialog>` listbox (Safari 15.4+; no Popover API) grouped by lab in the brief's order (OpenAI, Anthropic, Google, Meta, xAI); each row: name, vocab size, wire size ("1.0 MB", from the Worker's `ready.assets`, 04 §6) or "downloaded ✓" (a `cache.keys()` probe on open, 03 §C.6), the tokenizer's fidelity badge (✓ confirmed · ≈ inferred · ◷ legacy), covered models as chips with their own badges and dated evidence on expand, licence tag; Anthropic row carries the red "not the Claude 3+ tokenizer" label and a "Claude 3+ → live check" row; secondary tokenizers under "More from <lab>"; typeahead. Selecting starts `unload` → `load`; the chip shows phased progress; the board keeps the last result until the new engine answers.
- **Toggles**: only those declared in `tokenizers.json.toggles` (special tokens · BOS · NFKC). Byte view (hex / dec / both ≥ 1024) and grapheme brackets are global.
- **Long input** (AD-27, binding): ≤ 2,000 code points → full board, full replay, `trace: true`. 2,001–20,000 → virtualized rows + scoped replay, `trace: true`. 20,001–100,000 → live tokenization pauses behind the banner "Long input — tokenize on demand" with a button; the counts line keeps **code points · graphemes · bytes live** from `analyzeText` while **tokens · partial** show the last on-demand values with a "stale" badge once the text changes; the on-demand run tokenizes the **whole** text with `trace: { maxSteps: 50_000 }` and the board is a **window (slice) of that full result** — 2,000 bytes around the caret — never a tokenization of the windowed substring (wrong for byte-level unless snapped to chunk edges, wrong for SentencePiece always); the scrubber is limited to the recorded prefix and the rail's status says "merge replay limited to the first 50,000 steps". 100,001–200,000 → the same with `trace: false` (counts + windowed token strip only; stops 5–6 show the final tokens). **Cap**: input beyond 200,000 code points is kept in the textarea but not analysed (`longInput: 'capped'`; banner "only the first 200,000 code points are analysed"); pasted text is never truncated. Memory: the main thread releases the previous result before accepting one larger than 8 MB (no crossfade above that; AD-27).
- **IME** (§7.4): `compositionstart` → provisional; `input` with `isComposing` updates stops 1–3 only (muted); browsers disagree on ordering (Chromium fires the final `input` with `isComposing: true` **before** `compositionend`; Firefox/WebKit fire `compositionend` **then** an `input` with `isComposing: false`), so on `compositionend` the encode is **scheduled** (`requestAnimationFrame` after reading `textarea.value`), and an `input` event with `isComposing === false` arriving afterwards is the authoritative trigger — the 40 ms debounce collapses the pair into one `seq`. Composing = `event.isComposing || event.key === 'Process' || event.keyCode === 229` (old Android keyboards); Enter and every shortcut are ignored while composing; paste tokenizes immediately. `spellcheck="false" autocapitalize="off" autocorrect="off"`. Tests: CDP `Input.imeSetComposition` on chromium plus Firefox and WebKit composition sequences driven through `page.keyboard` + `dispatchEvent` (06 §1).
- **Selection sync**: hover/focus on a cell highlights its vertical slice and selects the UTF-16 range in the textarea only on explicit "select in text" (no focus theft); `selectionchange` in the textarea highlights the covered cells (hex-editor pattern). The CSS Custom Highlight API colours a mirror layer where supported (Chrome 105 / Firefox 140 / Safari 17.2); no-op elsewhere.

## 7. Animation choreography (transform/opacity only, atomic grid cells — §7.3)

| Moment | What moves | Mechanism | Duration / easing | Reduced motion |
|---|---|---|---|---|
| Stop 1→2 | U+ labels fade/slide in | WAAPI opacity + translateY(4px), stagger 6 ms (cap 180 ms) | 200 ms ease-out | 120 ms opacity |
| **Stop 2→3 (the "aha")** | char boxes from uniform left-packed to byte-proportional; byte cells unfold beneath | FLIP on `.cell-box` (translate + scaleX), `.cell-glyph` translate only; byte cells translateY(−8px)→0 + opacity, stagger 8 ms | 350 ms `cubic-bezier(.2,0,0,1)` | 120 ms opacity swap |
| Stop 3→4 | chunk brackets draw; (spm) `▁` cells recolour, marker column inserts, USER_DEFINED chips lock | bracket `clip-path` reveal; FLIP for the column insert | 240 ms | 120 ms opacity |
| Merge step forward | right part chip slides to abut the left; both crossfade into the merged chip; pulse on the merged part (600 ms; on a 1-column cell it settles to a 1 px ring); byte-tier caret ↑ under the two parts | FLIP on chips keyed by part start; pulse = outline keyframe on a pseudo-element (opacity; the 1-column ring also thins the outline's width and offset, a paint on those few cells) | 280 ms move + 600 ms pulse | discrete swap + 600 ms static outline (then the ring on a 1-column cell) |
| Merge step backward | inverse (split) | same | same | same |
| Byte-fallback split (spm) | one chip shatters into byte chips | FLIP out from the parent box | 280 ms | discrete swap |
| Fast scrubbing (> 1 step / 100 ms) | no FLIP; chips crossfade | opacity only | 80 ms | same |
| Stop 5→6 | ids fade in; chunk brackets fade out | opacity | 200 ms | 120 ms |
| Tokenizer / byte-view / locale switch | whole board crossfades | `document.startViewTransition` with one `view-transition-name` on the board container (Chrome 111 / Safari 18 / Firefox 144); fallback: opacity | 220 ms | instant |
| Inspector open/close, sheet | panel / sheet slides in and fades | translateY + opacity (`@starting-style` where available) | 200 ms | 120 ms opacity |
| Loading | progress bar width; chip skeleton shimmer | CSS transition | — | `transition: none` on the bar; shimmer off |
| Follow-mode scrolling | row scrolls into view | `scrollIntoView({ behavior })` | browser smooth | `behavior: 'auto'` |
| Byte-view digit swap | digits crossfade | opacity only | 150 ms | unchanged (opacity-only swaps ≤ 150 ms are allowed under reduced motion) |

Rules: `will-change` only for the duration of an animation; animations are cancelled when the step changes mid-flight (`Animation.cancel()`), so fast scrubbing never queues; per-cell FLIP only when ≤ 600 cells change, else the row crossfades; `matchMedia('(prefers-reduced-motion: reduce)')` observed live with an in-app override; under reduced motion every programmatic scroll uses `behavior: 'auto'`, no transform animates, and only opacity swaps ≤ 150 ms remain; Svelte `animate:`, `transition:`, `in:`, `out:` directives are **forbidden by lint** in `apps/web` (they inject a runtime `<style>` for keyframes, which the strict CSP blocks — AD-15); the 60-line `flip.ts` (`snapshot(container) → commit() → play()`, WAAPI) is shared by the board and the chips.

## 8. Keyboard map (AD-22)

**Tab order**: header controls → textarea → example chips (one stop) → toggles → pipeline rail (one stop, a radiogroup; ←/→ move and select the stop) → scrubber → Play → **board (one stop)** → inspector panel (reachable by Tab and by `i`) → merge list → footer links → BYOK drawer.

**Board = APG layout grid** (binding ARIA contract): `role="grid"` with `aria-rowcount` = packedRows × tiers and `aria-colcount` = K. Every **mounted** `role="row"` carries `aria-rowindex` = `packedRow × tiers + tier + 1` (1-based; tiers in order char, byte-hex, byte-dec, chunk, token for the ones currently shown), every cell `role="gridcell"` carries `aria-colindex` = its first column + 1 and `aria-colspan` = the columns of **that fragment**. Rows outside the virtual window are unmounted, but **the window always includes the row holding the focused or pinned cell**, and after any remount focus is restored to the cell at the same byte offset and tier (nearest existing cell if that offset is gone), so roving `tabindex` never drops to `<body>`. A span fragmented over several rows is one logical cell (focus lands on the first fragment; all fragments get `data-active`); every fragment references a visually hidden `<span id="frag-<spanId>">` holding the localized `a11y.fragment` text "token 3, continued (part 2 of 2)" via `aria-describedby`. `aria-label` per cell, e.g. "byte 4 of 12: E7, decimal 231, first byte of 灣, in token 2 of 5 (id 66285, partial)".

| Key | Where | Action |
|---|---|---|
| `←` `→` | board | previous/next cell in the current tier by its unit (code point / byte / chunk / token); fragments count as one cell; wraps to the adjacent row |
| `↑` `↓` | board | change tier keeping the **byte anchor** (char ↔ byte ↔ chunk ↔ token, skipping absent tiers). `↑` on the top tier and `↓` on the bottom tier are **no-ops** (rows are changed with PageUp/PageDown only) |
| `Home` `End` / `Ctrl+Home` `Ctrl+End` | board | row start/end / board start/end |
| `PageUp` `PageDown` | board | previous/next packed row, same tier, nearest column |
| `Enter` `Space` | board | pin / unpin inspector (announced) |
| `i` | board (pinned or not) | move focus into the inspector panel |
| `Esc` | panel → board → textarea | in the panel: back to the cell; in the board: unpin, second Esc returns focus to the textarea; closes dialogs |
| `c` | board | copy the focused cell's value (id / hex / text); status region "copied: …" |
| `[` `]` | global* | previous / next stop |
| `,` `.` (`Shift` = ×10) | global* | previous / next merge step (past the end → stop 6; before the start → stop 4) |
| `1`–`6` | global* | jump to stop |
| `Space` | **scrubber focused only** | play / pause (the Play `<button>` takes Space natively; stops are radios and Space does nothing extra there) |
| `Home` `End` | scrubber | first / last step |
| `h` | global* | cycle byte view hex → dec → both (both only ≥ 1024 px) |
| `g` | global* | grapheme brackets |
| `t` | global* | open the tokenizer picker |
| `/` | global* | focus the textarea |
| `?` | global* | shortcuts dialog |

\*Global single-key shortcuts (WCAG 2.2 SC 2.1.4): a persisted setting **"Single-key shortcuts: on / off"** (`localStorage`, default on, shown in the `?` dialog and About › Keyboard) disables every row marked global*; `Esc`, arrows, `Enter`, `Space`, `Home`, `End`, `PageUp`, `PageDown`, `Tab`, `i` and `c` are component-scoped and unaffected. They are also ignored while focus is in an editable or a dialog and while an IME composition is active. **Key matching**: letters via `event.key` compared case-insensitively; punctuation and digits via `event.code` (`BracketLeft`, `BracketRight`, `Comma`, `Period`, `Digit1`–`Digit6`, `Slash`; `?` = `Slash` with `shiftKey`; the ×10 step = `Comma`/`Period` with `shiftKey`), so JIS and other layouts and Shift combinations behave (`Shift+,` yields `event.key === '<'`, which must not matter); never `event.keyCode`. Focus survives re-renders (cells are keyed by byte offset / token index; see the grid contract above). Modal dialogs (picker, help) trap focus (`inert` on the rest) and restore it on close; the inspector never does (§5). The `role="status"` region announces stage changes ("UTF-8 bytes: 12 bytes") and load completion ("o200k_base ready"); merge steps are announced only when stepping by keyboard, never during playback. A one-line hint sits under the board until the user has used the keys (localStorage).

## 9. Pointer and touch map

| Input | Action |
|---|---|
| Hover (fine pointer) | 120 ms inspector update (panel stays open while hovered; Esc closes, §5); highlight the vertical slice (char ↔ bytes ↔ token) and the merge-list row |
| Click / tap on a cell | pin (toggle); tap elsewhere unpins |
| Click on a merge-list row | scrub to that step |
| Drag the scrubber (native `<input type="range">`, thumb 28 px fine / 44 px coarse) | scrub; `touch-action: pan-y` on the input (horizontal drags scrub, vertical pans scroll; a pseudo-element thumb cannot carry its own `touch-action`) |
| Horizontal pan on chip rows and the rail | native scroll (`touch-action: pan-x`); no custom swipe gestures on the rail (conflicts with chip scrolling) |
| Vertical pan anywhere on the board | native page scroll (`touch-action: pan-y`); pinch-zoom not intercepted |
| Sheet handle | tap the `aria-expanded` button to expand/collapse; drag is optional (WCAG 2.5.7) |
| Long-press | nothing hidden (equals tap); copy actions live in the inspector |
| Right-click | native menu untouched |
| `pointer: coarse` | `--cell` floored at 36 px (S → 36, M 36, L 40), marker cells are full columns, byte tier 24 px, chips ≥ 40 px tall (targets table §3.3); no hover-only information anywhere. The inspector surface is **not** pointer-dependent (viewport only, AD-34) |

## 10. i18n plan (zh-TW · ja · en)

- Catalogs: `en.ts` (source of truth, typed keys → `MessageKey` union), `zh-TW.ts`, `ja.ts`; `t(key, params)` with **named placeholders only** (`{n} 位元組`, `{glyph} の先頭 {n} バイト`), so every locale may reorder parameters; plurals via `Intl.PluralRules`; CI fails if any locale misses a key or has an unused one, and a catalog test renders **every** template in all three locales with sample params (no leftover `{…}`). ≈ 190 strings (UI, notices, inspector sentences, a11y labels, marker SR text). Legal strings (xAI notice, Llama/Gemma notices, licence texts) are **not** translated; UI explanations around them are.
- **Numbers**: counts, sizes and durations use `Intl.NumberFormat(locale)` with grouping ("1,025 KB", "12 位元組"); **token ids, ranks, hex/dec byte values, byte offsets and step indices are raw ASCII digits with `font-variant-numeric: tabular-nums` and no grouping** ("133072", never "133,072" — copy-paste, mono alignment and the chip width budget depend on it).
- Locale resolution (`boot.js`, before first paint): `?lang` → `localStorage` → `navigator.languages` (`zh-TW`/`zh-Hant*`/`zh` → zh-TW; `ja*` → ja; else en). `<html lang>` = `zh-TW` / `ja` / `en`; `<title>`/`<meta name=description>` localised at runtime; runtime switching, no routes (AD-29).
- **Text language** chip (for the input mirror, the char tier and the inspector glyph — not the UI): `TextLangChoice = auto | zh-Hant | ja | en` (03 §B.7). Resolution to `ResolvedTextLang`: `zh-Hant` → **`zh-Hant-TW`** (so the UI root `zh-TW` and glyph cells resolve to the same font stack); `ja`, `en` as is; `auto`: kana → `ja`; Hangul → `ko`; Han only → `zh-Hant-TW` unless the UI locale is ja → `ja`; Latin/other → `und` (inherits the UI font). Example chips set the chip from their `lang` (`auto` for mixed-script cases).
- Font stacks (system fonts plus two bundled subsets, the stand-ins and the token-id digits; no CJK web fonts): **`:lang(zh)`** (matches `zh-TW`, `zh-Hant`, `zh-Hant-TW` — `:lang(zh-Hant)` would **not** match the `zh-TW` root, since `Hant` never matches the `TW` subtag under extended filtering) → `"PingFang TC", "Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Source Han Sans TC", system-ui, sans-serif`; `:lang(ja)` → `"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Noto Sans CJK JP", "Yu Gothic UI", Meiryo, system-ui, sans-serif`; `:lang(ko)` → `"Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "Malgun Gothic", system-ui, sans-serif`; UI/Latin/`und` → `system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif`; bytes/ids → `ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Noto Sans Mono", monospace` with `font-variant-numeric: tabular-nums`; token ids inside the board's chips → the bundled digits subset first (`--font-digits`: Noto Sans's ten figures, © 2022 The Noto Project Authors, SIL OFL 1.1, tabular figures baked in, width axis 62.5–100 kept, a 2,360 B WOFF2 preloaded from `index.html` right after the stylesheet, so the static first paint does not wait for it with empty chips; credited on About › Required notices; PA-17, §4); stand-in cells → the bundled subset WOFF2 first (§4); emoji fallback `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`. Glyph cells set `font-size` by script (CJK 22 px vs Latin 20 px at desktop) so ideograph and x-height balance. E2E (06 §1): in the zh-TW locale on the Linux CI image (`fonts-noto-cjk`) `getComputedStyle(uiLabel).fontFamily` and `getComputedStyle(glyphCell).fontFamily` resolve to the same TC family.
- Typography and copy: `word-break: keep-all` **only on single-line controls** (buttons, chips, tabs, radio labels); all sentence-length copy (notices strip, inspector sentences, help, fidelity sentence, banners) uses `line-break: strict; word-break: normal; overflow-wrap: anywhere` so CJK wraps at 360 px (E2E overflow assertion in zh-TW and ja, 06 §1); user text `overflow-wrap: anywhere`; fullwidth punctuation in zh-TW (「」，。) and ja (「」、。); no italics for CJK (emphasis by weight/colour); control labels never truncate with ellipsis (chips/tabs scroll); layouts tolerate ×1.6 string length (en is longest). Tone: plain, present tense, second person sparingly; numbers always with units; "token" never translated as 標記. Glossary (binding for sketches, catalogs and the counts line): token 詞元 / トークン · byte 位元組 / バイト · code point 碼位 / コードポイント · grapheme cluster 字位簇 / 書記素クラスタ · merge 合併 / マージ · chunk 切塊 / チャンク · tokenizer 分詞器 / トークナイザー · partial-character token 部分字元詞元 / 部分文字トークン · zero-width 零寬 / ゼロ幅 · byte fallback 位元組回退 / バイトフォールバック · confirmed 已確認 / 確認済み · inferred 推定 / 推定 · legacy 舊版 / レガシー. A native-speaker review pass of zh-TW and ja copy is a launch-checklist item (06 §7).
- **Marker SR text** (keys under `a11y.marker.*`, en shown): `continued` "continued from the previous row" · `continues` "continues on the next row" · `zeroWidthDummy` "dummy prefix, 0 bytes" · `zeroWidthBos` "beginning-of-sequence token, 0 bytes" · `splits` "splits a character on this tokenizer" · `partialCut` "token boundary inside this character" · `byteFallback` "byte-fallback piece {hex}" · `userDefined` "pre-matched symbol, never merges" · `special` "special token" · `justMerged` "merged at this step" · `combining` "combining mark {cp} attached to {base}".

## 11. Theming tokens (`@tsbs/ui-tokens`)

CSS custom properties on `:root` (light), redefined under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`; `color-scheme: light dark`; `body` has an explicit background. Three-state toggle (auto/light/dark) persisted; `boot.js` applies it before first paint.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` / `--surface` / `--surface-2` / `--surface-3` | oklch 0.985 / 0.96 / 0.92 / 0.86 (neutral) | 0.13 / 0.17 / 0.22 / 0.30 | page, panels, cells, brackets |
| `--fg` / `--fg-muted` | 0.22 / 0.45 | 0.95 / 0.72 | text |
| `--border` | **L ≤ 0.50** (neutral) | **L ≥ 0.72** | 1 px cell/chip borders — the WCAG 1.4.1 / 1.4.11 **conformance cue**: ≥ 3:1 against all 16 tints and all 4 surfaces (2 px and `--fg` under `prefers-contrast: more`) |
| `--accent` | oklch(**0.50** 0.12 200) | oklch(0.75 0.12 200) | focus ring, current stop, "just merged" pulse — ≥ 3:1 against every tint and surface |
| `--focus` | double ring: `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent)` | same | `:focus-visible` on every cell and control; the `--bg` halo isolates the ring from the cell's own border and tint, the accent ring is ≥ 3:1 against the halo and against any neighbouring tint; the focused cell gets `z-index: 1` so the ring paints above neighbours |
| `--tok-h0…h7` | hue 20° + 45°·i, C 0.08, L alternating 0.90 / 0.83 | L alternating 0.30 / 0.38 | token tints (chip text ≥ 4.5:1); adjacent chips differ by ≥ 45° hue and ≥ 0.07 L — **informational, not a WCAG claim** |
| `--hatch` | two-tone stripes: `repeating-linear-gradient(45deg, var(--fg) 0 1.5px, var(--tok-hN) 1.5px 3px)` | same | partial cut edges; the `--fg` stripe is ≥ 4.5:1 on its own tint, so the hatch is ≥ 3:1 by construction |
| `--cell`, `--gap` (2 px), `--row-h`, `--radius` (4 px), `--sheet-height` | per breakpoint (§3.3) | | layout; `--sheet-height` feeds `scroll-padding-block-end` (§5) |
| `--dur-fast` 120 ms, `--dur` 200 ms, `--dur-slow` 350 ms, `--ease` `cubic-bezier(.2,0,0,1)` | | | motion |

`pnpm -F @tsbs/ui-tokens check` (`check-contrast.mjs`, OKLab → sRGB → WCAG relative luminance, run in CI) asserts, in both themes: chip text (`--fg`) vs each of the 8 tints ≥ 4.5:1; `--border` vs each of the 16 tints and the 4 surfaces ≥ 3:1; the `--fg` hatch stripe vs its own tint ≥ 3:1; `--accent` vs each tint and surface ≥ 3:1 and vs `--bg` (the halo) ≥ 3:1; and, informationally (warning, not failure), adjacent tints ≥ 45° hue and ≥ 0.07 L apart. Approximate check with L ≈ ∛Y: light border L 0.50 vs tint L 0.83 → 3.55:1; dark border L 0.72 vs tint L 0.38 → 4.0:1; light accent L 0.50 vs tint L 0.83 → 3.55:1. `prefers-contrast: more` makes borders 2 px `--fg` and keeps the tints; `forced-colors: active` maps to system colours (borders `CanvasText`, hatches `Highlight`).

## 12. Loading and empty states

While the first tokenizer loads, the board shows the precomputed result of the current chip (badge "precomputed"); typed text shows stops 1–3 live from `analyzeText` on the main thread and a skeleton for stops 4–6 ("tokenizer loading… 64 %"). When the engine answers, the badge flips to "live" and the board crossfades (View Transition). Errors: `fetch` non-retryable → "A new version is available — reload"; `integrity` → auto-refetch once, then "Download was corrupted — retry"; `oom` → "Not enough memory to load Gemma 4 on this device — try o200k_base" with a back action that reloads the previous tokenizer from cache; `quota` is informational (works without Cache API).

## 13. BYOK panels (opt-in drawer; OD-5, AD-24)

Closed by default behind "Live check with your own API key"; opening shows the warning: the key stays in this tab's memory, is sent only to the provider over HTTPS, and is forgotten on reload; the site has no backend and no analytics. Keys live in a module-level `$state`, never persisted, cleared on "Forget key", on drawer collapse and on `pagehide`; requests use `credentials: 'omit'`; CSP `connect-src` allows only `'self' https://api.anthropic.com https://api.x.ai`. Manual trigger only (one request per click; button disabled while pending).

- **Anthropic count** (paired with `anthropic-claude-legacy`; also linked from every "Claude 3+" picker row): key (masked, `autocomplete="off"`), model select from `byok.json` (Opus 5.5, Sonnet 5.5, Haiku 5.5, Opus 4.6, Sonnet 4.6, each with `frameTokens`), optional workspace id. `POST https://api.anthropic.com/v1/messages/count_tokens` with `Authorization: Bearer <key>` (option: `x-api-key`), `anthropic-version: 2026-10-21`, `anthropic-dangerous-direct-browser-access: true`, `anthropic-workspace-id` when given; body `{ model, messages: [{ role: 'user', content: text }] }` (§3.2). Output: "API total N (includes ≈ f frame tokens → ≈ N−f content tokens) vs legacy-vocabulary count M; boundaries are not available". Errors mapped: 401 key; 400 workspace id / model; 429 rate limit; network/CORS → "Zero-data-retention organisations cannot call this endpoint from a browser".
- **xAI tokenize** (paired with Grok-2): key + model slug (default `grok-4.7`; list grok-4.7 / 4.6 / 4.5 / 4.3 from `byok.json`, §3.5). `POST https://api.x.ai/v1/tokenize-text` `{ text, model }` → `token_ids[]` with `token_bytes`/`string_token`. Rendered as an extra **live token tier** under the Grok-2 token tier, aligned by the returned bytes (spans from cumulative byte lengths; flags computed by the same rules), each live chip carrying its id inside by the board's rule (PA-17, §4: on every fragment, narrowed then shrunk, a 1-column id of ≥ 5 digits on two lines; this tier draws no continuation icons). The tier is a track of every row right under the Grok-2 token tier, before the row's gap (`[extra]`: 32 px, the token cells' 28 + 4; from 2560 px the token cells' height + 4 px, `0.75 × cell + 9 px`), its cells as tall as the board's token cells at every breakpoint; a hatched cut that falls inside a live chip passes under its id (the id paints above it on the chip's tint) and shows above and below it: identical boundaries → "matches Grok-2 ✓ on this text"; differences hatched and counted ("k of n boundaries differ") — this is how an `inferred` Grok 4.x badge gets settled on the user's own text. **Alignment guard**: if `concat(token_bytes) !== utf8(text)` (a future model adding BOS/specials, normalising, or returning `string_token` only), the panel says "could not align the API tokens to your text ({matched} of {total} bytes matched)" and the live tier renders as an **unaligned token strip** (ids and bytes in order, no spans, no hatching) — differences are never hatched on a misaligned response. Results are never stored.

## 14. About / Licences page (`/about/`, generated from `licences.generated.json` + `models.json` + `tokenizers.json`)

Sections: (1) what the site shows and does not claim (Anthropic legacy disclaimer; inferred mappings with dates; ctok not included in v1); (2) **fidelity table** (model → tokenizer → status → evidence link → checked on); (3) per-asset licence blocks for every `shipIntent: ship` asset: description, lab, SPDX, obligations verbatim from the manifest, provenance notes, pinned URL + revision, SHA-256 of upstream and of the shipped `.bin`, the MODIFIED statement, verbatim licence text in `<details>` served from `/licenses/<assetId>/<file>`; (4) required notices rendered prominently and exactly: xAI (Agreement link, the exact notice sentence, **"Powered by xAI"** as a heading-sized line — also in the footer whenever Grok-2 is selected), Meta Llama 3 ("Built with Meta Llama 3", the Notice sentence, Agreement copy), Gemma 1/2 (the Notice sentence, Prohibited Use Policy link, Terms copy, §3.2 restrictions statement), Apache-2.0 copies for Gemma 4 / Muse Glimmer / Grok-1, MIT texts for tiktoken ranks (with the rank-file basis disclosure) and the legacy Claude package (MIT/Apache-2.0 conflict noted; both satisfied); (5) engine: Unicode 16.0 pinning and the browser's detected level, oracle versions (tiktoken 0.14.0, sentencepiece 0.2.2, tokenizers 0.23.3), fixture generation date, Gemma 4 semantics and piece-type notes (04 §8), NFKC table note, cl100k pattern note, build sha; (6) keyboard help, including the "Single-key shortcuts" setting (§8); (7) privacy (no analytics, no cookies, BYOK memory-only, only `/tok`, `/assets`, `/examples` and the two opt-in providers are ever contacted); (8) diagnostics, read **without** a Worker: Cache API contents (from `cache.keys()` + the index entry) with "clear cache" and the note "Safari removes this cache after 7 days without a visit", `features` probed on the main thread (Cache API, `Intl.Segmenter`, `DecompressionStream('brotli')`, `crypto.subtle` — absent on plain http), the last `loaded` diagnostics saved by `/` in `sessionStorage` (`contentEncoding`, `layer`, ms). The resident tokenizer is shown on `/` in the picker, not here; the page loads no Worker and no vocabulary.

## 15. Notices strip rule

While tokenizer T is selected, every key in `tokenizers.json[T].requiredNotices` renders in the notices strip above the footer, in the UI locale for explanatory text and verbatim for legal strings; the strip is never collapsed below 360 px (it wraps). `registry:check` guarantees each key has strings in all three locales; an E2E test asserts "Powered by xAI" is visible after selecting Grok-2 and absent after selecting o200k.
