# Roadmap — the editor pivot + the agent-quality ladder

_Captured 2026-06-13. The living plan we follow as we progress. Companion to
`engine-power-vs-ae.md` (the renderer capability ceiling), `library-north-star.md`
(ONDA as director/compositor over AI media), and `studio-vision-correction-loop.md`
(the agent's self-correction endgame). Where the founding brief said "not a video
editor," this doc records a deliberate strategic evolution: **ONDA becomes a
motion-graphics engine that is ALSO a real video editor — the best AI agent for
video editing/composition.** Update the checkboxes as items land._

## The thesis

Two products competing today each leave half the job undone: **CapCut** can cut
footage but can't do real motion graphics; **Descript** edits by transcript but has
no typography craft; **neither has an agent** that does both from one sentence. The
wedge is the union — and the union is reachable because every capability below
passes one test:

> **A power belongs in ONDA if it is deterministic, parameterizable, and
> measurable.** That is exactly what lets the agent wield it reliably, the Inspector
> verify it, and the version system checkpoint it — which no pixel-generating
> competitor can promise.

The goal is **not** "every feature a manual editor has" (bezier-handle UIs, keyframe
graph editors — hundreds of things an agent never needs). The goal is **every power
an _agent_ can wield reliably**, each shipped as: a deterministic engine verb +
a Studio playbook + an Inspector check.

## The responsibility line (load-bearing)

The user's standing rule (see memory `onda-engine-studio-responsibility-line`):

- **Engine (public, Rust)** = anything a developer importing `@onda/react` would
  hit: the component library, renderer, layout/placement, animation-timing, and
  every editing _operation_ (silence detection, transcription, matting, cuts).
- **Studio (private, the moat)** = the agent layer on top: playbooks, treatment
  planner, prompts, the vision-correction loop, content catalogs, hosting, billing,
  and the _judgment_ about when/how hard to apply an operation.

And the absolute (memory `onda-rust-for-engine-work`): **all engine capability/perf
work is Rust** — a crate exposed as an `onda` CLI verb (the `beats_json`/`segment`
pattern) and/or a wasm binding. TypeScript layers ORCHESTRATE only (resolve assets,
spawn the binary, store outputs); never decode/process pixels/audio/frames in JS.
Self-hosting the models is also the unit-economics win: video APIs charge per minute
of footage; our own GPU charges per second of compute it already rents (≈100–300×
cheaper), capped by the export meter already built.

---

## Track A — Engine: the video-editor pivot (Rust)

Build order matters: each item depends on the one above. Verbs run on the same
render worker that already renders video.

- [x] **A1. Video ingest foundation** _(done 2026-06-13)_. Engine: `video` feature
  baked into the embed-kit binary (native A-roll decode for export, ffmpeg CLI) —
  verified a Video node composites footage under a title. Studio: transcode-on-
  ingest (`backend/src/lib/video-ingest.ts`) — ffprobe → H.264 proxy (longest edge
  ≤1920, faststart) + poster thumbnail, replacing the original; rotation handled via
  ffmpeg's default autorotate + display-dim probe (portrait phone video comes out
  UPRIGHT); status lifecycle `transcoding`→`complete`/`failed`+reason (never silently
  complete); quota rewritten to proxy+poster bytes. Verified live on temp files
  (landscape/4K-downscale/portrait-rotation/HEVC .mov) + R2 round-trip. ⚠️ ACTION:
  apply migration `0020` (adds `failure_reason`) before the Studio upload flow works
  for video; frontend `processing` spinner deferred (failed-chip already shows).
- [ ] **A2. One-click captions** _(highest-visibility single win)_. whisper.cpp
  (MIT, local, Rust via the `ort`/CLI pattern) → word-level timestamps → the
  EXISTING `Captions` component. The moat: captions rendered as first-class motion
  graphics (brand fonts, placement contract, beat-aware, Inspector-legibility-checked)
  — not one of twelve CapCut templates. New verb `onda transcribe`.
