---
title: "Animated title"
---

Frame-driven motion, Remotion-style: a component is a pure function of the current frame. This emits a per-frame array of scene graphs and encodes it to a video. Mirrors `packages/react/examples/animated.tsx`.

```tsx
import { writeFileSync } from 'node:fs'
import {
  Composition, Easing, Rect, Text,
  interpolate, renderFramesJSON, useCurrentFrame,
} from 'onda-engine/react'

function Title() {
  const frame = useCurrentFrame()
  // Fade and slide into place over the first half-second (15 frames @ 30fps).
  const opacity = interpolate(frame, [0, 15], [0, 1], { easing: Easing.easeOutCubic })
  const y = interpolate(frame, [0, 15], [150, 110], { easing: Easing.easeOutCubic })
  return (
    <Text x={96} y={y} fontSize={96} color="#ffffff" opacity={opacity}>
      Hello ONDA
    </Text>
  )
}

const movie = (
  <Composition width={1200} height={360} fps={30} durationInFrames={30}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Title />
  </Composition>
)

const out = process.argv[2] ?? 'frames.json'
writeFileSync(out, renderFramesJSON(movie))
console.log(`wrote ${out}`)
```

## Run it

```bash
# Author all 30 frames → a JSON array of scene graphs
pnpm --filter @onda-engine/react exec tsx examples/animated.tsx frames.json

# Encode to MP4 (needs ffmpeg on PATH)...
cargo run -p onda-cli -- export-frames frames.json out.mp4

# ...or to an animated GIF (pure Rust, no external tools)
cargo run -p onda-cli -- export-frames frames.json out.gif
```

## Notes

- `renderFramesJSON` renders **every** frame `0..durationInFrames` and emits a JSON array — the input shape for `onda export-frames`.
- `useCurrentFrame()` drives both `opacity` and `y` through `interpolate`, easing with `Easing.easeOutCubic`. Out-of-range frames clamp by default, so the title stays put after frame 15.
- The `fps` for encoding is read from the first frame's composition (30 here).
