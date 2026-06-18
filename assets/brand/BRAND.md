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

Palette aligned to **onda.video** (the sibling brand): neutral near-black,
neutral grays, and a single muted-rose accent. No blue/cyan, no multi-color
gradients.

```css
:root {
  /* surfaces — warm-neutral near-black (NOT blue navy) */
  --bg:          #0e0e12;  /* page background */
  --bg-deep:     #08080a;  /* deepest panels / video stage */
  --surface:     #121217;  /* cards/panels */
  --surface-2:   #18181d;  /* raised / hover */
  --border:      #26262c;  /* hairline (or rgba(255,255,255,.08)) */
  /* text — neutral grays */
  --text:        #f2f2f4;  /* ~17:1 on --bg */
  --text-muted:  #8e8e98;  /* secondary (~5:1) */
  --text-dim:    #56565f;  /* labels/eyebrows; decorative only */
  /* the ONE accent — muted rose. Use sparingly: CTA, links, the mark. */
  --accent:      #d96b82;
  --accent-600:  #c8576f;  /* hover/pressed */
  --accent-soft: rgba(217,107,130,.12);  /* faint rose wash on a hero stage */
  --on-accent:   #0e0e12;  /* dark text on the rose button (AA) */
  /* feedback (kept muted, neutral-leaning) */
  --ok: #6bbf8a;  --warn: #d9b06b;  --err: #d96b6b;
}
```

Deliberately NO `--grad-warm`/`--grad-cool`/`--cyan`/`--primary` blue tokens —
the old neon-gradient identity is retired. A light theme is optional; design it
independently and re-verify contrast. Dark-first is primary.

## Typography

The display face is what makes ONDA read as *designed*, not generated.

- **Headings:** **`"Clash Display", "Space Grotesk", sans-serif`** (600/700) —
  the editorial display face (Fontshare). Big, tight, characterful.
- **Body:** `"Space Grotesk", ui-sans-serif, system-ui, sans-serif` (400/500).
- **Code/labels:** `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`
  (also for eyebrows/overlines, uppercased + letter-spaced).
- Load Clash Display via Fontshare
  (`https://api.fontshare.com/v2/css?f[]=clash-display@600,700&display=swap`),
  the rest via Google Fonts (or self-host). Body **≥16px**. Line length 60–75ch.
  Type scale (rem): 0.875 / 1 / 1.125 / 1.25 / 1.5 / 2 / 3 / 4 / 5.5
  (display headings go BIG: 64–88px on desktop). Heading line-height 0.95–1.05,
  body 1.6.

## Spacing, radius, elevation, motion

- **Spacing:** 8px base scale. Generous section padding (96–160px vertical).
- **Radius:** 8px (controls), 12–14px (cards), 999px (pills). Consistent.
- **Borders:** prefer **hairlines** (`--border` / `rgba(255,255,255,.07)`) over
  fills; let negative space and type do the work.
- **Elevation:** minimal. A faint top inset highlight + a soft shadow at most;
  no heavy glows.
- **Motion:** micro-interactions 150–300ms ease-out; subtle scroll-reveal. Wrap
  all non-essential motion in `@media (prefers-reduced-motion: reduce)`.

## Visual direction — avoid the generic "AI" look (important)

The previous identity (dark navy + blue→cyan/blue→pink neon gradients + glow
blurs + gradient-clipped headline text + Inter) is the default AI-startup
template — it reads as generated. ONDA's identity is the opposite: **editorial
restraint**.

- **Monochrome + one accent.** Neutral near-black & grays carry the page; rose
  appears rarely (CTA, the mark, a single highlighted word, a hairline tint).
- **No gradient text, no glow/blur orbs, no neon.** At most a *single*, very
  faint rose radial on the hero stage (like onda.video's corner tint).
- **Let type lead.** Big Clash Display headings, strong scale jumps, lots of
  negative space. Mono eyebrows (uppercase, tracked) label sections.
- **Hairlines, not boxes.** Thin dividers and outlines over filled cards.
- The wave **mark** is the signal motif; keep it small and rose/neutral.

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
import { Composition, Rect, Text, Path, linearGradient } from '@onda-engine/react'

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
