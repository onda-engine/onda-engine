# GPU-resident finishing — phased plan (interactive-first)

Make ONDA's finishing chain GPU-resident + (opt-in) linear + present-not-readback,
so longer/premium comps render fast and Studio can edit them live. Grounded in a
render-flow audit + Vello 0.3 API verification (2026-06-05).

## The problem (verified)

The finishing chain is NOT GPU-resident. Native path, per stacked effect node:
`render_vscene_to_texture` → effects.rs compute passes (these DO chain GPU→GPU within
one node) → **`read_back` (sync map+poll(Wait), lib.rs:1127)** → `draw_effect_image`
re-wraps the CPU pixels as a `peniko::Image` and re-uploads → plus a **final**
full-frame readback (lib.rs:155). Same inline-readback pattern for backdrop-blur,
matte, and the Fbm fill. Web path can't map sync, so it front-loads **three async
readback pre-passes** (prepare_effect/backdrop/matte_images) → composite → final
readback → `putImageData` (the live FLICKER). A grade+bloom+grain+vignette comp ≈
**~N per-effect readbacks + 1 final = the bulk of the ~170ms/frame**.

**Swapchain present alone is NOT enough** — it removes only the final readback +
flicker (web); the per-effect readbacks (the bulk) remain. GPU-resident compositing
is the load-bearing change; present is its web-only companion.

## The keystone mechanism (Vello 0.3 — verified, no fork needed)

`Renderer::override_image(&peniko::Image, Some(ImageCopyTextureBase<Arc<Texture>>))`
(vello lib.rs:528): inserts into `engine.image_overrides` keyed by the image's Blob
`.id()` — wherever that image would draw, Vello **GPU→GPU copies the given texture
into its atlas instead (zero readback)**. Plus `render_to_texture` (414, already
used) and `render_to_surface` (448, present) + `RendererOptions.surface_format`.
**Hard limit:** Vello renders ONLY to `Rgba8Unorm` — so the linear `Rgba16Float`
working space must live DOWNSTREAM of Vello in ONDA's chain, and any linear result
must be tone-mapped back to Rgba8 BEFORE re-entering Vello via override_image.

## Target architecture

One GPU-resident finishing graph, both backends, differing only at the terminal:
Vello renders base + each effect subtree to caller-owned textures → effects.rs
compute passes ping-pong between pool textures (no readback, no peniko re-wrap) →
where Vello must draw on top of an effect result, the GPU texture re-enters via
`override_image` (placeholder peniko::Image for a stable Blob id) → **terminal:**
native export = ONE final readback to the encoder; web live = `render_to_surface` +
`frame.present()` (zero readback, no flicker). Linear is built into the chain,
gated by a per-composition opt-in flag (OFF = bit-identical to today → goldens
unchanged). CPU reference + goldens are a separate path, untouched.

## Phases (each independently verifiable, no big-bang)

1. **Native GPU-resident effect threading** — replace `read_back`+`draw_effect_image`
   in `render_effects_subtree` (lib.rs:1117) with the `override_image` seam; add a
   `(w,h)` texture pool for ping-pong reuse. Verify: goldens byte-identical +
   before/after warm benchmark (per-effect readbacks gone, 1 final remains). **Ships
   faster `onda export` with zero behavior change — start here.**
2. **Extend the seam to backdrop / matte / fbm** (native) → exactly 1 readback/frame.
3. **Web present path** — `render_to_surface` + present (kill final readback + flicker).
4. **Web GPU-resident effects** — drop the 3 async pre-passes; reuse the Phase-1 seam
   (override_image is valid on WebGPU). Web → 0 readbacks.
5. **Linear + ACES tone-map (opt-in flag)** — Rgba16Float working textures (write-only
   storage = portable tier-2), sRGB→linear after Vello, ACES tone-map as the final
   pass back to Rgba8. Built INTO the chain, not retrofitted. OFF = goldens unchanged.

## Phase 1 steps

1. Add a `(w,h)`-keyed texture pool on `VelloRenderer`/`Ctx` (ping-pong reuse;
   effects.rs currently mints a fresh `Rgba8Unorm` per `run()`). Bound VRAM (evict/cap).
2. In `render_effects_subtree` (native): keep `build_effect_texture`'s final GPU
   texture; mint a placeholder `Rgba8` `peniko::Image` (dummy Blob, right w×h, stable
   unique `.id()` per effect node per frame); `draw_image` it at the same
   `affine*translate(x0,y0)`/opacity; `override_image(&placeholder, Some(texture))`.
3. Confirm the texture is `Rgba8Unorm` + has `COPY_SRC` (already set, lib.rs:597).
4. Leave `build_effect_texture`/effects.rs internals as-is (already GPU-resident).
5. Golden harness (`renderer-rs/tests/golden --features png`) must be byte-identical
   (override_image = GPU copy of the same pixels read_back would produce).
6. Warm before/after benchmark via cli-rs on a grade+bloom+grain+vignette 1080p frame.

## Risks / care

- **Blob-id lifecycle:** override map keys on the placeholder `.id()`; each effect
  node per frame needs a stable, unique id, and overrides must be cleared/rebound per
  frame or a stale node↔texture mapping draws the wrong texture. Bound the map.
- **Rgba8-only re-entry:** linear (Rgba16Float) results must be tone-mapped to Rgba8
  BEFORE override_image (Phase 5 orders the tone-map last for exactly this).
- **Vello can't output float** — linear lives strictly downstream; the sRGB→linear
  convert sits at Vello's 8-bit output seam (8-bit quantization there is the floor
  unless Vello is patched).
- **Golden byte-equality** must be confirmed EARLY; if Vello's atlas/AA shifts a
  sub-pixel at the composite seam, gate + reconcile before claiming "no change".
- `render_to_surface` always inserts an Rgba8 blit + needs `surface_format` set at
  `Renderer::new` → web vs native is a constructor-time branch.
- VRAM: pooled effect sub-textures vary per node (bounds+3σ) — cap/evict.

## Cheap wins (isolated, now)

- Export bitrate (DONE: VideoToolbox `-q:v 55→68`).
- Texture pool as a standalone first change (pre-override) — avoids per-pass alloc.
- Reuse placeholder Blob ids across frames (stable override key, less churn).
- Web: skip the matte/backdrop pre-pass walks when `has_*` is false.
- Degrade-on-scrub: skip the finishing chain while scrubbing, full finish on settle.
- Smaller fbm/effect field for live preview vs export.
