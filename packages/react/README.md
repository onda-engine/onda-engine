# @onda-engine/react

Write **React**, get an **ONDA scene graph**. A custom React renderer (built on `react-reconciler`) that compiles JSX compositions into the engine's renderer-agnostic scene-graph JSON — no DOM, no browser.

[Docs](https://onda.video) · [GitHub](https://github.com/onda-engine/onda-engine) · [Onda Studio](https://studio.onda.video)

## Install

```bash
npm install @onda-engine/react
```

## Usage

```tsx
import { Composition, Rect, Text, renderToSceneJSON } from "@onda-engine/react";

const Hello = () => (
  <Composition width={1920} height={1080} fps={30} durationInFrames={90}>
    <Rect width={1920} height={1080} fill="#0e0e12" />
    <Text x={160} y={420} fontSize={140} color="#f2f2f4">
      GPU-native
    </Text>
  </Composition>
);

// JSX → plain scene-graph JSON the native engine renders
const scene = renderToSceneJSON(<Hello />);
```

You author with the DX you already know — `useCurrentFrame`, `interpolate`, `spring`, and `<Sequence>` / `<Series>` / `<Loop>` — and the engine rasterizes the result **natively** on the GPU (Vello), on a deterministic CPU reference, or in the browser via WASM. Use [`renderFramesJSON`](https://onda.video) to emit a per-frame array for video export.

---

Part of **[ONDA](https://github.com/onda-engine/onda-engine)** — a GPU-native, browser-free motion-graphics engine (React → scene graph → native GPU render). ONDA also powers **[Onda Studio](https://studio.onda.video)**, an AI motion-graphics studio — _"Lovable for video."_

Source-available under the **[Functional Source License](https://github.com/onda-engine/onda-engine/blob/main/LICENSE)** (FSL-1.1-Apache-2.0): use it, self-host it, build non-competing products; each release turns Apache-2.0 two years after it ships.
