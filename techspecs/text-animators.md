# K3 — Per-glyph / word / line text animators (kinetic typography)

> Keystone **K3** from `engine-power-vs-ae.md` — the **best effort×impact** unlock.
> The surprise this spec documents: most of it is **already built**. Per-glyph
> layout is exposed to JS (`glyphLayout`), author-time metrics already run in
> **both** the browser and the Node/CLI export path (the engine-warmer), per-node
> transform/opacity/color/blur already exist, and a `KineticText` component already
> ships. K3 is therefore **mostly an authoring-layer job** — generalize what exists
> into a real selector × animator system — plus **one true engine item**: closing
> the custom-font author-time↔render parity gap. Companion to `render-to-texture.md`
> (the structural sibling: ship a seam, optimize behind it) and `premium-engine-map.md`.

## Core idea — and the one architecture decision

AE text animators = **range selectors** (which units, how much) × **stackable
animators** (what changes) at **glyph / word / line** granularity. Two ways to
lower that onto ONDA:

- **A — React-layer glyph expansion** *(chosen for v1)*. The authoring layer reads
  kerning-accurate glyph positions (`glyphLayout`, already exposed + already warmed
  in both runtimes), then emits **one node per unit** carrying its own animated
  `transform`/`opacity`/`color`/`blur`. **Zero renderer change** for glyph/word/line
  — it rides primitives we already have. Cost: "fat" JSON (N nodes per block), a
  per-glyph-blur cost caveat (each blurred glyph is its own RTT pass), and a
  dependency on author-time font parity (→ §G4).
- **B — Scene-native `TextAnimator` node** *(deferred, §D1)*. The renderer expands
  glyphs and applies per-glyph transforms internally (per-glyph Vello draws +
  per-glyph CPU raster). Compact JSON; no author-time-font coupling (the renderer
  always has the font). Heavier: touches both backends.

**Decision: ship A now, design the public API so B is a pure lowering swap later** —
exactly how RTT shipped CPU-first behind a stable `Effect` seam and listed 3D as the
designed-for deferred phase. The `<TextAnimator>` props are the contract; whether
expansion happens in JS (A) or the renderer (B) is an implementation detail the
author never sees.

## What already exists (the floor)

- **Per-glyph layout, exposed to JS.** `FontContext::layout` / `glyph_layout_with`
  (`typography-rs/src/lib.rs:180,322`) → wasm `glyphLayout`
  (`wasm/src/lib.rs:255`) → TS `glyphLayout()` returning kerning + letter-spacing
  accurate clusters `{start,end,x,advance}` (`components/src/text-metrics.ts:260`).
- **Author-time metrics in BOTH runtimes.** `preloadTextMetrics()` initializes the
  wasm engine (`initSync` in Node, async in browser) and is **registered as an
  engine-warmer** (`text-metrics.ts:350`); `@onda-engine/render`'s `renderToFile` awaits
  `runEngineWarmers()` **before** the synchronous `renderFramesJSON`, so glyph
  positions are real during the CLI bake — not estimates. `measureText`/`glyphLayout`/
  `fontMetrics` are **synchronous** once warm (safe inside reconciliation loops).
- **A `KineticText` component** (`components/src/components/KineticText.tsx`) — one
  line, per-glyph entrance presets (rise/fade/scale/blur/wave), house spring +
  stagger, absolute placement so the line never reflows. This is the seed to
  generalize, not replace.
- **Per-node animatable channels** already carry the motion: `transform` (x/y/scale/
  rotate/origin), `opacity`, `color`, and `blur` (RTT) — all per-node, so a
  per-glyph node animates freely.

So the rendering substrate is done. K3 is about **correctness, generality, and the
font gap** — not new pixels.

## Gap inventory — what K3 actually is

Status ✅/🟡/❌ · Effort S/M/L · "Engine" = Rust/wasm work; "Author" = TS only.

