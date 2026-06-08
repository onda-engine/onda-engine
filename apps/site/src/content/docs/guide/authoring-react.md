---
title: "Authoring with React"
---

`@onda/react` is a custom React renderer (built on `react-reconciler`). You write JSX exactly as you would in Remotion; instead of mounting to the DOM, the reconciler walks your tree and emits ONDA **scene-graph JSON**. That JSON is what the Rust engine renders.

```txt
Your JSX  →  custom React reconciler  →  scene-graph JSON  →  onda CLI  →  frame(s)
```

## The flow

There are two shapes of output, matching the two CLI commands:

- **A still** — `renderToSceneJSON(element)` renders frame 0 to a single scene-graph JSON object. Render it with `onda render`.
- **A movie** — `renderFramesJSON(element)` renders every frame `0..durationInFrames` to a JSON **array** of scenes. Encode it with `onda export-frames`.

```tsx
import { writeFileSync } from 'node:fs'
import { Composition, Rect, Text, renderToSceneJSON } from '@onda/react'

const scene = (
  <Composition width={1200} height={360} fps={30} durationInFrames={1}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Text x={96} y={110} fontSize={96} color="#ffffff">
      Hello ONDA
    </Text>
  </Composition>
)

writeFileSync('out.json', renderToSceneJSON(scene))
```

```bash
cargo run -p onda-cli -- render out.json out.png
```

:::caution[Rebuild `@onda/react` before running `tsx` examples]
Examples import the package's built `dist/`. Run `pnpm --filter @onda/react build` after cloning or after editing the package source, or imports of `@onda/react` will fail to resolve.
:::

## Components

Every component is a thin typed wrapper that emits an internal host element; the reconciler maps host elements to scene-graph nodes.

### `<Composition>` — the root

