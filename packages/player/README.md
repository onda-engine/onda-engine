# @onda-engine/player

An interactive **`<Player>`** for ONDA compositions — a real-time, in-browser preview of the scene graph (WASM-Vello over **WebGPU**, with a CPU-WASM fallback) plus playback controls. **Preview == export:** the same scene graph renders in the browser and natively, so what you scrub is the file you ship.

[Docs](https://onda.video) · [GitHub](https://github.com/onda-engine/onda-engine) · [Onda Studio](https://studio.onda.video)

## Install

```bash
npm install @onda-engine/player @onda-engine/react
```

## Usage

```tsx
import { Player } from "@onda-engine/player";
import { Composition, Text } from "@onda-engine/react";

<Player
  composition={
    <Composition width={1920} height={1080} fps={30} durationInFrames={90}>
      <Text x={160} y={420} fontSize={140} color="#f2f2f4">
        GPU-native
      </Text>
    </Composition>
  }
  autoPlay
  loop
/>;
```

Drop it into any React app for a scrubbable, frame-accurate preview of an ONDA composition — the same surface that powers the live editor in Onda Studio.

> WebGPU support varies by browser; the player falls back to the CPU-WASM path automatically.

---

Part of **[ONDA](https://github.com/onda-engine/onda-engine)** — a GPU-native, browser-free motion-graphics engine (React → scene graph → native GPU render). ONDA also powers **[Onda Studio](https://studio.onda.video)**, an AI motion-graphics studio — _"Lovable for video."_

Source-available under the **[Functional Source License](https://github.com/onda-engine/onda-engine/blob/main/LICENSE)** (FSL-1.1-Apache-2.0): use it, self-host it, build non-competing products; each release turns Apache-2.0 two years after it ships.
