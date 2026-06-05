# Render-to-Texture (RTT) — engine design

> The keystone primitive. One subsystem unlocks content/text blur, frosted-glass
> backdrop blur, glow/bloom, gooey morph, luma/alpha mattes (media-through-type),
> and — later — AE-style flat 3D layers. It is **orchestration on top of the
> renderers we already have** (`vello` + `wgpu` on GPU, `tiny-skia` on CPU), not a
> new renderer.

## Core idea

RTT is a **scene-graph property, not a new node kind**. Add an ordered effect
chain to every node:

```rust
// packages/scene-rs/src/lib.rs
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "snake_case")]
pub enum Effect {
    /// Screen-space Gaussian blur; `sigma` = std-dev in OUTPUT px (CSS `blur()`).
    Blur { sigma: f32 },
    // Phase 2+: BackdropBlur { sigma }, Bloom { threshold, intensity, sigma },
    //           Goo { sigma, threshold }, Matte { .. } — additive variants.
}

// on Node, after `pub blend: BlendMode,`
#[serde(default, skip_serializing_if = "Vec::is_empty")]
pub effects: Vec<Effect>,
```

`skip_serializing_if = "Vec::is_empty"` is the decisive detail: **every existing
scene JSON and every committed golden serializes and renders byte-identically** —
the data change alone is a zero-diff, the harness stays green. `Vec<Effect>` (not
a scalar `blur: Option<f32>`) is chosen because the roadmap stacks
blur→bloom→matte and needs explicit **order** (sharp → blur → bloom); a scalar
would force a breaking migration at Phase 2.

When a node carries effects, **both** backends do the same move they already do
one level down (a shape rasterizes to a temp pixmap then composites back; a `clip`
wraps a subtree via push_layer/pop_layer):

1. Render the node + subtree to its own offscreen surface **in local space**
   (transform/opacity NOT yet applied), sized to the subtree bounds + `3σ` margin.
2. Run the effect chain on that surface.
3. Composite the result back at the node's `affine` / `opacity` / `blend` / `clip`.

## GPU path (`packages/vello-rs/src/lib.rs`)

- Refactor the texture half of `render_to_target` (lines ~141–172) into
  `render_vscene_to_texture(&self, vscene, w, h) -> wgpu::Texture` so the frame
  path and the per-subtree path share it.
- In `build()` (line ~177), after computing `affine`/`opacity` and **before** the
  blend/clip push_layers, branch on `!node.effects.is_empty()`: build a fresh
  `VelloScene` for the subtree in local space → `render_vscene_to_texture` →
  effect pass → readback to a `peniko::Blob` → draw via the **existing**
  `draw_image_data` path at `affine`/`opacity` → `return`.
- Blur = a separable 2-pass `wgpu` compute pipeline in a new
  `packages/vello-rs/src/effects.rs`, built lazily and cached on `VelloRenderer`.
  **Ping-pong** (read source as `texture_2d`, write a separate `storage` texture —
  never `read_write`, which Dawn rejects), 8×8 workgroup (under WebGPU's 256
  floor). This is plain wgpu 22 — runs identically on native Metal/Vulkan and
  Dawn/WebGPU, the same constraint Vello already meets. Mirrors the existing
  Dawn-portability note around stroke expansion (lines ~238–244).
- **We never inject into Vello's pass** — the compute runs as its own command
  encoder + submit, bracketed cleanly between two independent Vello renders.

## CPU path (`packages/renderer-rs/src/lib.rs`) + determinism

CPU does **real** blur, not a shadow-style skip — because the golden harness
renders the **CPU backend only**, and content/text blur is roadmap-#1 export
fidelity. If CPU skipped it, no golden could ever lock the blur contract.

- In `render_node` (line ~272), branch on `!node.effects.is_empty()`: capture the
  subtree into a temp `Framebuffer` in local space, run `blur_framebuffer(&mut fb,
  sigma)`, composite back at transform/opacity with the same straight-alpha
  src-over loop shapes already use (lines ~609–625).
