# Premium Composition — Gap Analysis (Apple-tier: morphing + continuity)

_Captured 2026-06 from a deep cross-analysis: Apple/premium technique × the ONDA
Studio agent (reference) × the engine's actual capability. Thesis: "premium" is
not a look, it's TEMPORAL MECHANISMS that defeat the perception of discrete
slides. 6 of 11 gaps are AGENT/authoring gaps where the engine is ALREADY
capable — unlock what exists before building new._

I have everything I need to synthesize. All three investigations are complete and consistent. Let me produce the definitive gap analysis.

---

# ONDA Engine + Agent — Definitive Gap Analysis: Apple-Tier Compositions (Morphing + Continuity)

**Thesis:** "Premium" is not a look, it's a set of *temporal mechanisms* that defeat the perception of discrete slides. The engine already has more substrate than the agent uses; the biggest wins are unlocking what exists, not building from zero. Three of the four critical fixes are **authoring/agent gaps, not engine gaps**.

---

## 1. THE GAP LIST (ranked by premium-per-effort)

| # | Gap | Layer | Why it matters | Effort |
|---|-----|-------|----------------|--------|
| **1** | **Shared-element / magic-move continuity** — an element with a stable `continuityId` that persists & tweens transform across a beat boundary | **AGENT** (engine capable) | The #1 "is this a slideshow?" test: *can you point at one element that exists before AND after the cut and watch it transform?* Engine **can** express this (root element above `TransitionSeries`, driven by global `interpolate`/`spring`) — but the agent **structurally can't**: every scene re-declares `entries[]` with a freshly minted id (`treatment.ts:553`), so no element carries identity across a cut. | **M** |
| **2** | **Overlapping action + sub-element stagger** — next beat starts before last ends (20–40% overlap); group children stagger 30–80ms | **AGENT** (engine capable) | The single device that *alone* kills slideshow feel. Engine supports it trivially (overlap `from`/`durationInFrames` windows, per-child frame offsets). The prompt has anti-slideshow doctrine via *motif repetition* but **zero** vocabulary for temporal overlap or hand-off. | **S** |
| **3** | **Motion blur on fast frames** | **ENGINE** | The biggest single "rendered vs. real" tell. Confirmed **absent** repo-wide (no shutter/sub-frame/temporal sampling). Magic-move tweens, morphs, whip-pans all strobe without it. Client already chose this. | **M** |
| **4** | **Path / shape morph** — vector `d` interpolation done right (command-normalize → point-equalize via de Casteljau → ring-rotation align → lerp) | **ENGINE (author-time JS) + AGENT** | The literal "morph moment." Engine confirms **GAP**: `ShapeGeometry::Path` is opaque text, `vector-rs/src` is empty, scene doc says *"morphing arrive later."* But a **JS-side `morphPath(from,to,t)` in `@onda-engine/react` needs NO engine change** — the engine renders whatever `d` it's handed. Naïve `d`-string lerp must be avoided (inside-out writhing). | **M** (JS) / L (native) |
| **5** | **Premium variable display font loading** | **DELIVERY + AGENT** (engine capable) | Fastest "pro" signal. `load_font` is **already exposed** in both native (`vello-rs:75`) and wasm (`wasm-vello:131`) — the engine reality corrected the brief here. Gaps are: (a) no curated tight-geometric **variable** display face shipped/wired, (b) the agent has no instruction to use variable-font **axis tweens** (weight/width morph — near-zero cost, very premium, glyphon has the glyphs). | **S–M** |
| **6** | **Real camera in the agent's hands** | **AGENT** (engine capable) | Continuous-camera spine = automatic continuity. The `Camera` primitive **exists** (`components.ts:168-211`: pan/zoom/roll as a pure Group transform) and is exported — but it is **not in the agent's manifest** (`onda-manifest.ts`). The only "camera" the agent can place is **CameraShake** (jitter). Wire the primitive into the manifest + prompt the "slow constant push (1–3%)" rule. | **S–M** |
| **7** | **Morph / continuity transitions are fakes** — `morph`/`expandMorph` = full-scene scale+fade; `typeMask` = venetian blinds, not a glyph matte | **ENGINE + AGENT** | The catalog already self-labels these `honest:false`. They *read* but carry **no shared element**. Real fix depends on #1 (shared-element substrate) + #4 (path morph) + render-to-texture gooey. Lower priority — the honest reveals (`iris`, `push`) + magic-move beat these. | **M** |
| **8** | **Render-to-texture passes: gooey/threshold + content/text blur** | **ENGINE** | Gates the "insane" tier (per premium-roadmap note). Native already does bloom/blur/grade/goo **inline & full-quality** (`vello-rs:147-152`) — but gooey-merge of moving layers and *content* blur (blur of rendered text/shapes, not backdrop) need the render-to-texture primitive. Unlocks gooey morph + DOF + bloom-on-content at once. | **L** |
| **9** | **Materials-at-full-quality: live ≠ export** | **ENGINE (web only)** | Native export is **confirmed clean** (synchronous inline resolve, no per-frame cache to miss, deterministic — `cli-rs:1523,1838`). The **web preview** path can miss its effect cache and *"degrade to clear glass"* (`vello-rs:272`). So premium previews can lie about what export will look like. Authoring/agent vision must trust the **native render**, not preview, for QA. | **M** |
| **10** | **Designed easing as a system** — 3–4 named curves, ease-out in / ease-in out / overshoot sparingly | **AGENT** (engine capable) | "Never linear, never default." Engine has `spring` + arbitrary cubic-bézier via `interpolate`. The prompt says "one easing feel" but doesn't pin the *named curve set* (e.g. `cubic-bezier(0.16,1,0.3,1)` entrances). Cheap consistency win. | **S** |
| **11** | **Bloom + grade + grain + animated gradient mesh as defaults** | **AGENT** (engine capable) | Per premium-roadmap: the real bottleneck is **art-direction defaults**, not components. Engine ships bloom/colorgrade/blur natively at full quality. Gap is the agent doesn't reach for graded extremes (lifted blacks, vignette, ambient gradient drift) by default. | **S** |