### G1 — Kerning bug in `KineticText` · 🟡 · S · Author
KineticText sums **isolated per-glyph** widths (`measureText(ch)` in the loop,
`KineticText.tsx:101`) — its own comment (`:93–94`) claims "kerning between
neighbours is honored," but isolated-sum does **not** honor kern pairs. The fix
already exists: call `glyphLayout(text, …)` **once** (kerning-accurate cluster x +
advance) and place glyphs at those x. Correctness fix + foundation for G2.

### G2 — General selector × animator system · ❌ · M · Author — **the meat**
KineticText is 5 fixed presets. Build the AE model: **range selectors**
(`{start, end, offset, shape}` where shape ∈ ramp/triangle/square/smooth → a 0..1
amount per unit) × **stackable animators** (deltas on any channel: `y`, `x`,
`scale`, `rotate`, `opacity`, `color`, `blur`, `originX/Y`). Per-unit per-frame:
`value = base + Σ animator·amount(unitIndex, selector, frame)`. KineticText's presets
become thin wrappers over this. (Public API in §API.)

### G3 — Word + line units · 🟡 · S–M · Author
Glyph mode works. **Word** = group clusters by whitespace using `glyphLayout`'s
byte ranges against the source string. **Line** = split `content` on `\n` and stack
by line height — *no engine change needed because there is no auto-wrap today*
(`rasterize_with`/`layout` set `set_size(None,None)`, so the only break is explicit
`\n`, derivable in JS). Per-line baseline/centering from `fontMetrics()` (already
exposed). If auto-wrap is ever added, line derivation moves into §G6.

### G4 — Custom-font author-time ↔ render parity · ✅ DONE · M · **Engine — the one true gap (closed)**
`measureText`/`glyphLayout` measure with the **bundled** font only — the wasm
`OndaEngine` has **no `loadFont`** (it holds a default `FontContext`,
`wasm/src/lib.rs`). So a composition using a custom font gets author-time glyph
positions from the *wrong* font while the Rust renderer draws the *right* one →
**the kinetic line is misaligned for any non-bundled font.** Fatal for kerning-
critical display type. Fix, three parts:
1. **wasm binding** `OndaEngine.loadFont(bytes: &[u8]) -> Vec<String>` →
   `FontContext::load_font` (the Rust method **already exists**,
   `typography-rs/src/lib.rs:133`).
2. **TS** `loadFont(bytes)` in `text-metrics.ts` that registers the font in the
   measurement engine, and a single source-of-truth so the **same bytes** reach the
   CLI renderer (so author-time and render agree by construction).
3. **Regenerate the stale wasm `.d.ts`** — `fontMetrics`/`glyphLayout` exist in the
   Rust source but are missing from the generated types in `packages/wasm/pkg`.
Ship with a **parity test**: `glyphLayout(custom)` x-positions in JS must match the
renderer's drawn glyph x within tolerance.

✅ **Shipped (2026-06).** `OndaEngine::loadFont` added in `packages/wasm/src/lib.rs`
(loads into BOTH `self.renderer` and the measurement `FontContext`, mirroring
`VelloEngine::load_font`); wasm rebuilt — which also surfaced `glyphLayout` /
`fontMetrics`, **previously absent from the committed `pkg/`**, so Phase 1's kerning
only began working at runtime after this rebuild. TS `loadFont(data): Promise<string[]>`
in `text-metrics.ts` (+ exported from `@onda-engine/components`). Verified end-to-end on the
production Node warming path: a non-bundled serif (Spectral) measured **549.9 px →
535.9 px** for the same string *after* `loadFont` (before, it silently fell back to
the bundled default = the bug). vitest can't warm wasm (`import.meta.resolve`
unsupported under its SSR transform), so the committed test locks the graceful
contract; the real before/after is the Node proof.

✅ **Single-source pipeline (2026-06).** Declaring a font once now reaches BOTH
measure and render automatically — no manual `--font`. `loadFont` retains the bytes
in a registry in `@onda-engine/react` (`fonts.ts`: `registerFont`/`registeredFonts`/
`clearRegisteredFonts`, the same shared-hub pattern as the engine-warmers, FNV-1a
deduped); `@onda-engine/render`'s `renderToFile` **and** `renderStillToFile` drain the
registry after rendering, write the bytes to the temp dir, and append `--font` to
the `onda` CLI invocation (both subcommands already accept it). So the iteration-loop
still render and the full export both draw with the same bytes the author-time
glyph placement measured. Note: registry is module-global (per-process); multi-comp
servers call `clearRegisteredFonts()` between comps. Browser-preview Player font
loading (drain the registry into `VelloEngine.load_font`) is the one remaining
consumer — a small follow-up.

