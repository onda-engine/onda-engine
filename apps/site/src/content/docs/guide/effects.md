---
title: "Effects & cinematic finishing"
description: "ONDA's render-to-texture effects stack — blur, bloom, grade, grain, depth-of-field, motion blur, mattes and blends — plus the composition-level linear/ACES finish."
---

ONDA ships a **render-to-texture effects stack**: each effect renders a node and its subtree to an offscreen texture, then transforms those pixels. Effects are the "land AI media beautifully" layer — grade mismatched clips into one look, glue sources with grain, blur and bloom for real light.

Every effect has a **sugar prop** on any node and a **raw `effects[]`** form. Most run on **both backends** (Vello GPU *and* the tiny-skia CPU reference) — see the [backend table](#what-runs-where) below.

## Two ways to apply an effect

```tsx
// Sugar prop — the common case:
<Group bloom={{ sigma: 16, threshold: 0.7, intensity: 1.2 }}>…</Group>

// Raw, ordered effects[] — full control over the chain order:
<Group effects={[
  { effect: 'color_grade', saturation: 1.2, contrast: 1.1 },
  { effect: 'bloom', sigma: 16 },
  { effect: 'grain', intensity: 0.06 },
]}>…</Group>
```

Effects apply to the node **and its whole subtree**, in array order.

## Per-effect reference

### Blur & glow

- **`blur={sigma}`** — Gaussian blur, std-dev in output px. Animate `0 → sharp` for a focus-pull entrance.
- **`directionalBlur={{ sigma, angle }}`** — 1D motion smear along `angle` (radians, default `0`).
- **`bloom={sigma | { sigma, threshold, intensity }}`** — bright regions (luminance above `threshold`, default `0.7`) blur and composite additively. The "real light" glow.
- **`backdropBlur={sigma | { sigma, tint, brightness, saturation }}`** — frosted glass: blurs the **backdrop behind** the node, then draws the node's own content on top.

### Color

- **`grade={{ exposure, contrast, saturation, temperature, tint }}`** — the cinematic color-grade. All fields optional and default to identity, so `{}` is a no-op. One grade unifies mismatched clips.
- **`duotone={{ shadow, highlight }}`** — map luminance to a two-colour gradient.
- **`chromaticAberration={px}`** — R/B split radially from centre (a lens tell).
- **`vignette={amount | { amount, softness }}`** — radial edge darkening.
- **`posterize={levels}`** — quantise each channel to `levels` discrete steps.

### Stylise & key

- **`goo={sigma | { sigma, threshold }}`** — metaball/liquid morph: overlapping shapes fuse with smooth necks.
- **`grain={intensity | { intensity, size, seed }}`** — luminance-banded film grain. Pass the current frame as `seed` for *living* grain; it's the compositing glue that makes mismatched sources read as one image.
- **`chromaKey={{ color, threshold, smoothness }}`** — knock out a colour (green-screen).

### Compositing — mattes & blends

- **`matte={<Element/>}`** + **`matteMode="alpha" | "luminance"`** — reveal this node's content only through a rendered, animatable stencil subtree. The signature **media-through-type** move (a photo seen only through giant animated text). Strictly more powerful than `clip`.
- **`blendMode="screen" | "multiply" | "overlay" | …`** — blend the subtree against the backdrop. *(GPU/Vello.)*

:::tip[Sugar maps to the chain]
`blur`, `directionalBlur`, `bloom`, `backdropBlur`, `grade`, `duotone`, `chromaticAberration`, `vignette`, `posterize`, `goo`, `grain`, and `chromaKey` are all one-line aliases for an entry in `effects[]`. Reach for raw `effects[]` only when you need to control the exact order of several passes.
:::

## Depth of field

Set `dof` on the `<Composition>` and a `depth` (z) on each layer. Layers at the focus depth stay sharp; the farther a layer's `depth` is from `focus`, the more it defocuses. Animate `focus` for a **rack-focus** pull.

```tsx
<Composition dof={{ focus: 0, aperture: 2.8 }} /* … */>
  <Image src="/bg.jpg"  depth={120} />   {/* far — soft */}
  <Text  depth={0}>In focus</Text>       {/* at focus — sharp */}
</Composition>
```

## Composition-level cinematic finish

Per-node effects work in display gamma. For a **"looks shot"** master, opt into the linear-HDR finishing chain on the whole composition — bloom that bleeds *real* light (highlights exceed 1.0 and roll off), warm halation, then **one ACES film tone-map**. No HDR is lost between passes.

```tsx
<Composition
  linear                                    // linear + ACES pipeline
  finish={{
    exposure: 1.05,
    bloom: { sigma: 18, intensity: 1.2 },
    halation: 0.6,
    contrast: 1.08, saturation: 1.1,
    vignette: 0.2, grain: 0.04,
  }}
  /* … */
/>
```

## Motion blur

Per-object motion blur via temporal supersampling — each output frame is the average of N sub-frames across the shutter window, so moving elements smear by their own motion and static ones stay sharp.

```tsx
<Composition motionBlur /* 180° shutter, 16 samples */ />
<Composition motionBlur={{ shutter: 180, samples: 24 }} />
```

Cost is `samples×` the render, so it's an **export** feature.

## What runs where

ONDA's CPU reference (tiny-skia) is not a crippled fallback — it draws the full per-pixel effect chain byte-for-byte like the GPU. A narrow set is GPU- or export-only.

| Capability | Vello (GPU) | CPU reference | Live preview |
| --- | :---: | :---: | :---: |
| blur · directionalBlur · bloom · backdropBlur | ✅ | ✅ | ✅ |
| grade · duotone · vignette · posterize · chromaticAberration | ✅ | ✅ | ✅ |
| goo · grain · chromaKey · matte | ✅ | ✅ | ✅ |
| blend modes | ✅ | — | ✅ |
| **lightWrap** | ✅ | — | export only |
| **`finish` / `linear`** (HDR + ACES) | ✅ | — | export only |
| **motionBlur** | ✅ | ✅ | export only |

:::caution[Judge the cinematic look on a native render]
`lightWrap`, the composition `finish`, and `motionBlur` are **export/native** features — the live preview shows the un-wrapped, gamma, sharp frame. Always judge the final look on an `onda export` / native Vello render, not the in-browser preview.
:::

## See also

- [Backends](/guide/backends) — the exact GPU-only vs CPU-identical split.
- [3D — Scene3D & extrude](/guide/3d) — lit 3D layers and solids.
- [Composing — complete reference](/guide/composing) — the full agent-facing surface.
