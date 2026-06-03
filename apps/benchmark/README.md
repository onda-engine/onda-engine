# ONDA vs Remotion benchmark

Apples-to-apples render throughput for an equivalent 1080p composition, measured
on the same machine. The scene is a *cluster* (two translucent discs, an accent
bar, a title and a subtitle); `repeats` scatters N identical clusters so we can
measure how each engine scales from a trivial scene (1) to a complex one (40).
`onda-bench`'s `cluster(i)` and Remotion's `Bench.tsx` `<Cluster i>` use the same
geometry and scatter formula, so the two stay directly comparable.

## Run it

```bash
# ONDA (Rust, CPU + GPU backends) — args: <frames> <clusters>
cargo run --release -p onda-bench -- 120 1     # trivial
cargo run --release -p onda-bench -- 120 40    # complex

# Remotion (React → headless Chromium → screenshot → encode) — arg: <clusters>
pnpm --filter benchmark bench 1                # downloads Chrome Headless Shell on first run
pnpm --filter benchmark bench 40

# ONDA full export (Vello raster + readback + encode → mp4, via @onda/render)
pnpm --filter benchmark bench:onda 120 1       # args: <frames> <clusters>; needs a release `onda` build
pnpm --filter benchmark bench:onda 120 40
```

## Result (Apple M4 Pro, 1920×1080, 120 frames; one warm-up, ~run-to-run variance)

**Trivial scene — 1 cluster (6 nodes).** Remotion's best case.

| Backend                            |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   26.8 |    37.30 |
| Remotion (Chromium, default pool)  |   85.5 |    11.69 |
| ONDA — CPU (1 thread)              |  101.8 |     9.82 |
| ONDA — CPU (all cores, rayon)      |  865.6 |     1.16 |
| ONDA — GPU (offscreen + readback)  |  298.0 |     3.36 |

**Complex scene — 40 clusters (201 nodes, heavy translucent overdraw + 80 text runs).**

| Backend                            |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   25.7 |    38.88 |
| Remotion (Chromium, default pool)  |   56.7 |    17.63 |
| ONDA — CPU (1 thread)              |   11.7 |    85.32 |
| ONDA — CPU (all cores, rayon)      |  116.3 |     8.60 |
| ONDA — GPU (offscreen + readback)  |  217.4 |     4.60 |

## Full-pipeline export (render + encode → mp4)

The tables above are *raster* throughput. End-to-end — the number a Studio export
actually costs — adds the GPU→CPU readback **and** the ffmpeg encode (the same
libx264 both engines use). Measured the same way on the same machine, 120 frames
@ 1080p, via `@onda/render` (`pnpm --filter benchmark bench:onda`):

**Trivial — 1 cluster:**

| Engine (full export → mp4)         |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   26.9 |    37.24 |
| Remotion (Chromium, default pool)  |   83.9 |    11.93 |
| ONDA — Vello + libx264             |  145.8 |     6.86 |
| ONDA — Vello + hardware encode     |   98.7 |    10.13 |

**Complex — 40 clusters:**

| Engine (full export → mp4)         |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   26.1 |    38.24 |
| Remotion (Chromium, default pool)  |   58.9 |    16.98 |
| ONDA — Vello + libx264             |  107.6 |     9.29 |
| ONDA — Vello + hardware encode     |   80.5 |    12.42 |

With **libx264 on both** (an apples-to-apples encoder), one ONDA process exports
**~5.4× faster than a Remotion worker** on the trivial scene and **~4.1×** on the
complex one — and still **~1.7–1.8× faster than Remotion's whole multi-worker
pool**, single-threaded, before ONDA parallelizes anything. Two honest caveats:
the encode is shared (libx264), so the win is the no-browser raster + no
per-frame screenshot; and **hardware encode is *slower* here** — VideoToolbox's
per-call overhead loses to libx264's fast path on short, simple clips (it pays off
at 4K / long / sustained renders), so libx264 stays the portable default.

## What this shows

- **Remotion's cost is nearly content-independent.** Per worker it holds ~26 fps
  whether the scene has 6 nodes or 201 (37→39 ms/frame). The bottleneck is the
  browser pipeline — layout + paint + screenshot + IPC — not the drawing. (Its
  *pool* throughput does fall, 85→57 fps, as heavier paint per worker eats into
  concurrency.)
- **ONDA's cost tracks the actual graphics.** The GPU path renders the 33×-heavier
  scene at 217 fps — only 1.4× slower than trivial — because it's one parallel
  pass, not N browser screenshots.
- **Two honest multiples on the complex scene:**
  - *Per-thread (architecture):* ONDA GPU vs Remotion 1-worker ≈ **8.5×** (up from
    ~3.8× CPU-1-thread on the trivial scene — the architectural gap grows with
    content).
  - *Machine throughput:* ONDA GPU vs Remotion default pool ≈ **3.8×**.
- **Use the GPU for heavy scenes.** ONDA's CPU reference rasterizer is software and
  pixel/overdraw-bound (102→12 fps), so it wins only on light scenes; the GPU path
  is the one that scales.

So the advantage is **structural** — Remotion is browser-bound, ONDA is
graphics-bound — measured here at **~3.8–8.5×** depending on the scene and the axis.
The headline **100×** is the *architectural* target, not a single-scene multiple:
it comes from the things this microbenchmark doesn't capture — cold-start (ONDA
~ms vs Chromium launch + bundle + warmup), a real-time swapchain present (the GPU
number here is readback-bound), and offloading video/codec work. See
`techspecs/gap-analysis.md` for that path.

Notes: ONDA numbers are steady-state (one warm-up). The GPU number is offscreen
render + full CPU readback per frame; a present path is faster. Numbers vary a
little run-to-run.