- [ ] **A3. The Descript trinity** _(shares A2's transcript infra)_: silence-cut
  (RMS gating, no transcript needed — "tighten this take"); filler-word removal
  ("cut the ums" = transcript filter → cut list); **text-based editing** (delete a
  sentence in the transcript → the video cuts itself — the crown jewel for an
  agent). Cut application = clip trims the timeline already models. Add
  `onda silence` (RMS) + transcript-driven cut lists.
- [ ] **A4. Audio finishing**: LUFS loudness normalization (−14 target) + auto-duck
  music under voice (−12 dB, 120 ms attack / 400 ms release). Pure Rust DSP; spec
  already in the founding craft notes (§6 of the original engine spec).
- [ ] **A5. Auto-reframe 16:9→9:16**: sample the `segment-rs` subject across frames,
  smooth the bbox path, drive the existing `Camera` as a crop path. You already own
  the hard part (segmentation); this is the CapCut/Premiere flagship feature built
  from parts on the shelf. Compounds with the multi-format story.
- [ ] **A6. Video subject matting** _(the heaviest build; the biggest creative
  unlock)_. A temporally-stable matting model (RVM-class or SAM2 — **must vet for an
  Apache/MIT license**, RVM itself is GPL and can't ship). Renderer gains a per-frame
  alpha stream on a Video node (new `onda-video` + renderer work). Unlocks: text
  behind a MOVING person, the person-wipe transition (signature viral move), video
  background swap. The playbooks don't change — the cutout becomes a matte _video_.
- [ ] **A7. Motion tracking**: point/region tracking in Rust → text and callouts
  pinned to moving objects in footage. The technique behind half the polished
  YouTube explainers.

**Creative/finishing extras** (smaller, slot opportunistically): photo-parallax
inpainting (LaMa-class ONNX — enables BOLD camera moves where the background slides
out from behind the subject; today's parallax is constrained to modest moves);
color-match across clips (histogram matching); stabilization (ffmpeg `vid.stab`,
already behind the `video` feature); variable-font axis animation; per-layer motion
blur (keystone K4 from `engine-power-vs-ae.md`); shape boolean/trim/repeater ops.

### Engine — already shipped (the foundation this builds on)
Inspector (`inspect()` + 6 checks), subject segmentation (`onda segment`), the
6-item ergonomics pass (placement contract / bounds+auto-fit / clip-aware timing /
glyph-line consolidation / variants / divergence report), image blank-tile +
clip-occlusion root-cause fixes, versioning + SHA stamp + CI + the tag-triggered
embed-kit release, audio synth + beat detection, LUT finish chain + magic-move, 3D
(Scene3D/extrude) + DoF, 82 components / 21 transitions / 17 effects.

---

## Track B — Studio: the agent-quality ladder (the moat)

The order the user ranked when asked "what makes the agent really, really good":

- [x] **B1. Inspector wired into review** _(done 2026-06-13)_. Every build/edit runs
  the engine's deterministic `inspect()` as a free Layer-0 pass (with its own fix
  budget) BEFORE any paid GPT-vision call; persistent errors surfaced honestly.
  Also fixed the three vision-decay bugs (reviewsLeft resets per turn; judge renders
  REAL media; vision gates on art-directed-or-substantial). `role` auto-assigned by
  the treatment builder. `inspect_composition` MCP tool added.
- [ ] **B2. Treatment schema → executable premium** _(the structural gap)_. The
  treatment plan schema has no fields for finish/camera/effects/audio/morphKey, so
  the deterministic builder that handles EVERY first build cannot be born premium —
  the playbooks describe the magazine sandwich, the planner can't order one. Add
  those fields to the plan schema + builder. Converts the whole playbook library
  from prose into executable output. ~1 day.
- [ ] **B3. Gold-corpus** _(the taste work — needs the user as judge)_. 10–20
  pro-grade comps across genres (product promo, brand film, kinetic-type, editorial/
  segment-powered, data story…), each built with the full toolkit and approved by
  the user's eye. Become few-shot exemplars AND the eval ground truth. Generalizes
  the standing "one pro-grade comp we both agree on, then encode it" agreement.
- [ ] **B4. Eval flywheel**. The harness exists (pairwise vision judging +
  agentVersion/playbook-hash attribution). Missing: the habit — a fixed ~30-brief
  corpus run after every prompt/playbook/schema change, scored against B3. Turns
  "we think it's better" into a number that moves.
- [ ] **B5. More playbooks**, each as verb+recipe+Inspector-check: hook-first
  openings (moving type in the first second), beat-locked everything, match-cut flow
  (`morphKey`), layered-information density, sound design (synth + ducking).
- [ ] **B6. Wire each engine power** (Track A) as it ships: an MCP tool + a playbook.
  `segment_asset` + text-behind-subject + photo-parallax done; captions/silence/
  reframe/matting follow the same pattern.

**Background ceiling-raisers:** English-only regex routing silently skips the art
director for non-English briefs (a quality cliff for half the internet); the full
vision-correction loop (render → detect bboxes → diff vs reference → fix — speced in
`studio-vision-correction-loop.md`) is the endgame "checking" tier.

---

## Track C — Go-live (from the 5-agent audit)

- [ ] **C1. Deployment**: Studio Docker pulls the pinned embed-kit release (fix the
  `bun.lockb`→`bun.lock` copy, add ffmpeg, download the artifact), the two missing
  deploy workflows, and a Cloud Run **GPU** render worker (scale-to-zero L4; the
  vello enumerate fix already handles its adapter, and lavapipe is the CI-proven
  fallback). The engine's release artifact is the supply line — built today.
- [ ] **C2. Render isolation**: per-user concurrency cap, child-process timeout,
  composition duration/resolution clamps (a burst of exports must not self-DoS/OOM).
  Move renders out of the API process onto the GPU worker.
- [ ] **C3. Concurrency correctness** (already partly shipped: revision CAS, export
  ledger, single-store MCP): finish the same-name→IDs resolution and the
  sync-failure surfacing so two surfaces editing one doc never lose work silently.
- [ ] **C4. Security/legal shortlist**: SSRF allowlist on URL fetchers; email
  verification / OAuth-only + signup rate-limit (anti-farming); `/terms` + `/privacy`;
  delete `/onda-test`; fix the `/api/users` email leak; commit the Remotion
  non-affiliation disclaimer.

**Already closed since the audit:** watermark is real; export metering (web + MCP);
server-backed undo/redo + named versions; the export confirm dialog + quota; the
ghost-tool drift (tool registry unified).

---

## Recommended sequence

1. **A1 video ingest** — the foundation the entire editor pivot stands on; nothing
   in A2–A7 works without it. Concrete and verifiable.
2. **A2 captions** — highest-visibility single win; exercises the typography moat.
3. **A3 trinity** + **B6 wiring** — the editor identity lands; shares A2's transcripts.
4. Interleave **B2 treatment schema** (cheap, makes everything born-premium) and
   **B3 gold-corpus** (ongoing, user-gated) as craft rituals.
5. **C-track** when a real deploy is wanted — most blockers are already closed.

Engine docs review + npm publish remain the user's explicit final-polish leave-outs
before the public repo opens.
