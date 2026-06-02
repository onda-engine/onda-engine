---
title: "Why not Remotion?"
---

Remotion is excellent, and ONDA deliberately preserves its developer experience: you write React, components are pure functions of the current frame, and you assemble a timeline with `<Sequence>`. What ONDA changes is the **architecture underneath**.

## The architectural difference

Remotion renders through a browser:

```txt
React  →  DOM  →  headless Chromium  →  screenshot per frame  →  encode
```

That model is powerful — developers already understand React, and the browser gives you all of CSS for free — but it carries unavoidable costs: browser and DOM overhead, CSS interpretation, IPC for each screenshot over the DevTools protocol, hundreds of MB of memory per worker, and a GPU that headless Chrome disables by default.

ONDA renders natively:

```txt
React  →  scene graph  →  native renderer  →  GPU  →  frame
```

No browser anywhere. The per-frame cost scales with *what you actually draw*, not with fixed browser overhead.

## The honest "100×" framing

The "**100× better than Remotion**" claim is **architectural**, and it is measured **against Remotion** — *not* against ONDA's own CPU path. It is a trajectory, not a single headline number.

### Measured today (Apple M4 Pro, 1920×1080, 120 frames)

| Backend                           |   fps | ms/frame |
| --------------------------------- | ----: | -------: |
| Remotion (Chromium, 1 worker)     |  26.8 |    37.34 |
| Remotion (Chromium, default pool) |  76.1 |    13.14 |
| ONDA — CPU (1 thread)             | 119.5 |     8.37 |
| ONDA — CPU (all cores, rayon)     | 709.7 |     1.41 |
| ONDA — GPU (offscreen + readback) | 377.1 |     2.65 |

This is a **trivial** scene (a title plus a few shapes) — Remotion's *best* case. The honest read:

- **~4.5× per-thread** (ONDA CPU 1-thread vs Remotion 1-worker) and **~9.3× machine-throughput** (all cores each, default settings) — already, on the easy case.
- Remotion's ~37 ms/frame/worker is mostly **fixed browser overhead** independent of content; ONDA's cost scales with what is actually drawn.
- ONDA's parallel scaling (~6× with `rayon`) also beats Remotion's (~3×): its per-worker browser tax makes concurrency sublinear.

### Where the gap widens toward 100×

1. **Scene complexity** — a complex DOM balloons Remotion's layout/paint/screenshot cost; ONDA grows gently.
2. **The GPU path** — real-time present (not the readback-bound number above).
3. **Cold start** — ONDA pays ~milliseconds (font load) vs a Chromium launch + bundle + warmup frames (seconds), which dominates short and serverless renders.
4. **Memory** — one process + shared GPU buffers vs a full browser per worker, so far higher concurrency per machine → fewer machines → lower cost per video.

So: lead with the **measured per-thread multiple and the trajectory**; claim 100× as the realized ceiling on real workloads (complex scenes × GPU × parallel × cold start), not as a trivial-scene headline.

## Structural wins Remotion can't patch

- **GPU-first rendering** — headless Chrome *disables* the GPU by default.
- **Determinism by construction** — no time-API patching, no compositor "warmup"; identical output every run and every machine (use `--backend cpu` for bit-identical results — see [Backends](/guide/backends)).
- **Native media** — encoding/decoding is Remotion's most fragile subsystem and is a natural strength for a native engine (audio/video are on the roadmap, not shipped yet).

## What ONDA does *not* claim yet

Speed is the easy structural win; **DX parity is the moat and the open risk**. Remotion gets all of CSS/flexbox, mature audio/video, a Studio, and a Player for free. ONDA today has the reconciler, the animation primitives, and the vector renderer — but not layout, audio/video, or a Studio. See [What is ONDA?](/guide/introduction) for the precise list of what exists.

*Numbers above are from the repository's benchmark suite (`apps/benchmark`) and `techspecs/gap-analysis.md`. No performance claims without benchmarks.*
