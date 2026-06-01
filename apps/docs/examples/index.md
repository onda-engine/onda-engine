# Examples

These walkthroughs mirror the real example files in `packages/react/examples/`. Each authors a scene in JSX, emits scene-graph JSON, and renders it with the `onda` CLI.

::: warning Build `@onda/react` first
The examples import the package's built `dist/`. After cloning, or after editing the package source, run:

```bash
pnpm --filter @onda/react build
```
:::

| Example | What it shows | Source |
| ------- | ------------- | ------ |
| [Hello ONDA](/examples/hello) | A still scene: backdrop, an underline rect, and text → PNG. | `examples/hello.tsx` |
| [Animated title](/examples/animated) | Frame-driven motion with `useCurrentFrame` + `interpolate` → MP4/GIF. | `examples/animated.tsx` |
| [Vector](/examples/vector) | Paths, linear & radial gradients, strokes, and a clip → PNG (GPU). | `examples/vector.tsx` |
| [SVG import](/examples/svg) | `<Svg>` by inline `markup` and by file `src` → PNG (GPU). | `examples/svg.tsx` |

Run any of them with the pattern:

```bash
# 1. Author → scene-graph JSON
pnpm --filter @onda/react exec tsx examples/<name>.tsx out.json
# 2. Render with the engine
cargo run -p onda-cli -- render out.json out.png
```

(For the animated example, use `export-frames` and a `.mp4`/`.gif` output instead — see its page.)
