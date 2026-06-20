# ONDA Engine — The Revolution Roadmap: Motion Graphics + Video Editing in Service of the Studio Moat

> Status: strategy of record. Supersedes the lost `techspecs/engine-power-vs-ae.md`,
> `cinematic-layer-plan.md`, `library-north-star.md`, and the keystone/build-order
> notes (verified absent from the repo and git history — they were never committed;
> this doc reconstructs the strategy as a *tracked* file so it can't vanish again).
> Synthesized from a 14-agent workflow (mograph-maximalist, video-editing-NLE,
> ai-media-compositor, moat-architect lenses), then **corrected on the moat
> philosophy** per the founder: the moat is *irreproducibility under full engine
> disclosure*, not secrecy-by-partitioning.

---

## 0. The moat principle (read this first)

**The test for every capability:** *if a competitor had this AND a full copy of the engine, could they replicate the Studio?*

- If **no** → ship it, openly, in the engine, wherever it makes the Studio's life *easiest*. Hiding reproducible mechanism protects nothing and taxes our own velocity. A richer open engine is also a bigger funnel.
- If **yes** → it's a genuine crown jewel. But everything that passes this test is **not engine code**: it's the eval-tuned agent, the vision-correction **control policy** (the loop that reads metrics, decides what to fix, and converges — `inspect()` is merely its thermometer), the data/taste flywheel (real comps, what worked, embeddings, brand profiles), hosting/billing/distribution/brand, and **iteration velocity**. Every one of those already lives in the Studio product, outside this repo.

**Conclusion: there is essentially nothing in the *engine* worth hiding.** The engine should be fully open and maximally Studio-supporting — including `inspect()`, the component manifest, and the prop-dialect. The moat survives because the irreproducible *system* around the engine was never in the engine to begin with. The earlier "partition the engine into a restricted `studio-kit`" recommendation is **rejected**: it adds friction to Studio development for ~zero real protection (those heuristics are reimplementable in a weekend).

Two things stay Studio-side, and neither is "hidden engine code":

1. **Curated look/asset data** (the "ONDA look" constant stacks, named grades, the curated velato/transition/asset libraries). These live in Studio because they are *curated data/presets* by nature — there's no reason to push them down into a general-purpose engine. Not a secret; an asset.
2. **Editorial-orchestration product decisions** (`transcript→cut-list`, auto-silence-removal, duck-under-VO automation, roto→composite workflow). These belong in the agent layer because "turn timings into an edit" is a *product decision*, not a rendering primitive — a category line, not a secrecy line.

And the bonus moat to lean *into*: "the scene graph is the universal language; the renderer is the platform." If the ONDA scene-graph becomes the standard way to express agent-driven motion, **adoption itself** is a network-effect moat a forker can't copy. That argues for being *more* generous with the engine, not less.

---

## 1. The revolution thesis

ONDA's revolution is not "After Effects in Rust" and not "Remotion without Chromium" — it is the **first deterministic, GPU-native, agent-drivable compositor that fuses motion graphics with a programmatic NLE under one linear-HDR pipeline**. AE and Resolve own real-footage editing and color but are GUI-bound and non-programmatic; Remotion, Motion Canvas, and Revideo are programmatic but Chromium/canvas-bound, gamma-locked, and have no NLE or color science. ONDA wins the open territory between them: a renderer where *cutting real footage, grading it to a brand palette, landing AI-generated plates so they read as shot, and choreographing kinetic type* are all the same scene-graph emitting deterministic, frame-accurate output an agent can drive by number. The engine's job is to be a **genuinely world-class rendering substrate that is inert without taste** — every primitive it ships is value-less until the Studio agent decides *which* numbers, *which* cut, *whether it reads*. That asymmetry — open mechanism, closed judgment — is what makes a more powerful engine *feed* the moat instead of replicating it.

**Critical correction to the starting hypotheses:** the engine is materially further along than "50–65% of AE." Render-to-texture is **fully implemented** on both backends (the backbone of effects, mattes, 3D, backdrop/light-wrap), the 16-effect chain is fully wired, true 3D layers exist (perspective camera + Depth32Float + extrude), shape booleans/trim/repeater ship via `i_overlay`, and the cinematic Finish already does linear+ACES *math*. The real remaining keystones are narrower and sharper: **(K1) 8-bit storage** (everything is `Rgba8Unorm`; HDR dies between passes — verified 29 hardcoded targets in `effects.rs` alone), **(K3) per-glyph as a library-only hack** (N nodes, not an engine atom), **(K4) no velocity-derived per-layer motion blur**, and **the entire NLE/editorial spine** (a `Video` node is one frame at one `time`; trim/rate/speed live only in React and never reach the scene graph; audio `start_at` source-trim is silently dropped on export — verified in `cli-rs/src/main.rs` `collect_audio_tracks`).

---

## 2. The open / studio boundary (corrected)

The discipline is **open the MECHANISM, keep the DECISION** — but "keep the decision" means it lives in the agent/data/policy layer, *not* that we strip mechanism out of the engine. The engine emits numbers and applies the instruction it's handed (a grade, a cut, an EDL, a CoC blur). It never decides *which*.

| Capability | Layer | One-line reasoning |
|---|---|---|
| All rendering primitives: RTT, effect chain, mattes, blend, 3D/extrude, shape ops (trim/bool/repeater) | **engine (open)** | Inert without composition; openness is the funnel |
| Native per-glyph text atom (`glyphs: Vec<GlyphTransform>` on Text node) | **engine (open)** | Layout math; choreography *recipes* are Studio data |
| Generic keyframe-any-property tracks (PropertyTrack in scene graph) | **engine (open)** | Data substrate; ship *neutral* defaults only |
| Velocity-derived per-layer motion blur (`motion_blur: ShutterAngle`) | **engine (open)** | Pure physical correctness; zero taste |
| NLE timeline substrate (Clip/Track/EDL, time-remap, hard cuts) | **engine (open)** | A serialization format; *which* edit = the agent |
| Cross-clip footage transitions; per-clip speed ramps/reverse (nearest-frame) | **engine (open)** | Generic blends/curves; *when/how long* = Studio |
| Native video decode → default + proxy/filmstrip/scrub index | **engine (open)** | Commodity plumbing; shell out to host ffmpeg, don't vendor codecs |
| ASC-CDL grade node; despill / grain-match / light-wrap (separate nodes) | **engine (open)** | Published optics/physics; the *numbers* are the colorist-agent's taste |
| Audio waveform/RMS envelope API + **fix `start_at` source-trim** | **engine (open)** | Commodity DSP + a latent correctness bug |
| Real depth-of-field (CoC bokeh, reuses Depth32Float) | **engine (open)** | Standard rendering primitive |
| Color scopes as JSON (`onda scopes`) | **engine (open)** | Pure measurement, mirrors the already-open `lint` |
| HDR / `Rgba16Float` compositing buffer (K1) | **engine (open, flag-gated)** | Float storage is precision, not taste; flag so 8-bit preview stays cheap |
| Film-emulation finish *primitives* (halation, grain, CA) | **engine (open)** | Open film science; ship neutral no-op defaults, **no named presets** |
| Vello 0.3→0.7 + velato Lottie/icon render path | **engine (open)** | Lottie is open, velato is OSS |
| **`inspect()` quality judge + `validateComposition()`** | **engine (open)** | Reimplementable heuristics; hiding taxes Studio for ~zero protection. The *moat is the control loop that uses it*, which is Studio-side |
| **Components manifest** (roles/occlusion/sceneRole/fidelity metadata) | **engine (open)** | The agent's world-model is more valuable shared (adoption); the agent *intelligence* is the moat, not the schema |
| **Prop-dialect** (PROP_ALIASES / SELF_ANCHORING / adaptProps) | **engine (open)** | Studio-supporting glue; reimplementable; ship where it's most convenient |
| Curated "ONDA look" constant stacks; named grades; curated velato/transition/asset libraries | **studio (data, by nature)** | Curated *assets/presets*, not hidden engine code — no reason to push into a general engine |
| Editorial-orchestration verbs (`auto-edit`/`caption-cut`/`silence-remove`/transcript→cut-list/auto-duck/roto→composite) | **studio (category line)** | "Turn timings into an edit" is a product decision, not a rendering primitive |
| LLM art-direction taste, MCP toolset, vision-correction **control loop**, data/eval flywheel, hosting/billing/tiers, watermark | **studio (the actual moat)** | Irreproducible system; not in this repo — keep it that way |

---

## 3. Two tracks + shared keystones

Leverage and engineCost on 1–5 scales.

### Shared keystones — unlock BOTH tracks

| Bet | Lev | Cost | dependsOn |
|---|---|---|---|
| **Generic keyframe-any-property tracks** (engine evaluates at frame *t*) | 5 | 2 | — |
| **HDR / `Rgba16Float` compositing buffer (K1)** — float through the whole graph, ACES+LUT once at display-out; flag-gated, CPU stays the 8-bit byte-oracle | 5 | 4 | RTT (done) |
| **Vello 0.3→0.7 + wgpu upgrade** — lifts blend-depth cap, fixes WebGPU stroked-border artifact, unblocks velato | 3 | 4 | RTT (done) |

Render-to-texture is **already done** — the shared backbone these build on. K1 is the highest-ceiling shared lift: it deepens mograph finish *and* footage color grading with one change.

### Track A — Motion graphics

| Bet | Lev | Cost | dependsOn |
|---|---|---|---|
| **Native per-glyph text atom** (+ unopinionated stagger builder) | 5 | 3 | RTT (done) |
| **Velocity-derived per-layer motion blur** (RTT sub-frame accumulate) | 4 | 3 | keyframe tracks |
| **Path-morph + keyframeable shape-op suite** (trim/bool/repeater animatable; `Morph{from,to,t}`) | 4 | 3 | keyframe tracks |
| **velato Lottie/icon/character import** (thin bridge crate → scene subtree) | 3 | 4 | Vello 0.7 |
| Film-emulation finish primitives; real DoF bokeh | 3–4 | 2–3 | K1 float |

### Track B — Video editing / NLE

| Bet | Lev | Cost | dependsOn |
|---|---|---|---|
| **NLE timeline substrate** (Clip/Track/EDL + per-clip time-remap + flatten-at-*t*) | 5 | 4 | — (core needs no RTT) |
| **Native decode → default + scrub/proxy/filmstrip index** (right-size to display box; cached seek) | 4 | 3–4 | — |
| **Audio editorial layer** (waveform/RMS + **fix `start_at`** + keyframed gain + duck/fade) | 4 | 2 | timeline (for per-clip) |
| **ASC-CDL per-clip grade node** (10-param, both backends, `.cdl` round-trip) + grade→LUT bake | 4 | 2 | K1 float, timeline |
| Cross-clip footage transitions; per-clip speed ramps/reverse; color scopes JSON; despill/grain-match | 3–4 | 2–3 | timeline / K1 |

---

## 4. Sequenced roadmap

Enforced dependencies: **keyframe tracks before motion-blur** (analytic velocity), **K1 float before cinematic-finish / CDL-precision / HDR-bokeh**, **timeline before per-clip grade/retime/transitions**, **decode/proxy before scrub-grade editing**, **Vello 0.7 before velato**, **RTT before blended transitions** (already done).

> **There is no defensive "Wave 0."** The earlier "close the `inspect()` leak first" item is dropped — under the corrected moat principle it's not a leak. The lead is capability.

### Wave 1 — Substrates everything plugs into (start here)
1. **Generic keyframe-any-property tracks** — connective tissue: shrinks scene-JSON, gives analytic velocity for motion blur, cheaper wasm preview, lets the agent express motion as data. Cheapest high-leverage primitive (lev 5 / cost 2). **The #1 first move.**
2. **NLE timeline substrate (core)** — Clip/Track/EDL + time-remap + hard cuts + flatten-at-*t*. The "video editing for sure" wedge; substrate under every Track-B bet. Core needs no RTT.
3. **Native decode → default + proxy/scrub index** — unblocks footage on the default build; makes the agent's vision loop affordable on footage-heavy comps. Shell out to host ffmpeg; native-only, wasm keeps its `<video>` hack.

*(Plus the standalone **`start_at` audio bug fix** — a plain correctness win, lands anytime, no dependencies.)* These are mutually independent and parallelizable.

### Wave 2 — The high-signal capability layer
4. **Native per-glyph text atom** — the #1 reason hand-authored ONDA looks generic; best effort-to-value ratio in the backlog.
5. **Velocity-derived per-layer motion blur** — needs keyframe tracks; the "shot vs made-in-a-browser" tell.
6. **Audio editorial layer** — waveform/keyframed-gain/duck on top of the `start_at` fix + timeline.
7. **HDR / `Rgba16Float` buffer (K1)** — the shared ceiling-raiser; must precede any cinematic-finish or per-clip-CDL *precision* work. Flag-gate it.

### Wave 3 — Round out both tracks
8. **ASC-CDL per-clip grade** + **despill / grain-match** nodes (need K1 + timeline).
9. **Real DoF bokeh** + **film-emulation finish primitives** (need K1).
10. **Path-morph + keyframeable shape ops** (need keyframe tracks).
11. **Cross-clip transitions** + **speed ramps/reverse** + **scopes JSON** — round out the NLE verb set.

### Wave 4 — Breadth unlock
12. **Vello 0.3→0.7**, then **velato** — broad API churn; sequenced last so it doesn't block high-leverage primitives. Collapses the icon/mascot/character-import gap in one integrate-not-rebuild move. **wasm32 must keep building throughout.**

---

## 5. What stays Studio-side (and why — not secrecy)

- **Curated look/asset data** — the tuned "ONDA look" constant stacks, named film-stock/brand grades, the curated velato/transition/asset libraries. Studio-side because they're *curated data*, not because we hide engine code. The engine ships neutral no-op defaults and the math; Studio ships the calibrated numbers as assets.
- **Editorial-orchestration product verbs** — never `onda auto-edit`/`caption-cut`/`silence-remove` in the open CLI. The open CLI exposes ingredient verbs only (`segment`→png, `transcribe`→word-timing JSON, `speak`→wav). Turning timings/silence/transcripts into edit *decisions* is the agent's job. (Codify in `CLAUDE.md`.)
- **Heavyweight ML ingredient crates** (segment/transcribe/tts) stay feature-gated + native-only (off the default build) — for build-size/practicality, and the hosted convenient version is a Studio reason-to-pay.
- **The irreproducible system** — LLM art-direction taste, the MCP toolset, the vision-correction *control loop*, the data/eval flywheel, hosting/billing/tiers, the watermark. Not in this repo; that's the moat.

---

## 6. Near-term next steps (first concrete actions, in priority order)

1. **Generic keyframe primitive (Wave 1, #1).** Promote `animation-rs`'s `Track<T>` + `Easing` + `Spring` to a first-class scene-graph `anim: Option<Vec<PropertyTrack>>` on `Node` in `packages/scene-rs/src/lib.rs`, with an addressable-property-path grammar; have `renderer-rs` + `vello-rs` evaluate tracks at frame *t* internally. Ship *neutral* spring defaults only. Unblocks motion blur + retime and shrinks scene-JSON.
2. **`start_at` audio source-trim fix** (independent correctness win). In `packages/cli-rs/src/main.rs` (`collect_audio_tracks`/`build_audio_wav`) + `packages/audio-rs/src/lib.rs` `MixTrack`: wire source-in into the mix so trimming a VO/music head works on export.
3. **NLE timeline substrate (core).** Add `Clip`/`Track`/`Timeline` nodes + a deterministic flatten-at-frame-*t* resolver in `packages/scene-rs/src/lib.rs`, rewiring the decoder off the single `Video.time`. Source-in/out + timeline-in/out + per-clip time-remap track + hard cuts. No RTT for the core; defer blended transitions. Keep editorial heuristics out of `scene-rs`/CLI.
4. **Decode → default + scrub index.** Move `onda-video` off the off-by-default `video` feature into the default native build (`packages/video-rs/Cargo.toml`, `cli-rs/Cargo.toml`); replace the forward-only PPM pipe in `packages/video-rs/src/lib.rs` with an ffprobe-driven PTS/keyframe index + proxy-on-first-touch + decode-to-display-box right-sizing. Add `onda filmstrip`/`onda proxy`. Native-only; feature-gate libav so wasm32 keeps building.
5. **Native per-glyph text atom (Wave 2 flagship).** `glyphs: Vec<GlyphTransform>` on the Text node + an unopinionated stagger builder.

> **Guardrails:** judge every cinematic/motion result on the **native Vello render** — CPU ref and WebGPU preview legitimately diverge on rotation, non-Normal blend, true 3D, fBm, and the linear/HDR finish ("preview lies"). Keep wasm32 building at every step (browser preview is a core path). And the permanent line: **the engine emits numbers and applies the instruction it's handed — it never decides which grade, which cut, or whether it reads. That judgment is the moat.**

---

## 7. Compatibility & template migration (hard guardrail — gates every scene-graph change)

**Existing templates must never break.** Verified-safe-by-construction, then defended by a golden gate.

Why we start safe:
- The engine renders a **per-frame static scene snapshot**. Templates are authored *frame-driven* (`@onda/react`: `useCurrentFrame` + `interpolate`/`spring` emit a static `Scene` per frame); the scene graph carries **no** animation state today. (`animation-rs` has `Track`/`Keyframe`/`Timeline`, but it's a separate eval path that *emits* Scenes — not embedded in stored templates.)
- `scene-rs` deserialization is **tolerant**: no `#[serde(deny_unknown_fields)]` anywhere; heavy `#[serde(default)]`. Old JSON → defaults for missing fields; newer JSON → extra fields ignored by older engines.

Discipline (every change obeys all four):
1. **Additive only.** New capability = a new `Option<…>` field (`#[serde(default)]`) or a new `NodeKind` variant. Never a required field; never `deny_unknown_fields`.
2. **Never change existing semantics/defaults.** `Video.time`, opacity/transform/blend defaults — frozen. The NLE timeline is a **new** `Clip`/`Track`/`Timeline` node path *on top of* `Video`, **not** a rewrite of `Video.time`. *(This corrects the §6 wording "rewiring the decoder off the single `Video.time`" — add the clip resolver alongside it; leave `Video.time` intact.)*
3. **Declarative tracks are opt-in.** `anim: Option<Vec<PropertyTrack>>` is a new optional path; frame-driven templates keep emitting snapshots and render identically. **Motion blur uses finite-difference between adjacent snapshots** when a layer has no track → needs no template change.
4. **K1 stays flag-gated, default off.** The `Rgba16Float` path must not alter any existing template's output; CPU stays the 8-bit byte-oracle; golden frames byte-identical with the flag off.

Empirical guarantee — **the golden gate:** extend `renderer-rs/tests/golden` with a corpus of **real, representative templates**; every scene-graph PR must produce **byte-identical CPU output** (perceptually-identical GPU) for that corpus before merge. This is what actually proves "templates didn't break."

Cheap insurance — **add a `version` stamp to `Scene` now** (it has none): an optional, defaulted field, additive, so any future migration has a hook.

Migration "little by little" (only when a template should *adopt* a new representation, or if a break is ever forced):
1. **Read-time auto-upgrade** in the engine: deserialize old → upgrade in-memory → render. Old templates never break across representation changes; keep old readers for ≥N releases.
2. **Per-template re-save migrator** (Studio-side — templates live in the Studio DB, not this repo): per template → load → migrate JSON → render old vs new → **golden-diff (must match within tolerance)** → only then re-save. Batched, flag-gated, newest-first, reversible. **Never big-bang.**
3. Track migration status per template; un-migrated templates keep rendering on the old path.

Open input needed (Studio-side): the template **storage format** decides whether the migrator is engine-side JSON or Studio-side composition-model — see the handoff question.