The root of every tree. Carries resolution and timing (like Remotion's `<Composition>`).

```tsx
<Composition width={1920} height={1080} fps={30} durationInFrames={90}>
  {/* ...nodes... */}
</Composition>
```

| Prop              | Type     | Notes                          |
| ----------------- | -------- | ------------------------------ |
| `width`           | `number` | Required.                      |
| `height`          | `number` | Required.                      |
| `fps`             | `number` | Required.                      |
| `durationInFrames`| `number` | Required.                      |

### Shared node props

`<Group>`, `<Rect>`, `<Ellipse>`, `<Path>`, `<Text>`, `<Image>`, `<Video>`, and `<Svg>` all accept these:

| Prop              | Type        | Notes                                                          |
| ----------------- | ----------- | -------------------------------------------------------------- |
| `id`              | `number`    | Stable id; needed to target the node from an animation timeline. |
| `x`, `y`          | `number`    | Translation in pixels.                                         |
| `scaleX`, `scaleY`| `number`    | Scale factor (1 = identity). Pivot at `originX`/`originY`.    |
| `rotation`        | `number`    | Clockwise degrees. **Vello/GPU backend only** (CPU ignores).   |
| `originX`, `originY` | `number` | Pivot for scale + rotation in px (default 0,0 = top-left).   |
| `opacity`         | `number`    | 0..1.                                                          |
| `clip`            | `ClipInput` | Clip this node and its subtree to a region. **GPU only.**      |
| `blur`            | `number`    | Gaussian blur σ in px (render-to-texture). Both backends.      |
| `backdropBlur`    | `number`    | Frosted-glass blur of what is behind this node. GPU only.      |
| `grain`           | `number \| object` | Film grain. `0.04`–`0.1` is filmic.                   |
| `bloom`, `grade`, `goo`, `lightWrap`, `shadow` | `object` | See [full node reference](/api/react). |

For the complete props table, effects, animation, timeline, camera, and composition footguns, see [Composing — complete reference](/guide/composing).

### Shapes: shared paint props

`<Rect>`, `<Ellipse>`, and `<Path>` additionally accept paint props:

| Prop          | Type           | Notes                                                |
| ------------- | -------------- | ---------------------------------------------------- |
| `fill`        | `ColorInput`   | Solid fill (hex string or `{r,g,b,a}` in 0..1).      |
| `gradient`    | `GradientInput`| A gradient fill — **takes precedence over `fill`**.  |
| `stroke`      | `ColorInput`   | Stroke color (GPU backend only).                     |
| `strokeWidth` | `number`       | Stroke width (defaults to 1 when `stroke` is set).   |

### `<Group>`

A transform/opacity/clip container with no visual of its own.

```tsx
<Group x={40} y={120} opacity={0.8}>
  <Rect width={100} height={40} fill="#3b82f6" />
</Group>
```

### `<Rect>` and `<Ellipse>`

```tsx
<Rect width={520} height={10} cornerRadius={5} fill="#2974f2" />
<Ellipse width={120} height={120} fill="#22d3ee" />
```

`<Rect>` adds `cornerRadius?: number`. Both require `width` and `height`.

:::tip
`cornerRadius` and strokes are rendered by the GPU (Vello) backend. The CPU reference backend draws square-cornered fills only.
:::

### `<Path>`

An arbitrary vector outline from SVG path data, in the node's local space.

```tsx
const STAR = 'M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z'

<Path x={430} y={20} d={STAR} fill="#fac81c" stroke="#806000" strokeWidth={2} />
```

`<Path>` requires `d` (SVG path data). **Paths render on the GPU (Vello) backend; the CPU backend skips them.**

### `<Text>`

```tsx
<Text x={96} y={110} fontSize={96} color="#ffffff">
  Hello ONDA
</Text>
```

| Prop       | Type         | Notes                            |
| ---------- | ------------ | -------------------------------- |
| `fontSize` | `number`     | Defaults to 48 on the engine side. |
| `color`    | `ColorInput` | Defaults to white.               |

The text content is the element's children. The bundled default font is used for deterministic output; `onda render --system-fonts` switches the CPU backend to the host's fonts.

### `<Image>`

```tsx
<Image src="assets/photo.jpg" width={640} height={360} fit="cover" />
```

Carries a `src` (path, URL, or `data:` URI). With a `width`×`height` box, the
decoded image is fitted per `fit` — `'cover'` (default, crops to fill),
`'contain'` (letterboxes), or `'fill'` (stretch). Omit the box to draw at the
image's intrinsic pixel size. The renderer measures the decoded image, so you
don't supply its dimensions.

### `<Video>`

```tsx
<Video src="assets/clip.webm" width={1280} height={720} fit="cover" startFrom={2} playbackRate={1} />
```

A video clip. At composition frame *f* it shows the source frame at
`startFrom + (f / fps) * playbackRate` seconds, fitted into the box exactly like
`<Image>`. The author layer only declares which source frame each frame wants —
decoding happens downstream:

- **Browser preview** (`@onda/player`) decodes the frame with an off-screen
  `<video>` (WebCodecs-class), so no Chromium is needed to *export*.
- **`onda export`** decodes natively via ffmpeg (build the CLI with
  `--features video`).

Props: `src`, `startFrom` (seconds trimmed off the head, default 0),
`playbackRate` (default 1), the same `width`/`height`/`fit` box as `<Image>`, and
`previewFallback` (see below). Pair with `<Sequence>` to place a clip on the
timeline. The higher-level `<VideoClip>` (in `@onda/components`) wraps this with a
fade-in/out envelope and optional cinematic letterbox.

#### Sources & CORS — preview vs. export

`onda export` decodes **any direct media URL** with ffmpeg (it fetches the URL
server-side, so CORS is irrelevant) — local files, your CDN, even a no-CORS host.
The render is never the constraint.

The **browser preview** is different: to composite a video it must read its
pixels, and the browser only allows that for a video that's **same-origin or
served with CORS** (`Access-Control-Allow-Origin`). So:

- **Local file** (`/public/clip.mp4`) or **CORS-enabled CDN** → composited in
  preview with full engine effects, and rendered identically on export. This is
  the recommended path — if you control the host (e.g. your own CDN), enable CORS
  once and you get the best of both.
- **A cross-origin URL without CORS** → can't be composited in preview. By default
  (`previewFallback="skip"`) it's blank in preview with a console hint; it still
  **renders correctly on export**. Set `previewFallback="element"` to overlay a
  plain `<video>` so it at least *plays* in preview (display-only — no engine
  effects, and it sits above the canvas, so z-order can differ from the export).
- **A YouTube/Vimeo *page* URL** is not a media file and works nowhere — in
  preview or export. Download it to a file first (e.g. `yt-dlp`).

`previewFallback` only affects the preview; it never changes the exported video.

> This is the same boundary Remotion hits — its `<OffthreadVideo>` also needs a
> downloaded media file and renders with ffmpeg; its *preview* sidesteps CORS only
> because it shows a DOM `<video>` rather than compositing pixels (which is exactly
> what `previewFallback="element"` does here).

### `<Svg>`

Embed an SVG document; the engine expands it into vector path nodes (see [SVG import](/guide/svg)).

```tsx
{/* Inline markup (self-contained) */}
<Svg x={40} y={30} markup={'<svg ...>...</svg>'} />

{/* Or a file src, resolved relative to the scene JSON's directory at render time */}
<Svg x={240} y={30} src="badge.svg" />
```

`markup` wins when both are present. Renders on the GPU (Vello) backend.

## Color, gradient, and clip helpers

### Colors

`ColorInput` is a hex string (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) or an explicit `{ r, g, b, a? }` with components in 0..1.

```tsx
fill="#3b82f6"
fill="#3b82f680"
fill={{ r: 0.4, g: 0.8, b: 1, a: 0 }}
```

### Gradients

`linearGradient(start, end, stops)` and `radialGradient(center, radius, stops)` build a `GradientInput`. Points are `[x, y]` tuples or `{ x, y }`. Coordinates are in the **shape's local space**. Stop offsets are 0..1.

```tsx
import { linearGradient, radialGradient } from '@onda/react'

<Rect
  width={360}
  height={12}
  cornerRadius={6}
  gradient={linearGradient(
    [0, 0],
    [360, 0],
    [
      { offset: 0, color: '#2974f2' },
      { offset: 1, color: '#f25a8c' },
    ],
  )}
/>

<Ellipse
  width={120}
  height={120}
  gradient={radialGradient([60, 60], 60, [
    { offset: 0, color: '#66ccff' },
    { offset: 1, color: { r: 0.4, g: 0.8, b: 1, a: 0 } },
  ])}
/>
```

Gradients render on the GPU backend. On the CPU backend, a gradient falls back to its first stop's color.

### Clips

`clipRect(width, height, cornerRadius?)`, `clipEllipse(width, height)`, and `clipPath(d)` build a `ClipInput` for the `clip` prop. The node and its subtree are clipped to that geometry, in local space.

```tsx
import { clipRect } from '@onda/react'

<Group x={40} y={120} clip={clipRect(150, 50, 12)}>
  <Text x={6} y={-8} fontSize={72} color="#3ce69a">CLIP</Text>
</Group>
```

Clipping is a GPU-backend feature; the CPU backend ignores it.

## Animating with hooks

Components are **pure functions of the current frame** (Remotion's model). Read the frame with `useCurrentFrame()` and compute props from it; the engine renders the tree once per frame.

```tsx
import { Text, interpolate, Easing, useCurrentFrame } from '@onda/react'

function Title() {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 15], [0, 1], { easing: Easing.easeOutCubic })
  const y = interpolate(frame, [0, 15], [150, 110], { easing: Easing.easeOutCubic })
  return (
    <Text x={96} y={y} fontSize={96} color="#ffffff" opacity={opacity}>
      Hello ONDA
    </Text>
  )
}
```

See the [Hooks](/api/hooks), [Animation](/api/animation), and [Timeline](/api/timeline) references for the full surface, and [Examples](/examples/) for runnable walkthroughs.
