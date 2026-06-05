# Composition craft notes — the agent curriculum

What we learned hand-building premium compositions (the FBM hero + the SOLENNE
cinematic plate). These are the actionable principles the Studio agent should
follow to generate at the highest level. Each is proven in a shipped exemplar.

## 0. The prime directive: export native, judge the MP4

The live browser preview FLICKERS and DEGRADES (per-frame GPU→CPU readback; RTT
materials async-miss → "clear glass"; no motion blur live). **Premium = the
EXPORTED MP4** (native Vello, full materials, deterministic, no flicker), played as
a `<video>`. Author for export; judge from the exported frames, never the live
preview. (Tooling: `render-comp.mjs --comp … --font … --motion-blur 8`.)

## 1. Concept first, then ruthless restraint

One idea, one motif, one motion language. Spare type. The strongest hero is a
gorgeous SURFACE + one confident line, not a slideshow of stat cards. If the visual
shows it, the copy must not re-explain it (see the Studio card: the prompt→video
mockup carries the mechanism, so the words shrank to one line).

## 2. The "expensive" surface (never a flat fill)

- **Vector:** the **fBm gradient** (`fbmGradient`, scale ~0.8–1.2 + warp ~0.4–0.6,
  animate `time`) — the Stripe/Linear wispy gradient. A flat linear/radial reads cheap.
- **Cinematic:** a real/AI **media plate**, *directed* (next section).

## 3. Land a media plate as a DIRECTED SHOT (not a paste)

The recipe that turns a raw still into "looks shot" (SOLENNE exemplar):
- **Corrective grade** first — tame the stock tell: `grade:{ saturation:~0.9,
  contrast:~1.06, exposure:-0.03, temperature:+0.03 }`.
- **Focus-pull entrance** — animate the plate `blur` sigma high→0 (a rack-focus in).
- **Ken Burns** — a still gains life under a slow `Camera` push (zoom 1.04→1.10).
- **Bloom the highlights** — `bloom` on the bright regions (sun-flare). *Flat in
  gamma; real once the linear keystone lands — that's the whole point of the plan.*
- **Grain over everything** — `<Image src="onda-noise://w=..&h=..&seed=round(frame)&
  intensity=0.06&mono=1" blendMode="overlay">` as the LAST layer. Unifies plate +
  graphics under one texture; seed by `round(frame)` so it shimmers AND survives
  motion-blur averaging.
- **Vignette** — a radial-gradient `Rect` overlay (transparent center → dark edge);
  pulls focus, deepens negative space for type.
- **Motion blur** — export `--motion-blur 8` (180° shutter).

## 4. Continuity (defeat the slideshow)

ONE slow `Camera` push spans the whole piece (constant drift, never dead-static) +
a faint focus drift. Beats CROSS-FADE (overlapping action), not hard-cut. Keep a
PERSISTENT element across beats (an eyebrow, a wave, the plate). The `Camera` is a
pure Group transform — GPU-cheap; animate focus/zoom per frame.

## 5. Morphing / the magic-move

`morphPath(from, to, t)` (+ `morphPathSequence`) — element/path morphing (Apple/
ElevenLabs lean on this). Feed an animated `t` to a `<Path d>`. Used in SOLENNE as a
gold diamond that unfolds (morphs) into a hairline rule — a tasteful "fleuron". Give
morph ornaments a `shadow` glow so hairlines read on dark.

## 6. Premium type

A display face (**Bricolage Grotesque 96pt**, loaded via `--font`; family name
"Bricolage Grotesque 96pt", weight via `fontWeight`). 3-tier hierarchy (display /
label / caption). Off-center placement; generous negative space. STAGED reveal
(wordmark → ornament → subtitle → credit), each rising + fading in on its own beat.
`letterSpacing` on small caps (the optical-sizing tell). Rough-center by eye, then
verify with a crop-render (`render-frame --crop x,y,w,h`).

## 7. Materials are FINISHING, applied as a chain & judged from the export

`grade` / `bloom` / `backdropBlur` (glass) / `blur` / `matte` / `blend`
(overlay/soft-light) are NodeProps sugar; Vignette/Grain/FilmGrade are components.
They're RTT — full quality on native export, async-degrade live. The CINEMATIC
finishing chain (grade→light-wrap→halation→grain→tone-map) only reads right in
LINEAR space (the keystone, `techspecs/cinematic-layer-plan.md`); subtle effects
(light-wrap, halation, CA) must be tuned from the exported MP4, not the preview.

## Proven exemplars (the agent's reference set)

- `apps/site/scripts/premium-hero.comp.mjs` — vector: fBm wave-field + Bricolage +
  continuity + motion blur → the landing hero.
- `apps/site/scripts/cinema-plate.comp.mjs` — cinematic: one CC0 plate → a SOLENNE
  perfume title card (grade, focus-pull, Ken Burns, bloom, grain, morph ornament,
  vignette, motion blur). The gamma "before"; linear keystone = the "after".