**Pattern:** 6 of 11 gaps (#1, #2, #5-partial, #6, #10, #11) are **AGENT/authoring gaps where the engine is already capable.** The true **ENGINE** gaps are motion blur (#3), path morph native side (#4), render-to-texture passes (#8), and web-preview cache parity (#9).

---

## 2. THE FIX SEQUENCE (most premium-per-effort first)

Client has chosen the engine track: **export-to-video delivery, font-loading, motion-blur.** Sequence them with the cheap agent wins interleaved, because the agent wins are nearly free and multiply everything.

**Phase 0 — Cheap agent/authoring unlocks (days, no engine work):**
1. **Wire the existing `Camera` primitive into the agent manifest** (#6) + add the "slow constant push 1-3%, never dead-static" rule to the art-director prompt.
2. **Add overlapping-action + stagger vocabulary** to the prompt (#2): "next beat enters before last exits, 20-40% overlap; stagger group children 30-80ms."
3. **Pin a named easing set** (#10) and **graded-defaults** (#11: bloom + lifted blacks + vignette + ambient gradient) into the prompt — these reach engine features already shipped.

**Phase 1 — The three chosen engine fixes:**
4. **Font-loading delivery** (#5): ship a curated tight-geometric **variable** display face, wire `load_font` end-to-end (it's already exposed both sides), expose the variable axis to `@onda-engine/react` so the agent can author weight/width **axis tweens**. Highest "pro signal" per unit effort.
5. **Motion blur** (#3): velocity-directional blur on fast frames (sub-frame accumulation or directional blur along the per-frame displacement vector), routed through the native render-to-texture pass. Biggest cheap→pro delta for *any* fast motion.
6. **Export-to-video delivery**: harden the native sync path (already clean) as the canonical output; make agent QA render **native PNGs** (== export), not web preview (#9), so previews never lie.

**Phase 2 — Continuity & morph substrate:**
7. **`continuityId` magic-move** (#1): teach the composition format + agent to keep ONE element above the `TransitionSeries` and auto-tween its `(x,y,scale,rotation,fill,cornerRadius,opacity)` across the boundary. The engine already supports the persistent root node — this is a *format + agent + helper* change, not a renderer change. **Highest "premium" per unit effort of the substrate work.**
8. **`morphPath(from,to,t)` in `@onda-engine/react`** (#4): command-normalize + de Casteljau point-equalize + ring-rotation align **once at setup**, lerp per frame. No engine change for the JS path.

**Phase 3 — The "insane" tier:**
9. **Render-to-texture passes** (#8): gooey/threshold + content blur → unlocks gooey morph, DOF, bloom-on-content, and enables *honest* morph transitions (#7).
10. **Native `vector-rs` path interpolation** (#4 native) + true shared-element transitions (#7).

---

## 3. CONCRETE RECIPE — One Professional Hero, Buildable After Phase 1

**"VOLTAGE" — a 14s product hero, authored from primitives (root-level nodes + `interpolate`/`spring`), NOT from hard-cut scene-block components, exported native-to-video.**

The whole piece lives under **one root `<Camera>`** and **one persistent shared element**. There is no `TransitionSeries`; beats are *locations the camera travels to* and the shared element *transforms through them*. 60fps, 840 frames.

### The spine (continuity)
- **One `<Camera>` at root.** `zoom` and `focusX/focusY` keyframed across the *entire* timeline with `interpolate(frame, [0, 840], …)` — a single slow push-in (zoom `1.0 → 1.18` over the whole piece, the "constant drift" so nothing is dead-static), with two deliberate focus shifts that *arrive* at each beat rather than cutting to it.
- **The shared element = a single rounded-rect "chip" (`<Group>` with one `<Rect cornerRadius>` + `<Path>` glyph inside), placed at root, above everything, alive all 840 frames.** It is the magic-move through-line. Driven by multi-stop `interpolate`:

| Beat | Frames | Camera | The chip (shared element) | Supporting (cross-fade under) | Stagger |
|------|--------|--------|---------------------------|-------------------------------|---------|
| **1 — Spark** | 0–180 | push 1.0→1.04, focus center | enters bottom, springs up to center, large; its inner `<Path>` is a **lightning bolt** | wordmark fades in below, −2% tracking | title→tagline 60ms |
| **2 — Morph** | 150–330 | push →1.08, focus drifts left | **MORPH MOMENT**: the bolt `<Path>` `morphPath`s into a **product icon** over frames 200–230 (30f, eased), chip shrinks 0.7×, slides left to become a list-row anchor | 3 feature rows fade in to its right, staggered | rows 80ms each |
| **3 — Stat** | 300–540 | push →1.13, focus right | chip grows 1.4×, recolors `fill` accent→white via the same tween, becomes the frame for a **number** | odometer stat rolls 0→**98%** (per-digit vertical slide, ones-place settles last) | digit columns 40ms |
| **4 — Lockup** | 510–720 | push →1.16, focus center | chip's inner icon detaches and flies to nav position; chip morphs `cornerRadius` to a pill = the **CTA button** | wordmark re-converges, variable-font **weight 400→700 axis tween** on the headline | — |
| **5 — Hold** | 690–840 | push →1.18 (constant drift) | CTA pill settles with slight overshoot (bézier y2>1) | ambient gradient mesh drifts, grain | — |

Every cut **overlaps** (note frame ranges overlap by 30f ≈ 0.5s ≈ 20-30%). **No beat fully resolves before the next begins.** You can point at the chip and watch it transform through all five beats — it passes the one-line test.

### The morph moment (Phase 2 `morphPath`, or sub for Phase 1)
- **Ideal (Phase 2):** bolt outline → product-icon outline via `morphPath(boltD, iconD, eased(t))` over 30 frames. Point-correspondence done once at setup.
- **Buildable in Phase 1 (no morphPath yet):** do it as an **animated clip-path reveal** — both glyphs mounted in the chip, the bolt's `clipEllipse`/`clipRect` shrinks to a point as the icon's grows from it (a transforming reveal, the most-used "morph" in brand films). Add **motion blur** (Phase 1) on frames 200-230 so the transform doesn't strobe.

### The type
- One tight geometric **variable display face** (Phase 1 font-loading). Huge headline + small mono label, nothing muddy in between. Negative tracking (−2%) on the display. The **weight axis tween** in beat 4 (400→700) is the signature type move — near-zero cost, very premium.

### The materials (all native, full-quality, deterministic on export)
- **Motion blur** on the magic-move tweens' fast middles + the morph (Phase 1).
- **Bloom** threshold-pass on the chip's accent edge and the lightning. **Grade:** lifted blacks (not pure `#000`), slight cool cast, subtle vignette. **Animated gradient mesh** background, low-saturation slow drift. **Grain** 1px overlay. All shipped engine effects (`effects.rs` bloom/blur/colorgrade), resolved inline per frame.

### Easing (named set, reused)
- Entrances: `cubic-bezier(0.16, 1, 0.3, 1)` (arrive fast, settle soft).
- Magic-move chip: smooth `ease-in-out`, the longest move (0.5-0.9s each leg).
- CTA settle (beat 5): slight overshoot (y2 > 1).
- Supporting fades: 0.2-0.35s so the chip clearly leads.

### Delivery
- Author in `@onda-engine/react` → scene-graph JSON → **`onda export --backend vello`** (native sync path, `cli-rs:1523`). Full-quality bloom/blur/grade/matte every frame, no web-preview clear-glass risk. Agent QA on **native PNG contact sheet**, not preview.

**Why this is buildable now-ish:** the camera spine, the persistent shared chip, the odometer roll, the clip-path "morph," the staggered overlaps, and all materials are **expressible with shipped engine features today** — they just require authoring from root primitives instead of scene-block components, which the *agent* currently can't do. Phase-1 font + motion blur make it read genuinely premium; Phase-2 `morphPath` + `continuityId` automation make the agent able to author it without a human.

**Key file anchors:** persistence substrate `packages/react/src/{sequence.ts:28-39, interpolate.ts:67, spring.ts:105}`; Camera `packages/react/src/components.ts:168-211`; native sync export `packages/vello-rs/src/lib.rs:147-152` + `packages/cli-rs/src/main.rs:1523,1838`; `load_font` `packages/vello-rs/src/lib.rs:75` + `packages/wasm-vello/src/lib.rs:131`; the morph GAP `packages/scene-rs/src/lib.rs:1013-1014,1029` + empty `packages/vector-rs/src`; agent's fresh-id-per-entry blocker `onda-studio/backend/src/agents/studio/treatment.ts:553`; transition fakes `packages/react/src/transitions.ts:392-424`; agent manifest missing Camera `onda-studio/backend/src/lib/onda-manifest.ts:223-264`.
