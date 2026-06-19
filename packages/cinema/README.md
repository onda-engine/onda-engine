# @onda-engine/cinema

Compiles a high-level **timeline composition** — scenes / tracks / entries plus choreography, camera, 2.5D depth, and finish — into an `@onda-engine/react` element. It's the spec→engine renderer **Onda Studio** uses in place of a Remotion renderer: a structured "treatment" in, deterministic video out.

[Docs](https://onda.video) · [GitHub](https://github.com/onda-engine/onda-engine) · [Onda Studio](https://studio.onda.video)

## Install

```bash
npm install @onda-engine/cinema @onda-engine/react
```

## Usage

Feed it a composition payload and render the result like any other ONDA element:

```ts
import { buildComposition } from "@onda-engine/cinema";
import { renderToSceneJSON } from "@onda-engine/react";

const element = buildComposition(payload); // CompositionPayload → @onda-engine/react element
const scene = renderToSceneJSON(element);
```

`validateComposition(payload)` checks a payload before you build it.

This is the layer that turns a high-level editorial plan into the exact scene graph the native renderer draws — the same path the Studio agent ships its final MP4 through.

---

Part of **[ONDA](https://github.com/onda-engine/onda-engine)** — a GPU-native, browser-free motion-graphics engine (React → scene graph → native GPU render). ONDA also powers **[Onda Studio](https://studio.onda.video)**, an AI motion-graphics studio — _"Lovable for video."_

Source-available under the **[Functional Source License](https://github.com/onda-engine/onda-engine/blob/main/LICENSE)** (FSL-1.1-Apache-2.0): use it, self-host it, build non-competing products; each release turns Apache-2.0 two years after it ships.
