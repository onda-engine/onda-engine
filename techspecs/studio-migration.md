# ONDA Studio → engine migration: dropping Remotion + ondajs

How ONDA Studio sheds its Remotion/ondajs dependencies in favor of the ONDA
engine (`@onda/react` + `@onda/components` + `@onda/player` + the native
renderer). Grounded in a read-only audit of `~/dev/onda-studio` (frontend +
backend) against this repo. **All implementation lands here in `onda-engine`;
Studio is migrated separately — this repo never modifies it.**

## Verdict

- **ondajs — removable after a small step.** Studio imports only `manifest` from
  the `ondajs` package; its motion vocabulary (`DURATION`/`OVERSHOOT`/`SPRING_*`/
  `STAGGER` + the 9 choreography patterns — ~420 use-sites) is already mirrored
  1:1 in `@onda/components`. Blockers: a runtime component **manifest** (Studio's
  agent prompt + UI catalog are manifest-driven) and that Studio's renderer still
  emits Remotion JSX. Its ~70 components are *vendored copies*, not the npm pkg.
- **Remotion — phased, not a swap.** `@onda/react` already covers the
  high-traffic core (~70%): `useCurrentFrame`/`useVideoConfig`/`interpolate`/
  `spring`/`Easing`/`random`/`Sequence`/`Series`/`Loop`/`AbsoluteFill`/`Image`,
  and a `TransitionSeries` primitive + fade/slide/wipe. Removal is gated by three
  independent long poles plus a tail (below).

## Surface coverage

| Surface | Studio usage | @onda status |
| --- | --- | --- |
| `remotion` core | ~269 import sites; top: useVideoConfig, useCurrentFrame, interpolate, AbsoluteFill, spring | ✅ ~70% covered by `@onda/react`; gaps: Audio/Video primitives, `interpolateColors` (now added), `registerRoot`/`getInputProps`/`staticFile` (bundler-only, N/A) |
| `@remotion/transitions` | TransitionSeries + ~12 presentations; 18 vendored transitions | ✅ primitive + the full Remotion-standard set (fade/slide/wipe/flip/clockWipe/iris/none); ⚠️ ~9 Onda-original customs remain (some need the engine blur/blend pass) |
| `@remotion/paths` / `shapes` / `media-utils` | evolvePath, shapes, getAudioData/visualizeAudio | ❌ paths→engine draw-on (stroke-dash) gap; shapes partial; audio-data gap |
| `@remotion/player` | editor preview (scrub/controls/seek/ref) | ⚠️ `@onda/player` exists; needed imperative ref/events/initialFrame (now added) |
| `@remotion/bundler` + `renderer` (backend) | bundle + renderMedia → MP4 (headless Chromium) | ❌ engine renders via CLI; needs a Node render bridge (progress + codec flags) |
| `ondajs` | `manifest` only; DURATION + choreography re-exports | ✅ DURATION/choreography in `@onda/components`; ❌ runtime manifest |

## Long poles (the real blockers)

1. **`@onda/player` imperative API** — host-drivable preview (seekTo/play/pause,
   frame/play/pause events, initialFrame). *(Done — see Status.)*
2. **Node render bridge** — frames → MP4 with per-frame progress + codec/crf/audio
   flags (progress-streaming CLI first; napi-rs binding later). Gates
   `@remotion/bundler` + `@remotion/renderer` removal.
3. **Audio + video in the render graph** — Audio/Video scene nodes wired to the
   CLI mux (`onda-audio` decodes/mixes already; video decode is new work). Gates
   `Audio`/`Video`/`OffthreadVideo`.

## Prioritized build queue (all in `onda-engine`)

1. **Quick wins** *(small)* — `interpolateColors` in `@onda/react`; verify
   `DURATION`/choreography parity; `Img`→`Image` alias. Unblocks dropping
   `ondajs/motion`. *(Done.)*
2. **`@onda/player` imperative API** *(medium)* — `packages/player`. Unblocks
   `@remotion/player` for the editor preview surface. *(Done.)*
3. **Node render bridge** *(large)* — `packages/cli-rs` (progress + flags) + a TS
   wrapper. Unblocks the backend export pipeline.
4. **Transition catalog** *(medium)* — *(standard set done: `flip`/`clockWipe`/
   `iris`/`none` added to fade/slide/wipe.)* Remaining: the ~9 Onda-original
   customs — `push`/`zoom`/`dipToColor`/`depthPush`/`devicePullback` are
   clip/transform (buildable now from Studio's source); `glassWipe`/`gridPixelate`/
   `chromaticAberration`/`blur`/`morph` need the Vello blur/blend pass first.
5. **Audio in the render graph** *(medium)* — `scene-rs` Audio node + `cli-rs`
   mux + `@onda/components` AudioClip export path.
6. **Video decode** *(large)* — a `<Video>` decode path feeding the scene graph
   (native-only / feature-gated to keep wasm32 building).
7. **Runtime component manifest** *(medium)* — code-generate from
   `@onda/components` (name/category/title/description/schema) for the agent
   prompt + catalog.
8. **Stroke-dash / path arc-length** *(medium)* — `vello-rs`; upgrades
   DrawOn/Timeline/etc. from the clip-wipe approximation. Replaces
   `@remotion/paths`.
9. **Audio FFT** *(medium)* — `audio-rs` (rustfft) for real AudioVisualizer;
   replaces `@remotion/media-utils`.

## Risks

- **Player re-entrancy:** the imperative `seekTo` must drive the same single-flight
  GPU paint path; the module-level `enginesRendering` `WeakSet` guard must stay
  intact or multiple players sharing one wasm engine panic on re-entrant render.
- **Node render bridge scope:** napi-rs is the "right" long-term answer but heavy
  (platform prebuilds); a progress-streaming CLI is the lower-risk first cut.
- **Pixel/timing drift:** every ported transition/choreography/component should be
  diffed against Remotion output, or existing Studio compositions subtly change —
  a credibility risk given the 100×-vs-Remotion positioning.
- **Video decode** pulls a heavy native dep; must be feature-gated so the wasm32
  browser-preview build keeps working.
- **zod version:** Studio aliases zod to v3 for its render bundle; verify
  `@onda/components` schema/zod compatibility before publishing the manifest.

## Status

Done:
- `@onda/react`: `interpolateColors` (+ unit tests); `Img` alias of `Image`.
- `@onda/player`: imperative `ref` (`PlayerHandle`: seekTo/play/pause/toggle/
  getCurrentFrame/getTotalFrames/isPlaying) + `onFrameUpdate`/`onPlay`/`onPause`
  + `initialFrame`. The single-flight paint + re-entrancy guard are preserved.
- `@onda/react` transitions: `flip`/`clockWipe`/`iris`/`none` presentations
  (+ unit tests), completing the Remotion-standard set. `clockWipe` uses a
  polygon wedge (no arc dependency); `iris` an ellipse clip; `flip` a
  centre-pivot scale. **Visually verified rendering in the real WebGPU/Vello
  engine** (centred-circle reveal, angular sweep, centre-pivot collapse, hard
  cut) via a throwaway probe page. Not yet a formal pixel-diff against Remotion's
  own output (a stricter bar, if exactness matters).

Next: the Node render bridge (#3) is the highest-value remaining unblock (the
actual Chromium-removal payoff). The remaining transition customs (#4) and the
audio path (#5) are self-contained parallel tracks.