### G5 — Text-on-path · ❌ · M · Engine + Author
New capability. Cleanest as a typography function that resamples glyph pen positions
onto a `kurbo` path (arc-length param) and returns per-glyph `{x, y, angle}` →
wasm `layoutOnPath` → a `<TextOnPath>` component placing per-glyph nodes with
rotation. (Composable in JS if we instead expose a path arclength+tangent sampler;
prefer Rust where kurbo already lives.)

### G6 — Per-line metrics exposure · 🟡 · S · Engine (cleanup, deferred)
Typography computes `run.line_y`/`line_top`/`line_height` internally but `layout()`
flattens lines. Expose `layoutLines()` → per-line `{baseline, top, height, glyphs}`
for robust multi-line + future auto-wrap. **Not required for v1** (G3 derives lines
from `\n`); listed as the clean foundation.

### Deferred — the scene-native + richer-type path
- **D1 — Scene-native `TextAnimator` node (Approach B)** · L · Engine. Renderer
  expands glyphs + applies per-glyph transform/opacity/color (drop Vello's
  `(font_key,size,color)` batch-grouping for animated runs at `vello-rs:2161`;
  per-glyph rasterize on the CPU path at `renderer-rs:1055`). Compact JSON, no
  author-time-font coupling. Same "optimize behind the seam" move as RTT GPU.
- **D2 — Variable fonts** (`wght`/`wdth`/`opsz`, animatable) · M · Engine.
  cosmic-text/swash support it; charter defers (`typography-rs:17`).
- **D3 — Color/emoji glyphs** · M · Engine. Coverage-only today
  (`typography-rs:549–553`); orthogonal to animation but a typography ceiling.

## Authoring API (the v1 contract — stable across A→B)

```tsx
// @onda-engine/components
<TextAnimator
  text="Make it move"
  units="glyph"            // 'glyph' | 'word' | 'line'
  fontSize={96} fontFamily={theme.fontFamily} fontWeight={600} color={theme.text}
  align="center"
  selector={range({       // which units, and how much each is affected (0..1)
    start: 0, end: 1,      // fraction of the unit range (animatable → a "wipe")
    offset: 0,
    shape: 'smooth',       // ramp | triangle | square | smooth
    stagger: 5,            // frames between consecutive units (sugar over offset)
  })}
  animate={{               // deltas applied at amount=1, eased to base at amount=0
    y: [24, 0], opacity: [0, 1], scale: [0.6, 1], rotate: [-6, 0], blur: [12, 0],
  }}
  durationInFrames={DURATION.base}
/>

// Presets stay, reimplemented over the above:
<KineticText text="kinetic" preset="rise" />   // ← rise = {y:[24,0], opacity:[0,1]}
```

Lowering (A): `glyphLayout(text)` → units → per-frame `amount(i)` from the selector
→ per-unit `<Group>`/`<Text>` at the unit's resting x with animated transform/
opacity/color/blur. Spaces advance, emit no node. Deterministic (pure fn of frame).

## Determinism & tests

- v1 rides existing nodes ⇒ the **render** is already deterministic; lock the **TS
  expansion** with snapshot tests of emitted scene JSON per frame
  (`@onda-engine/components`), for glyph/word/line and a couple of selector shapes.
- A CLI **visual golden** for one kinetic title (`onda render` → PNG), bundled font,
  matching the `renderer-rs/tests/golden.rs` text-fixture pattern.
- **G4 parity test** (the important one): assert author-time `glyphLayout(customFont)`
  x-positions equal the renderer's drawn glyph x within tolerance — this is what
  guarantees A doesn't drift from the render.

## Showcase / docs deliverables (per the standing rule — bake in at ship time)

