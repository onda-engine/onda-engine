# @onda-engine/components

The **motion-graphics component & choreography library** for ONDA — ready-made, on-brand primitives (titles, kinetic type, gradients, charts, transitions, particles) that emit the engine's scene graph. A Remotion-shaped API, ported from `ondajs`.

[Docs](https://onda.video) · [Component catalog](https://onda.video/components) · [Onda Studio](https://studio.onda.video)

## Install

```bash
npm install @onda-engine/components @onda-engine/react
```

## Usage

Compose ready-made pieces inside an `@onda-engine/react` `<Composition>`. A single `<ThemeProvider theme={…}>` brand kit re-skins an entire composition, so the same motion reads differently per brand:

```tsx
import { ThemeProvider } from "@onda-engine/components";
import { Composition } from "@onda-engine/react";

const Brand = () => (
  <ThemeProvider theme={{ accent: "#7c3aed", font: "Clash Display" }}>
    <Composition width={1920} height={1080} fps={30} durationInFrames={120}>
      {/* titles, kinetic type, charts, transitions… */}
    </Composition>
  </ThemeProvider>
);
```

Browse the full set — and live, editable previews — in the **[catalog](https://onda.video/components)**.

---

Part of **[ONDA](https://github.com/onda-engine/onda-engine)** — a GPU-native, browser-free motion-graphics engine (React → scene graph → native GPU render). ONDA also powers **[Onda Studio](https://studio.onda.video)**, an AI motion-graphics studio — _"Lovable for video."_

Source-available under the **[Functional Source License](https://github.com/onda-engine/onda-engine/blob/main/LICENSE)** (FSL-1.1-Apache-2.0): use it, self-host it, build non-competing products; each release turns Apache-2.0 two years after it ships.