- **Determinism**: weights computed in f32 once from `sigma` (radius `ceil(3σ)`),
  quantized to **integer** weights summing to a fixed total (`1<<16`); accumulate
  premultiplied channels in `u32` with clamp-to-edge borders → byte-identical
  across architectures (no platform-varying float reduction). A
  `blur_is_deterministic` unit test asserts two independent renders are byte-equal.
- GPU and CPU need **not** pixel-match (rotation/clip/blend already differ between
  them); target is **visual** parity, the golden locks CPU, the 0.5% tolerance
  absorbs sub-perceptual drift.

## React API (`packages/react`)

```ts
// NodeProps
effects?: Effect[]   // low-level, ordered
blur?: number        // sugar → effects: [{ effect: 'blur', sigma }]
```

`reconciler.ts` `toNode` emits `{ effect: 'blur', sigma }` (matching the serde
tag) alongside the existing `blend`/`clip` extraction. Generic across all node
kinds. **BlurReveal** drops its scale-settle hack and animates `blur` 10→0;
**EndCard**'s CTA reveal regains the soft→sharp blur. Both flip
`degraded`→`first_class` in `fidelity.ts`. No host-config change needed.

## Build vs borrow (OSS-first)

| Piece | Status | Decision |
|---|---|---|
| Offscreen render + composite | `vello` + `wgpu` (in tree) | **Borrow** — the foundation; no new renderer |
| Texture round-trip / readback / `draw_image` | existing vello-rs helpers | **Reuse** |
| Subtree bounds | `kurbo::bounding_box` (in tree) + small union glue | **Borrow** + thin glue |
| CPU blur kernel | `image` blur is f32 (✗ non-deterministic); `tiny-skia` has none | **Evaluate `stackblur-iter`** (integer box-approx, ~gaussian, deterministic) FIRST; hand-roll a fixed-point separable gaussian only if its quality/approx is insufficient. Determinism — not NIH — is what forces the small kernel. |
| GPU compute blur (wgsl) | no clean drop-in crate for "blur a wgpu texture" | **Hand-roll** a ~30-line separable gaussian `.wgsl` (standard, small, justified) |
| Path morph (separate track) | `flubber` is JS; Rust path-morph crate unconfirmed | **Verify crates.io**; likely port flubber's point-correspondence algorithm on top of `kurbo` |

The rule holds: we borrow the renderer, the geometry, and (pending evaluation) the
CPU blur; the only certain hand-roll is the GPU wgsl kernel, where no good crate
exists. Every hand-roll is justified by determinism or absence-of-crate, not taste.

## Phased plan

Each phase is a shippable vertical slice.

- **Phase 0 — data model + serde + no-op plumbing** *(easy)*. `Effect` enum +
  `Node.effects` (init, builder, skip-if-empty) in scene-rs; mirror in
  react/scene.ts; `blur`/`effects` props + `toNode` wiring. Both backends ignore a
  non-empty list (early no-op). Serde round-trip + TS→JSON snapshot tests. **Proves
  the contract is backward-compatible (zero golden diff)** and de-risks everything
  after.
- **Phase 1 — MVP: real content/text blur, both backends** *(hard)*. CPU
  capture+integer-gaussian+composite; GPU `render_vscene_to_texture` +
  `effects.rs` + readback→draw. New `blur_text`/`blur_shape`/`blur_nested`
  goldens + `blur_is_deterministic`. Rewrite **BlurReveal** + **EndCard** → first
  class. **Proves the keystone seam end-to-end** — unblocks the whole roadmap.
- **Phase 2 — backdrop blur / frosted glass** *(medium)*. `BackdropBlur { sigma }`
  samples what's behind the node (snapshot target region → blur → composite under +
  optional tint). Reuses Phase 1 kernels verbatim.
- **Phase 3 — bloom/glow + gooey morph** *(medium)*. `Bloom { threshold, intensity,
  sigma }` = bright-pass → large-σ blur → additive over the sharp subtree. **Gooey
  morph** (`Goo { sigma, threshold }`) is the *same machinery* — blur → alpha
  **threshold** so overlapping shapes fuse into smooth necks (metaball merge). Both
  prove the ordered `Vec<Effect>` composes.
