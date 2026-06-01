---
layout: home

hero:
  name: ONDA
  text: Motion graphics at GPU speed. No browser.
  tagline: An open-source, GPU-native motion-graphics engine in Rust. Author in React/JSX, compile to a universal scene graph, render with no browser anywhere.
  image:
    src: /onda-mark.svg
    alt: ONDA
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Why not Remotion?
      link: /guide/why-onda
    - theme: alt
      text: View on GitHub
      link: https://github.com/degueba/onda-engine

features:
  - title: No browser, anywhere
    details: Remotion renders React → DOM → headless Chromium → screenshot → encode. ONDA renders React → scene graph → native GPU renderer → frame. Lower memory, higher concurrency per machine, deterministic output.
  - title: GPU-native vector rendering
    details: A Vello backend draws anti-aliased fills and strokes, real rounded rects, arbitrary Bézier paths, linear & radial gradients, clip masks, and native per-glyph vector text — all on the GPU.
  - title: Deterministic CPU reference
    details: A pure-Rust CPU rasterizer gives bit-identical output across machines and runs (--backend cpu). It is the correctness oracle the GPU path is checked against.
  - title: Author in React/JSX
    details: "<Composition>, <Rect>/<Ellipse>/<Path>/<Text>/<Svg>, <Sequence>/<Series>/<Loop>, useCurrentFrame, interpolate, spring. The same DX as Remotion, compiled to plain scene-graph JSON."
  - title: The scene graph is the universal language
    details: React, hand-written JSON, or an AI agent all emit the same scene graph. The renderer is the platform; everything else is an adapter.
  - title: Export to PNG / GIF / MP4
    details: The onda CLI renders a scene to a still, or a movie to an animated GIF (pure Rust) or MP4 (via ffmpeg). Pick the backend with --backend auto|vello|cpu.
---

## Hello, ONDA

```tsx
import { Composition, Rect, Text, Path, linearGradient } from '@onda/react'

export const Hello = () => (
  <Composition width={1920} height={1080} fps={30} durationInFrames={90}>
    <Rect width={1920} height={1080} fill="#0a0d17" />
    <Rect
      x={160}
      y={840}
      width={900}
      height={12}
      cornerRadius={6}
      gradient={linearGradient(
        [0, 0],
        [900, 0],
        [
          { offset: 0, color: '#3b82f6' },
          { offset: 1, color: '#f25a8c' },
        ],
      )}
    />
    <Text x={160} y={420} fontSize={140} color="#fff">
      GPU-native
    </Text>
  </Composition>
)
```

```bash
# Author the scene graph from JSX, then render it through the GPU (Vello) — no browser involved.
pnpm --filter @onda/react exec tsx examples/hello.tsx out.json
cargo run -p onda-cli -- render out.json out.png
```

::: tip Honest framing
The "100× better than Remotion" claim is **architectural** — measured against Remotion, not against ONDA's own CPU path. On a trivial 1080p scene (Apple M4 Pro), the measured gap is ~**4.5× per-thread** and ~**9.3× machine-throughput**; it widens toward 100× as scene complexity, the GPU path, cold-start, and memory all compound. See [Why not Remotion?](/guide/why-onda).
:::
