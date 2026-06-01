# ONDA vs Remotion benchmark

Apples-to-apples render throughput for an equivalent 1080p composition (a title,
a subtitle, and a few shapes), measured on the same machine.

## Run it

```bash
# ONDA (Rust, CPU + GPU backends)
cargo run --release -p onda-bench            # optional: -- <frames>, default 120

# Remotion (React → headless Chromium → screenshot → encode)
pnpm --filter benchmark bench                # downloads Chrome Headless Shell on first run
```

## Result (Apple M4 Pro, 1920×1080, 120 frames, single worker)

| Backend                         |    fps | ms/frame | vs Remotion |
| ------------------------------- | -----: | -------: | ----------: |
| Remotion (Chromium, conc.=1)    |   25.9 |    38.55 |        1.0× |
| ONDA — CPU rasterizer           |  114.1 |     8.76 |        4.4× |
| ONDA — GPU (offscreen+readback) |  344.7 |     2.90 |       13.3× |

This is a *trivial* scene — the best case for Remotion (simple DOM, no effects).
Remotion's ~38 ms/frame is mostly fixed browser cost (layout + paint + screenshot
+ IPC); ONDA's cost scales with actual content, so the gap widens for complex
scenes, and again with the GPU path, parallel rendering, and cold-start. See
`techspecs/gap-analysis.md` for the full picture and the path to 100×.

Notes: Remotion runs at `concurrency: 1` to compare per-thread (ONDA is currently
single-threaded — parallel rendering is a tracked P0). ONDA numbers are
steady-state (one warm-up frame). The GPU number is offscreen render + full CPU
readback per frame, so it's readback-bound; a real-time present path is faster.