- **Phase 4 — luma/alpha mattes (media-through-type)** *(hard)*. Capture a matte
  subtree to a texture; use its luma/alpha to mask the node's content (footage
  through type). The #1 pro move.
- **Phase 5 — AE-style flat 3D layers** *(deferred)*. The same capture-to-texture
  seam feeds a future wgpu 3D pass placing layer textures as planes under a shared
  perspective camera. Listed only to confirm the seam was designed for it.

## Morphing (folds onto this design)

"Morphing" is three techniques in two places:

1. **Gooey / liquid / metaball morph** — blur + alpha-threshold. **Rides this RTT
   seam** as a Phase-3 sibling of Bloom (`Goo` effect). Free downstream.
2. **Shape / path morph** (icon→icon, SF-Symbols "magic morph") — **NOT RTT**. A
   separate geometry track: path interpolation with point correspondence on
   `kurbo`. Build-vs-borrow: verify a Rust crate, else port `flubber`. Own spec.
3. **Number / text morph** — glyph-outline interpolation; later, after path morph.

## Risks (→ mitigations)

- *Vello exposes no custom compute pass.* → Don't inject into Vello; run the blur
  as a separate encoder+submit bracketed around two independent Vello renders.
- *Readback→Blob→draw round-trip per blurred subtree is costly.* → Acceptable for
  headless export (no realtime need); size sub-textures to bounds+3σ; add a
  `(node-id,w,h)` texture pool only if profiling shows thrash.
- *Rgba8Unorm read-write storage not portable on Dawn.* → ping-pong (sampled read +
  storage write), never read_write.
- *CPU↔GPU divergence erodes trust.* → shared σ→radius formula + clamp-to-edge;
  visual parity target; golden locks CPU; eyeball/compare test bounds GPU vs CPU.
- *Subtree-bounds missing today.* → small recursive bounds-walk (generalize the
  shape bounds over a subtree, union transformed child bounds); fall back to
  composition size; ship behind tests in Phase 0.
- *Opacity/blur ordering ambiguity.* → render subtree at FULL opacity into the
  texture, blur, THEN apply node opacity/blend at composite-back (CSS semantics).

## Open decisions (need a founder call before minting goldens)

1. **σ units**: OUTPUT px (CSS-like, scales with the node) — *proposed* — vs
   resolution-independent local px.
2. **σ→radius cutoff**: `3σ` *(proposed)* vs 2.5σ/3.5σ — sets kernel size, cost,
   and the exact golden pixels. One-time call before goldens.
3. **GPU↔CPU parity**: visual-only *(proposed)* vs a documented max-diff threshold
   enforced in CI.
4. **Bounds policy**: auto-compute subtree bounds+3σ *(proposed)* vs require an
   explicit blur box.
5. **Backdrop scope (Phase 2)**: siblings-drawn-earlier only vs full canvas behind.
6. **Image double-blur**: `Image` already has a decode-time `blur` — stack a
   node-level `Blur` on top, or forbid the combo?

## First step (smallest end-to-end slice)

Render ONE blurred text subtree on the **CPU** backend, locked by a golden (CPU is
the deterministic target, so it's the fastest provable slice):

1. scene-rs: `Effect` enum + `Node.effects` + init + `with_effect` + serde test.
2. renderer-rs: `blur_framebuffer(&mut Framebuffer, sigma)` (integer separable
   gaussian, clamp-to-edge) + subtree-bounds helper; branch in `render_node`.
3. renderer-rs/tests/golden.rs: add a `blur_text` fixture
   (`Node::text("Onda").with_effect(Effect::Blur { sigma: 6.0 })`), mint with
   `ONDA_UPDATE_GOLDEN=1`, add `blur_is_deterministic`.
4. Confirm the 10 existing goldens are untouched (skip-if-empty → byte-identical).

Only after this CPU slice lands do the GPU compute pass (`effects.rs`) and the
React/BlurReveal rewrite follow. The CPU slice alone proves the model, the
determinism strategy, and the harness contract.
