---
title: "Media — Image & Video"
description: "Draw images and video straight into an ONDA scene: <Image> and <Video>, fitting, trimming, and how decoding works across preview and native export."
---

ONDA draws raster media as first-class scene nodes — composite, grade, blur, matte, and animate them like any other layer. The **author layer never decodes**: it places a node and resolves a time, and the renderer (or the player) decodes the pixels.

## `<Image>`

```tsx
import { Image } from 'onda-engine/react'

<Image src="/plate.jpg" width={1280} height={720} fit="cover" blur={0} />
```

- **`src`** — path, URL, or `data:` URI.
- **`width` / `height`** — target box in px. The renderer measures the decoded image and fits it into the box per `fit`, so you don't pass the intrinsic size. Omit both for the image's native pixels.
- **`fit`** — `'cover'` (default), `'contain'`, or `'fill'`.
- **`blur`** — Gaussian blur (sigma, in source px) applied by the image pass. Animate `blur` from high → `0` for a soft-focus entrance. **Identical on every backend.**

The engine right-sizes the decoded image to its display box, so large source files don't blow the GPU texture budget.

## `<Video>`

A video clip on the timeline. At composition frame *f* it shows the source frame at `startFrom + (f / fps) × playbackRate` seconds; the renderer draws that frame like an image.

```tsx
import { Video, Sequence } from 'onda-engine/react'

<Sequence from={0} durationInFrames={120}>
  <Video
    src="/clip.mp4"
    startFrom={2}        // trim 2s into the source
    playbackRate={1}     // 1 = realtime, 2 = 2× fast, 0.5 = slow-mo
    endAt={6}            // stop at 6s
    loop                 // repeat the [startFrom, endAt) span
    width={1920} height={1080} fit="cover"
  />
</Sequence>
```

- **`startFrom`** — seconds into the source shown at the clip's frame 0 (trim head). Default `0`.
- **`playbackRate`** — source seconds advanced per composition second. Default `1`.
- **`endAt`** — seconds into the source to stop at (trim tail); past it the clip holds its last frame unless `loop` is set.
- **`loop`** — loop the trimmed `[startFrom, endAt)` span (requires `endAt`).
- **`width` / `height` / `fit`** — as for `<Image>`.
- **`previewFallback`** — preview-only behaviour when the browser can't composite a source (a cross-origin video without CORS): `'skip'` (default, blank + a one-time hint) or `'element'` (overlay a plain `<video>` so it still plays, display-only). Never affects `onda export`.

## How decoding works

| | Browser preview | Native export (`onda export`) |
| --- | --- | --- |
| `<Image>` | decoded in-page | `image` crate |
| `<Video>` | off-screen `<video>` / WebCodecs | **ffmpeg** (behind the `video` feature) |

:::caution[Video decode is preview/native, behind a feature]
Native video export uses ffmpeg and is gated behind the off-by-default `video` build feature; the OSS demo path uses WebM/VP9 (no H.264 in OSS Chromium). For your own assets, serve same-origin (or with CORS) so the browser can fully composite them through the engine.
:::

:::tip[Land the media, don't just place it]
Raw AI/stock footage rarely cuts together. Run it through the [effects stack](/guide/effects) — a shared `grade`, a `matte` to reveal it through type, `grain` to glue it, `vignette`/`bloom` to finish — so mismatched sources read as one photographed image. That compositing-over-AI-media wedge is what ONDA is for.
:::

## See also

- [Effects & finishing](/guide/effects) — grade, matte, and finish your media.
- [Authoring with React](/guide/authoring-react) — placing and animating nodes.
- [Rendering & export](/guide/rendering) — exporting MP4 with audio.
