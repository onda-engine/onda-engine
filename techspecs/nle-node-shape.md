# Real-footage NLE — node shape (v1 design, for sign-off)

> Status: **v1 core IMPLEMENTED** (commit `f32a502`, branch `feat/engine-revolution`) —
> all six open questions (§6) went with the recommended defaults. Implements the
> "video editing for sure" scope from [`engine-revolution-roadmap.md`]. Built
> additive-only: `Video` frozen, templates unaffected, golden suite green, host
> (default + `video`) and wasm32 compile, fmt + clippy clean.
>
> **Done:** `Clip`/`Timeline` types + `NodeKind::Timeline` + `Node::timeline` +
> `onda_scene::resolve_timeline` (+ 3 tests); `Timeline` arms in
> renderer/vello/layout; `resolve_timeline` wired before decode in the CLI
> per-frame export path and the single `render-frame` path.
> **Follow-ups:** wasm-preview wiring (so clips show in-browser), a golden
> fixture clip, cross-clip transitions, clip audio, the `movie_scenes` path, and
> the Studio exposure path (payload → component → manifest → MCP → planner).

## 1. The gap

The `Video` node is *one decoded frame at one source `time`* (`scene-rs`: `Video { src, time, width, height, fit }`). There is no notion of a clip with an in/out, a lane of clips, trimming, or retiming — Studio's `CompositionPayload` `tracks` are *component timing*, not footage editing. So real-footage editing (cut, trim, ripple, retime) has no engine representation. This is the largest genuinely-uncovered capability.

## 2. Design principle — resolve as a pre-pass, keep the renderer blind

The engine renders **one frame snapshot at a time**, and decode is already a per-frame pre-pass that turns `Video.time` → decoded pixels. The NLE follows the same shape:

```
scene → [timeline flatten pre-pass @ frame N] → [decode pre-pass] → render
        (Timeline → the active clip's Video)     (Video.time → pixels)   (draws Video)
```

The flatten picks, for composition frame N, the active clip on each lane and emits a plain `Video` with a computed source `time`. **The renderer and decoder never learn about timelines** — they keep drawing/decoding `Video`. This is why it's purely additive: a new node kind + a new pre-pass, nothing existing changes.

The timeline is therefore a **declarative, engine-native primitive** (an OTIO-like serialization the agent and importing devs author by data), resolved deterministically by the engine — not re-baked per frame by the React layer. That matches "the scene graph is the universal language," and the *which-cut* decision stays with the agent (open mechanism, closed judgment).

## 3. The types (`scene-rs`, additive)

```rust
/// A single footage clip on an NLE lane: a source, its placement on the
/// timeline, a source-in trim, and a playback speed. Display box mirrors `Video`.
/// Resolved to a plain `Video` at a frame by the flatten pre-pass.
pub struct Clip {
    pub src: String,
    /// Composition time (seconds) where the clip starts on the timeline.
    pub timeline_in: f32,
    /// Composition time (seconds) where the clip ends on the timeline.
    pub timeline_out: f32,
    /// Seconds into the source to begin from — trims the head (default 0).
    #[serde(default)]
    pub source_in: f32,
    /// Playback rate: 1.0 = realtime, 2.0 = 2× faster, negative = reverse
    /// (v1 nearest-frame; no interpolation). Default 1.0.
    #[serde(default = "Clip::default_speed")]
    pub speed: f32,
    // Display box — identical to Video's contract.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f32>,
    #[serde(default)]
    pub fit: ImageFit,
}

/// An NLE lane: a sequence of `Clip`s sharing one display box, resolved to the
/// active clip's `Video` at each frame (hard cuts in v1). Multiple lanes =
/// multiple Timeline nodes composited by the usual node z-order.
pub struct Timeline {
    pub clips: Vec<Clip>,
}

// NodeKind gains one variant:
//   Timeline(Timeline)
```

## 4. The flatten pre-pass

```rust
// onda_scene — pure, deterministic, shared by the CLI and the wasm preview.
pub fn resolve_timeline(scene: &Scene, frame: u32, fps: f32) -> Scene
```

For each `NodeKind::Timeline` node, at composition time `t = frame / fps`:
1. **Active clip** = the clip with `timeline_in <= t < timeline_out`; on overlap, the *last* such clip wins (a hard cut). No active clip → the lane resolves to an empty (transparent) node.
2. **Source time** = `source_in + (t - timeline_in) * speed` (reverse plays back from the in-point; clamp ≥ 0). Nearest-frame — the decoder already picks the nearest source frame.
3. Replace the `Timeline` node with `Video { src, time: source_time, width, height, fit }`, preserving the node's `id`/`transform`/`opacity`/`effects`. The existing decode pre-pass then handles `Video.time` unchanged.

The flatten touches **one source per lane per frame**, which is exactly what the proxy/scrub-index work (decode wave) wants.

## 5. Why this is template-safe

- New `NodeKind::Timeline` variant + new structs = additive; `scene-rs` deser is tolerant (no `deny_unknown_fields`), so old scenes are unaffected.
- `Video` (and its decode path) is **untouched** — every existing template that uses `Video` renders byte-identically.
- The flatten is a new pre-pass; scenes without `Timeline` nodes pass through unchanged (no-op).
- Golden gate: add `timeline_*` fixtures (a hard cut at a known frame, a trimmed clip, a 2× speed) alongside the implementation; they need a tiny committed fixture clip to decode against.

## 6. Open questions — please sign off

1. **Lanes:** single-lane `Timeline { clips }` + multiple Timeline nodes for multiple lanes (compositing reuses the node z-order) — *recommended, minimal*. Alternative: a multi-lane `Track` structure inside one node. → **OK to go single-lane?**
2. **Transitions:** v1 = **hard cuts only**. Cross-clip dissolve/dip/wipe (overlap window → dual-resolve + RTT blend) is a follow-up. → **OK to defer?**
3. **Retime quality:** v1 = **nearest-frame** speed/reverse. Optical-flow / frame-blended slow-mo is the gated premium tier (roadmap §5). → **OK?**
4. **Placement fields:** `timeline_in` + `timeline_out` (absolute) vs `timeline_in` + `duration`. → **Recommend absolute in/out; OK?**
5. **Clip audio:** v1 = **video-only**; a clip's source audio (extracted with the same `source_in`/`speed` into an `Audio` track) is a follow-up. → **OK?**
6. **Resolver home:** `onda_scene::resolve_timeline` (pure, shared by CLI + wasm), called before decode. → **OK?**

## 7. Out of scope for v1 (named so nothing is silently dropped)

Cross-clip transitions; multi-clip ripple/roll edit *operations* (those are agent/Studio editing ops over the data, not engine primitives); optical-flow retime; per-clip color grade (that's the separate CDL node, composes on top); clip audio; gap/filler nodes (a gap is just absence of an active clip). Editorial *decisions* (which cut, how long) stay in the Studio agent — the engine only resolves the data it's handed.