When G1–G3 land (`TextAnimator` + corrected `KineticText`) and again when G5
(`TextOnPath`) lands, update — none of these are GPU-only **except the `blur`
preset/animator** (RTT — judge on native; before/after via exported frames):

- `apps/site` **components gallery** (`components.astro` / EffectsGallery): add
  `TextAnimator` + `TextOnPath`, upgrade `KineticText`, with **live config**.
- `apps/site` **docs**: a short kinetic-type guide (selector × animator model);
  cross-link from `composing.md`.
- **Studio agent contract**: regenerate `/api/components.json` + `/llms.txt` so the
  agent discovers the new components, props, and selector vocabulary.
- Follow `onda-keep-showcase-pages-updated`: live Split is fine here; the `blur`
  preset's before/after must be **exported images**, not a live preview.

## Phased plan (shippable vertical slices)

- **Phase 1 — correctness + the API** *(Author, M)* — ✅ **DONE** (2026-06; `@onda-engine/
  components` build + 94 tests green). G1 (KineticText now uses `glyphLayout` for
  kerning-accurate x), G2 (`<TextAnimator>` selector×animator: units glyph/word/line,
  direction forward/backward/center/edges, channels opacity/x/y/scale/rotate/blur/
  color, multi-line), G3 (word/line). KineticText reimplemented as a thin facade over
  `<TextAnimator>` (rise/fade/scale/blur = preset channel maps, proven byte-identical
  by test; `wave` keeps its own procedural path). 13 new tests. **Ships kinetic
  typography for the bundled fonts end-to-end.** ⛔ REMAINING: catalog/showcase
  registration (manifest/gallery/component-props → /api/components.json + /llms.txt)
  is CODEGEN-gated — the generator isn't in-repo, so TextAnimator is usable but
  unregistered in the Studio contract until the codegen runs. Optional: a CLI visual
  golden for a kinetic title.
- **Phase 2 — custom-font parity** *(Engine, M)* — ✅ **DONE** (2026-06). G4: wasm
  `OndaEngine::loadFont` (into renderer + measurement context), TS `loadFont` exported,
  wasm rebuilt (also restored `glyphLayout`/`fontMetrics` to `pkg/`). Verified
  before/after on the Node path (Spectral: 549.9→535.9 px). **Unblocks kinetic type
  with any font.** ✅ Single-source DX done: `loadFont` once → `@onda-engine/react` registry
  → `@onda-engine/render` auto-passes `--font` (still + export). Remaining: Player preview
  font load.
- **Phase 3 — text-on-path** *(Engine+Author, M)*. G5: `layoutOnPath` + `<TextOnPath>`.
- **Phase 4 — scene-native `TextAnimator`** *(Engine, L, deferred)*. D1: renderer-side
  expansion behind the same API; compaction + perf + drops the font-coupling. Then
  D2 (variable fonts) / D3 (color glyphs) as independent typography lifts.

After Phase 2, K3 clears "AE-class kinetic typography" for our domain; Phases 3–4
are reach + optimization.

## Risks → mitigations

- *Author-time font ≠ render font (G4).* → Phase 2 is exactly this; until it lands,
  **gate `TextAnimator` to bundled families** (or warn) so nothing ships misaligned.
- *Fat JSON / per-glyph-blur cost (Approach A).* → Acceptable for export; the
  per-glyph `blur` preset is the only RTT-heavy path — document it; D1 removes the
  cost later behind the same API.
- *Ligatures/complex scripts under char-split.* → Place by **cluster** (use
  `glyphLayout` byte ranges to slice the source string), not naive `split('')`;
  full correctness is a D1/glyph-id concern, fine for Latin display type in v1.
- *Multi-line before auto-wrap exists.* → v1 lines = explicit `\n` only (matches the
  engine's no-wrap reality); G6 is the foundation if/when wrap lands.

## First step (smallest end-to-end slice)

Fix **G1** in isolation: switch `KineticText` from the per-char `measureText` loop
to a single `glyphLayout(text, …)` call for kerning-accurate resting x. It's a
~10-line change, makes the component's own comment true, needs no engine work, and
the snapshot/golden it ships becomes the harness the rest of K3 builds on.
