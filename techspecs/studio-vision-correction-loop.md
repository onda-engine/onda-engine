# Studio vision-correction loop — the self-correcting "pixel-perfect" engine

Prototyped while replicating an ElevenLabs film in ONDA (the `refs/` throwaway tools).
This is a STUDIO capability (the agent's vision is the moat); when it migrates, the
engine-side `refs/` scratch (teardown.sh, .onda-vision venv, annotate.py) is deleted.

## The thesis
A human catching every misalignment one at a time does not scale. Move the *catching*
and *measuring* to the agent: render → detect element bounding boxes → diff against
intent/reference → fix → re-detect → converge. The agent only surfaces to the human for
**taste** ("does it *feel* right"), never for spotting pixels.

## The stack (each piece built + verified on the Flows-Agent rebuild)
1. **Native-fps motion grids.** To read a MOTION, sample EVERY frame (33ms at 30fps —
   the data floor), cropped to the element, tiled in order. Coarser sampling (every
   0.1s) hides the easing. This is how the typewriter title, the inline cursor, and the
   square→wide box-grow were finally read — invisible at coarse sampling.
   (`teardown.sh zoom <t0> <t1>`)
2. **Element detection → numbers.** Color-mask each element (card = near-white; field =
   light-gray-not-white; header/buttons = dark inside the card; dot = green) and report
   its bbox + center. Spacing (pads, gaps) becomes measured px, not "looks about right".
   (`.onda-vision` venv + numpy/PIL.) This caught the field misalignment AND the real
   bug: the card was 680×253 vs the measured 898×253 — which is why the submit button
   kept falling outside crops anchored to *our* geometry instead of the reference's.
3. **Ruler / guide overlay.** Draw a px grid + edge rulers + center crosshairs + the
   detected boxes (with size/pos labels) on any frame, so the agent can *see + verify*
   positions, not just compute them — "measure first, see second". (`annotate.py`)
4. **Diff → converge.** Detect the reference's bbox, build to those numbers, re-detect
   the render's bbox, diff. Convergence is a number: the card matched the reference to
   **within 1–3px** (w895 vs 898, center (959,529) vs (960,530)) once measured.
5. **SSIM per frame** (full-frame is cloud-dominated → use it for deterministic elements
   + relative improvement) and **audio beat/onset extraction** (sync motion to beats).

## The loop (per shot)
render → frame-matched comparisons (per element, native fps, **cropped to the
reference's detected bounds, not ours**) → agent exhaustively self-critiques + the
detector measures every bbox/gap → fix all → re-detect → diff → repeat until every
element bbox-matches + SSIM gate passes → surface to human for taste only.

## Hard-won rules
- Crop comparisons to the **reference's** real element bounds (detect them), never to
  assumed/our geometry — else you compare against your own mistake.
- MOTION + TIMING reach the agent as **numbers** (velocity, beat frames, bbox deltas,
  SSIM); LOOK reaches it as **labeled images** (annotated grids). You cannot measure
  sub-pixel easing or alignment from a downscaled strip.
- Procedural backgrounds (fBm clouds) never SSIM-match pixel-for-pixel (different noise
  field) — judge them by palette match + the human eye, drive SSIM on the elements.
- Text vertical anchor isn't the baseline — calibrate the offset (or detect the text
  bbox and align to it) rather than assuming.

## Migration note
All of the above is the Studio agent's inner loop. The engine just needs to render fast,
deterministically, and expose element metadata where cheap; the *intelligence* (detect,
measure, diff, converge, the taste lints) lives in Studio.
