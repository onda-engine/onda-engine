# ONDA — Brand & Design System

The single source of truth for ONDA's web surfaces (landing page, docs, player demo).
Derived from the **UI/UX Pro Max** methodology: establish the design system first,
use semantic tokens (never raw hex in components), respect accessibility (≥4.5:1
contrast), one primary CTA per screen, intentional micro-interactions, and honor
`prefers-reduced-motion`. Product type: **developer tool / rendering engine** —
favor clarity and precision over decoration. Do not look generic.

## Positioning & voice

ONDA is an **open-source, GPU-native, browser-free motion-graphics engine in Rust**.
Tagline candidates: *"Motion graphics at GPU speed. No browser."* / *"Programmatic
video, without Chromium."*

- The "**100× better than Remotion**" claim is **architectural**, measured **against
  Remotion** (not against ONDA's own CPU path). Remotion renders `React → DOM →
  headless Chromium → screenshot/frame → encode`; ONDA renders `React → scene graph
  → native GPU renderer → frame`, with **no browser anywhere**.
- Be honest with numbers. **Measured (Apple M4 Pro, 1080p):** ONDA ~**4.5× per-thread**
  and ~**9.3× machine-throughput** vs Remotion on a trivial scene (Remotion's best
  case); the gap widens toward 100× with scene complexity, GPU, cold-start, and
  memory. Lead with the measured multiple + the trajectory, not a bare "100×".
- Voice: precise, technical, confident, not hypey. Short sentences. Show code.

## Logo

- Mark: `assets/brand/onda-mark.svg` — three blue→cyan waves ("onda" = *wave*).
  Use as inline SVG or `<img>`. Works on dark backgrounds; also fine as a favicon.
- Wordmark: render **ONDA** in the heading font (Space Grotesk), weight 600–700,
  letter-spacing ~0.02em, next to the mark. Do **not** bake the wordmark into the
  SVG (keep it as live text for crispness/accessibility).
- Clear space around the mark ≥ half its height. Don't recolor or stretch it.

## Color tokens (dark-first)

Use these as CSS variables / semantic tokens — never hardcode hex in components.

```css
:root {
  /* surfaces */
  --bg:          #080b13;  /* page background (deep navy-black) */
  --surface:     #11151f;  /* cards/panels */
  --surface-2:   #1a1f2e;  /* raised / hover */
  --border:      #232a3a;
  /* text */
  --text:        #e8edf7;  /* on dark; ~13:1 on --bg (AAA) */
  --text-muted:  #93a0b8;  /* ~5.4:1 on --bg (AA) — use for secondary only */
  /* brand */
  --primary:     #3b82f6;  /* ONDA blue (links, primary CTA) */
  --primary-700: #2563eb;  /* hover/pressed */
  --cyan:        #22d3ee;
  --pink:        #f25a8c;
  --on-primary:  #ffffff;  /* 4.7:1 on --primary (AA) */
  /* signature gradients */
  --grad-warm:   linear-gradient(90deg, #3b82f6, #f25a8c);  /* hero accents */
  --grad-cool:   linear-gradient(90deg, #3b82f6, #22d3ee);  /* the mark */
  /* feedback */
  --ok: #28c08a;  --warn: #fac81c;  --err: #f25a5a;
}
```

A light theme is optional; if added, design it independently (don't just invert)
and re-verify contrast. Dark-first is the default and primary surface.

## Typography

- **Headings:** `"Space Grotesk", ui-sans-serif, system-ui, sans-serif` (600/700).
- **Body:** `"Inter", ui-sans-serif, system-ui, sans-serif` (400/500).
- **Code:** `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`.
- Load via Google Fonts (or self-host). Body text **≥16px**. Line length 60–75ch
  on desktop. Consistent type scale (rem): 0.875 / 1 / 1.125 / 1.25 / 1.5 / 2 /
  3 / 3.75 (14/16/18/20/24/32/48/60px). Headings tight line-height (1.05–1.15),
  body 1.6.

## Spacing, radius, elevation, motion

- **Spacing:** 8px base scale (4 8 12 16 24 32 48 64 96 128). Generous section
  padding (96–128px vertical on desktop).
- **Radius:** 8px (controls), 14px (cards), 999px (pills). Be consistent.
- **Elevation:** subtle — `0 1px 0 rgba(255,255,255,.04) inset, 0 8px 30px rgba(0,0,0,.4)`
  on raised cards. Avoid heavy drop shadows.
- **Motion:** micro-interactions 150–300ms, ease-out; hover/press states on all
  interactive elements; scroll-reveal subtle. **Wrap all non-essential motion in
  `@media (prefers-reduced-motion: reduce)`** and disable it there.
- A signature touch: subtle animated wave/gradient in the hero (respecting
  reduced-motion). Don't overdo it.

## Components

- **Primary CTA:** filled `--primary`, `--on-primary` text, radius 8px, 44px min
  height, clear hover (→ `--primary-700`) + pressed states. **One per screen.**
- **Secondary CTA:** outline (`--border`) or ghost; e.g. "View on GitHub".
- **Cards:** `--surface`, 1px `--border`, radius 14px, 24–32px padding.
- **Code blocks:** `--surface`/darker, mono font, syntax highlight in brand hues
  (blue/cyan/pink/green), copy button. Show real ONDA code.
- **Buttons/links:** native `<button>`/`<a>`; keep visible focus rings (don't
  remove outlines); icon-only buttons need `aria-label`.

## Accessibility & quality (non-negotiable)

≥4.5:1 contrast (verify each theme); keyboard navigable; visible focus; meaningful
`alt`/`aria`; no layout shift on load (reserve image space); responsive with no
horizontal scroll (breakpoints 375 / 768 / 1024 / 1440). Lazy-load heavy media;
prefer WebP/AVIF/SVG.

## Product facts (for landing/docs copy)

- **No browser:** unlike Remotion (headless Chromium), ONDA has zero browser
  dependency — deterministic, lower memory, higher concurrency per machine.
- **GPU-native vector renderer (Vello):** anti-aliased fills + strokes, real
  rounded rects, arbitrary Bézier **paths**, **linear/radial gradients**, **clip
  masks**, and **native per-glyph vector text**. A CPU reference rasterizer gives
  bit-identical, deterministic output (`--backend cpu`).
- **Author in React/JSX:** `<Composition>`, `<Rect>/<Ellipse>/<Path>/<Text>/<Svg>`,
  `<Sequence>/<Series>/<Loop>`, `useCurrentFrame`, `interpolate`, `spring`. Same
  DX as Remotion; compiles to a plain scene-graph JSON that the engine renders.
- **Universal scene graph:** React, JSON, or AI all emit the same scene graph; the
  renderer is the platform.
- **Import SVG:** `<Svg src=… | markup=…>` (logos/icons) expands to vector nodes.
- **Export:** PNG / GIF / MP4 via the `onda` CLI (`render` / `export` /
  `export-frames`, `--backend auto|vello|cpu`).
- **Rust workspace** (open source, MIT/Apache-2.0). Repo:
  `https://github.com/degueba/onda-engine`.

## Example code (use verbatim-ish in hero/docs)

```tsx
import { Composition, Rect, Text, Path, linearGradient } from '@onda/react'

export const Hello = () => (
  <Composition width={1920} height={1080} fps={30} durationInFrames={90}>
    <Rect width={1920} height={1080} fill="#0a0d17" />
    <Rect x={160} y={840} width={900} height={12} cornerRadius={6}
      gradient={linearGradient([0, 0], [900, 0],
        [{ offset: 0, color: '#3b82f6' }, { offset: 1, color: '#f25a8c' }])} />
    <Text x={160} y={420} fontSize={140} color="#fff">GPU-native</Text>
  </Composition>
)
```

```bash
# render through the GPU (Vello) backend — no browser involved
onda render scene.json out.png
onda export movie.json out.mp4 --backend vello
```
