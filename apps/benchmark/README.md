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

## Result (Apple M4 Pro, 1920×1080, 120 frames)

| Backend                            |    fps | ms/frame |
| ---------------------------------- | -----: | -------: |
| Remotion (Chromium, 1 worker)      |   26.8 |    37.34 |
| Remotion (Chromium, default pool)  |   76.1 |    13.14 |
| ONDA — CPU (1 thread)              |  119.5 |     8.37 |
| ONDA — CPU (all cores, rayon)      |  709.7 |     1.41 |
| ONDA — GPU (offscreen + readback)  |  377.1 |     2.65 |

Two honest comparisons:
- **Per-thread (architecture):** ONDA CPU 1-thread vs Remotion 1-worker ≈ **4.5×**.
- **Machine throughput (all cores, default settings):** ONDA CPU all-cores vs
  Remotion default pool ≈ **9.3×**. (ONDA's rayon scaling ~6× beats Remotion's
  ~3× — its per-worker browser overhead makes concurrency sublinear.)

This is a *trivial* scene — Remotion's best case. Its ~37 ms/frame/worker is
mostly fixed browser cost (layout + paint + screenshot + IPC); ONDA's scales with
content, so the gap widens for complex scenes, the GPU path, and cold-start
(ONDA ~ms vs Chromium launch + bundle + warmup). See `techspecs/gap-analysis.md`
for the full picture and the path to 100×.

Notes: ONDA numbers are steady-state (one warm-up). The GPU number is offscreen
render + full CPU readback per frame (readback-bound); a real-time present path is
faster. Numbers vary a little run-to-run.
