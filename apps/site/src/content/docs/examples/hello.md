---
title: "Hello ONDA"
---

The simplest scene: a dark backdrop, a colored underline rect, and a line of text. Mirrors `packages/react/examples/hello.tsx`.

```tsx
import { writeFileSync } from 'node:fs'
import { Composition, Rect, Text, renderToSceneJSON } from '@onda/react'

const scene = (
  <Composition width={1200} height={360} fps={30} durationInFrames={1}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Text x={96} y={110} fontSize={96} color="#ffffff">
      Hello ONDA
    </Text>
  </Composition>
)

const out = process.argv[2] ?? 'hello-react.json'
writeFileSync(out, renderToSceneJSON(scene))
console.log(`wrote ${out}`)
```

## Run it

```bash
# Author the scene-graph JSON
pnpm --filter @onda/react exec tsx examples/hello.tsx out.json

# Render it to a PNG (GPU by default; falls back to CPU if no GPU)
cargo run -p onda-cli -- render out.json out.png
```

## Notes

- `renderToSceneJSON` renders **frame 0** to a single scene object and serializes it — the input shape for `onda render`.
- `cornerRadius` rounds the underline rect, which the **GPU (Vello) backend** draws; on `--backend cpu` the rect is square-cornered.
- Text uses the bundled default font (Open Sans) for deterministic output. Add `--system-fonts` to use the host's fonts on the CPU backend.
