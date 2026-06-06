# Cinematic finish — implementation spec (the lib-ready quality ceiling)

The last real quality gap for "lib READY": make composited media + materials finish
in LINEAR light with a film output transform, so cinematic comps read "looks shot,"
not gamma-flat. Builds on the Phase-1 GPU-resident `override_image` seam (which re-
enters Vello as Rgba8 — so linear lives strictly between Vello's 8-bit output and the
override). Reuses `techspecs/gpu-resident-finishing.md` (the seam) + `cinematic-layer-
plan.md` (the gaps). OFF by default → existing comps + goldens byte-identical.

## The gate (opt-in, per composition)

Add `linear: bool` to `scene-rs` `Composition` (`#[serde(default)]` → old JSON +
goldens unchanged; bool keeps `Copy`). Update `Composition::new` (keep the 4-arg
signature; default `linear:false`) + add `with_linear(bool)`; fix any struct literals
(grep `Composition {`). `@onda/react`: an optional `linear` prop on `<Composition>` →
emit it only when true. When false the renderer takes today's exact path.

## The linear chain (in `build_effect_texture`, flag ON)

Vello renders the subtree → `Rgba8` `t0` (the 8-bit ingest quantization floor — Vello
can't output float; accepted). Then:
1. **Linearize** pass: `t0` sRGB → `Rgba16Float` `t_lin` (linear). New WGSL using the
   exact sRGB transfer (mirror `core-rs/src/color.rs` `srgb_to_linear`).
2. **Effect passes in linear**: run blur/bloom/grade/goo on `Rgba16Float`. Parameterize
   `effects.rs` — `storage_texture_entry(binding, format)` + the per-pass `create_texture`
   format become `Rgba16Float` in linear mode (write-only storage = portable tier-2; the
   code already never uses `read_write`). **Drop the two Bloom `1.0` clamps** → real
   >1.0 highlights bloom (bright accents scaled by `intensity` exceed 1 and bleed).
3. **ACES tone-map** pass: `Rgba16Float` linear → `Rgba8` sRGB `t_out` (ACES/Hill or
   Narkowicz approx + linear→sRGB encode). The LAST pass — Rgba8 for `override_image`.
4. `override_image(placeholder, t_out)` — the Phase-1 seam, unchanged.

CPU mirror (`renderer-rs`): mirror the linearize → effects-in-f32 → tone-map so the
golden harness stays in lockstep. Add a SEPARATE linear golden set (never the default).

## Then, in order (each: SOLENNE re-render before/after + linear goldens)

1. **Linear keystone** (above) — the foundation; the SOLENNE bloom on the sun-flare
   goes from flat-overlay to real light bleed (the headline before/after).
2. **Light-wrap** — the #1 "integrated vs pasted" tell. New `Effect::LightWrap` + an
   `effects.rs` pass: reuse `build_backdrop_texture` (the bg behind the node) +
   `GaussianBlur`; rim mask = blurred-fg-alpha − fg-core; additive composite (the
   blurred bg colors) over the fg edge band, in linear. `lightWrap` NodeProps sugar.
3. **Halation** — film's red/orange highlight bleed. A Bloom variant: higher threshold,
   tint the halo warm (R/O), add back in linear. A small `halation` field.
4. (Deferred, optional) **Depth-of-field / content-blur** (the RTT gap) — for cinematic
   focus on a depth-separated plate; bigger, can follow.

## Verification (every step)

- Flag OFF: `renderer-rs/tests/golden --features png` BYTE-IDENTICAL (default path
  untouched — the linear branch is gated).
- Flag ON: re-render `cinema-plate.comp.mjs` (add `linear` to it) → the gamma→linear
  bloom/light **before/after** is the proof; a dedicated linear golden set locks it.
- Both backends (native export now; web later via Studio) + the CPU mirror move
  identically or goldens flag drift.

## Risks (from the audit)

- `Rgba16Float` storage portability (Dawn/wasm32) — feature-detect; fall back to the
  gamma path if unsupported (the flag already makes gamma the default).
- The tone-map shifts the look of any comp that opts in — it's opt-in + versioned, so
  the FBM hero + existing comps are untouched.
- Subtle effects (light-wrap, halation) tuned from the EXPORTED mp4, not live preview.
- 8-bit-in-linear bands in shadows → the `Rgba16Float` intermediate is non-negotiable.

## Scope note

Web/live present (gpu-resident Phases 3–4) is DEFERRED to Studio — the agent renders
via export, so the lib doesn't need it to be "ready." This spec + Phase 2 (native
backdrop/matte/fbm GPU-resident, optional cleanup) complete the lib.
